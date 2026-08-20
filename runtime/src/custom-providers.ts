import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDirectory } from "./pi-harness.js";
import type { CustomProviderProbeResult, CustomProviderSpec, CustomProviderView } from "./types.js";

// User-registered OpenAI-compatible endpoints.
//
// Pi already consumes any provider declared in its models.json whose models
// speak `openai-responses` or `openai-completions`, and discoverPiAuthMethods
// already offers auth for configured providers. So registering a server is
// purely a matter of writing a well-formed, validated entry into models.json —
// the credential is then supplied through the existing built-in auth flow rather
// than being written to disk by us.

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
// Reserved so a custom entry can never shadow a first-party provider and
// silently redirect its traffic to a user-supplied host.
const RESERVED_IDS = new Set([
  "openai", "openai-codex", "anthropic", "xai", "google", "azure",
  "openrouter", "github-copilot", "kimi-coding", "radius", "builtin"
]);
const MAX_MODELS = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PROBE_BYTES = 1024 * 1024;
const PROBE_TIMEOUT_MS = 10_000;

export class CustomProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CustomProviderError";
    this.code = code;
  }
}

function invalid(message: string): never {
  throw new CustomProviderError("invalid_custom_provider", message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Coerce an untrusted field to a string without ever stringifying a structure.
 * A plain String() on unknown input turns an object into "[object Object]",
 * which would sail through the format checks below as a plausible-looking value.
 */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * A base URL is the one field that decides where credentials and prompts are
 * sent, so it is validated strictly: absolute http(s) only, no embedded
 * credentials, no query or fragment, and plaintext http restricted to loopback
 * or a Tailscale MagicDNS host. Traffic to a .ts.net host is protected by the
 * tailnet even when the application endpoint itself speaks plain HTTP.
 */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return invalid("Enter a full URL, for example https://host/v1");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return invalid("The endpoint must use https (http is allowed only on localhost or Tailscale)");
  }
  if (url.username !== "" || url.password !== "") {
    return invalid("Remove the credentials from the URL and use the API key field");
  }
  if (url.search !== "" || url.hash !== "") {
    return invalid("The endpoint must not contain a query string or fragment");
  }
  const loopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "::1"
    || url.hostname === "[::1]";
  const tailscale = url.hostname.toLowerCase().endsWith(".ts.net");
  if (url.protocol === "http:" && !loopback && !tailscale) {
    return invalid("Plain http is only allowed for localhost or Tailscale .ts.net endpoints");
  }
  // Trailing slashes are insignificant to the API but produce duplicate-looking
  // entries, so store one canonical form.
  return url.origin + url.pathname.replace(/\/+$/u, "");
}

export function validateCustomProvider(input: unknown): CustomProviderSpec {
  if (!isObject(input)) return invalid("Provide the server details");
  const id = text(input.id).trim().toLowerCase();
  if (!PROVIDER_ID.test(id)) {
    return invalid("Use a short lowercase id: letters, digits, dot, dash, underscore");
  }
  if (RESERVED_IDS.has(id)) return invalid(`"${id}" is reserved for a built-in provider`);

  const name = text(input.name).trim() || id;
  if (name.length > 64) return invalid("Keep the display name under 64 characters");

  const api = text(input.api);
  if (api !== "openai-responses" && api !== "openai-completions") {
    return invalid("Choose either the /responses or the /chat/completions API");
  }

  const baseUrl = normalizeBaseUrl(text(input.baseUrl));

  const rawModels = Array.isArray(input.models) ? input.models : [];
  if (rawModels.length === 0) return invalid("Add at least one model id");
  if (rawModels.length > MAX_MODELS) return invalid(`Add at most ${MAX_MODELS} models`);
  const seen = new Set<string>();
  const models = rawModels.map((entry) => {
    const source: Record<string, unknown> = isObject(entry) ? entry : { id: entry };
    const modelId = text(source.id).trim();
    if (!MODEL_ID.test(modelId)) return invalid(`"${modelId}" is not a valid model id`);
    if (seen.has(modelId)) return invalid(`"${modelId}" is listed twice`);
    seen.add(modelId);
    const modelName = text(source.name).trim() || modelId;
    const contextWindow = Number(source.contextWindow ?? 0);
    return {
      id: modelId,
      name: modelName.slice(0, 64),
      contextWindow: Number.isFinite(contextWindow) && contextWindow > 0
        ? Math.min(Math.floor(contextWindow), 10_000_000)
        : 128_000
    };
  });

  return { id, name, baseUrl, api, models, requiresAuth: input.requiresAuth === true };
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_PROBE_BYTES) {
    throw new CustomProviderError("custom_provider_test_failed", "The /models response is unexpectedly large");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_PROBE_BYTES) {
      await reader.cancel();
      throw new CustomProviderError("custom_provider_test_failed", "The /models response is unexpectedly large");
    }
    chunks.push(next.value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/** Probe the standard OpenAI model catalog without ever retaining the key. */
export async function probeCustomProvider(
  input: unknown,
  fetcher: typeof fetch = fetch
): Promise<CustomProviderProbeResult> {
  if (!isObject(input)) return invalid("Provide the server URL");
  const baseUrl = normalizeBaseUrl(text(input.baseUrl));
  const key = text(input.apiKey).trim();
  const headers = new Headers({ accept: "application/json" });
  if (key !== "") headers.set("authorization", `Bearer ${key}`);
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}/models`, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof CustomProviderError) throw error;
    throw new CustomProviderError(
      "custom_provider_test_failed",
      `Could not reach ${baseUrl}/models. Check the URL and whether the server uses http or https.`
    );
  }
  if (!response.ok) {
    const authHint = response.status === 401 || response.status === 403
      ? " The server rejected the API key."
      : "";
    throw new CustomProviderError(
      "custom_provider_test_failed",
      `The /models endpoint returned HTTP ${response.status}.${authHint}`
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await boundedResponseText(response));
  } catch (error) {
    if (error instanceof CustomProviderError) throw error;
    throw new CustomProviderError("custom_provider_test_failed", "The /models endpoint did not return valid JSON");
  }
  if (!isObject(payload) || !Array.isArray(payload.data)) {
    throw new CustomProviderError("custom_provider_test_failed", "The response must contain a data array of models");
  }
  const seen = new Set<string>();
  const models: CustomProviderProbeResult["models"] = [];
  for (const entry of payload.data) {
    if (!isObject(entry)) continue;
    const id = text(entry.id).trim();
    if (!MODEL_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const rawContext = Number(entry.max_model_len ?? entry.context_window ?? 0);
    models.push({
      id,
      name: text(entry.name).trim().slice(0, 64) || id,
      contextWindow: Number.isFinite(rawContext) && rawContext > 0
        ? Math.min(Math.floor(rawContext), 10_000_000)
        : 128_000
    });
    if (models.length >= MAX_MODELS) break;
  }
  if (models.length === 0) {
    throw new CustomProviderError("custom_provider_test_failed", "The /models endpoint returned no usable model ids");
  }
  return { baseUrl, models };
}

function readModelsJson(path: string): Record<string, unknown> {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) {
      throw new CustomProviderError("models_file_too_large", "models.json is unexpectedly large; not modifying it");
    }
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(value)) {
      throw new CustomProviderError(
        "models_file_invalid",
        "models.json must contain a JSON object; fix it before adding a server"
      );
    }
    return value;
  } catch (error) {
    if (error instanceof CustomProviderError) throw error;
    if (isObject(error) && error.code === "ENOENT") return {};
    throw new CustomProviderError(
      "models_file_invalid",
      "models.json could not be read or parsed; fix it before adding a server"
    );
  }
}

function writeModelsJson(path: string, value: Record<string, unknown>): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  // Written 0600 and renamed into place: the file names endpoints the user
  // trusts, and a half-written models.json would disable every provider.
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function modelsPath(env: NodeJS.ProcessEnv): string {
  return join(configDirectory(env), "models.json");
}

/** Entries OmaPilot itself added, so the UI never offers to delete a hand-written one. */
function managed(provider: Record<string, unknown>): boolean {
  return provider.omapilotManaged === true;
}

export function listCustomProviders(env: NodeJS.ProcessEnv = process.env): CustomProviderView[] {
  const file = readModelsJson(modelsPath(env));
  const providers = isObject(file.providers) ? file.providers : {};
  const out: CustomProviderView[] = [];
  for (const [id, value] of Object.entries(providers)) {
    if (!isObject(value) || !managed(value)) continue;
    const models = Array.isArray(value.models) ? value.models : [];
    out.push({
      id,
      name: text(value.name) || id,
      baseUrl: text(value.baseUrl),
      api: text(value.api),
      models: models.flatMap((entry) => {
        if (!isObject(entry) || typeof entry.id !== "string") return [];
        const contextWindow = Number(entry.contextWindow ?? 0);
        return [{
          id: entry.id,
          name: text(entry.name).trim().slice(0, 64) || entry.id,
          contextWindow: Number.isFinite(contextWindow) && contextWindow > 0
            ? Math.min(Math.floor(contextWindow), 10_000_000)
            : 128_000
        }];
      }),
      // Managed entries written before this flag existed came from the blank-key
      // flow, so treating them as no-auth repairs their availability on upgrade.
      requiresAuth: value.omapilotAuthRequired === true
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function addCustomProvider(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env
): CustomProviderView {
  const spec = validateCustomProvider(input);
  const path = modelsPath(env);
  const file = readModelsJson(path);
  const providers = isObject(file.providers) ? { ...file.providers } : {};

  const existing = providers[spec.id];
  if (existing !== undefined && (!isObject(existing) || !managed(existing))) {
    throw new CustomProviderError(
      "custom_provider_conflict",
      `models.json already defines "${spec.id}"; rename the server or edit that entry by hand`
    );
  }

  providers[spec.id] = {
    omapilotManaged: true,
    omapilotAuthRequired: spec.requiresAuth,
    name: spec.name,
    baseUrl: spec.baseUrl,
    api: spec.api,
    // Every model inherits the provider's api and baseUrl. Declaring the api on
    // the models too is what makes them visible to the harness, which filters
    // configured providers on `openai-completions` / `openai-responses`.
    models: spec.models.map((model) => ({
      id: model.id,
      name: model.name,
      api: spec.api,
      contextWindow: model.contextWindow
    }))
  };

  writeModelsJson(path, { ...file, providers });
  return {
    id: spec.id,
    name: spec.name,
    baseUrl: spec.baseUrl,
    api: spec.api,
    models: spec.models.map((model) => ({ ...model })),
    requiresAuth: spec.requiresAuth
  };
}

export function removeCustomProvider(
  id: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  const key = String(id ?? "").trim().toLowerCase();
  if (!PROVIDER_ID.test(key)) throw new CustomProviderError("invalid_custom_provider", "Unknown server");
  const path = modelsPath(env);
  const file = readModelsJson(path);
  const providers = isObject(file.providers) ? { ...file.providers } : {};
  const existing = providers[key];
  if (existing === undefined) return;
  if (!isObject(existing) || !managed(existing)) {
    throw new CustomProviderError(
      "custom_provider_conflict",
      `"${key}" was not added by OmaPilot; remove it from models.json by hand`
    );
  }
  const remaining = Object.fromEntries(
    Object.entries(providers).filter(([candidate]) => candidate !== key)
  );
  writeModelsJson(path, { ...file, providers: remaining });
}
