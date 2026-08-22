import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DictationService } from "./dictation.js";
import { quickchatPaths } from "./paths.js";
import { resolveExecutable, runCommand } from "./process.js";

export const ttsProviderIds = ["kokoro", "elevenlabs", "openai"] as const;
export type TtsProviderId = (typeof ttsProviderIds)[number];
export const cloudTtsProviderIds = ["elevenlabs", "openai"] as const;
export type CloudTtsProviderId = (typeof cloudTtsProviderIds)[number];

export type VoiceOption = { id: string; name: string; models?: string[] };
export type TtsModelOption = { id: string; name: string };
export type TtsProviderStatus = {
  id: TtsProviderId;
  name: string;
  kind: "local" | "cloud";
  available: boolean;
  configured: boolean;
  message: string;
  models: TtsModelOption[];
  voices: VoiceOption[];
};
export type VoiceStatus = {
  dictation: { available: boolean; message: string };
  tts: TtsProviderStatus[];
};

export class VoiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VoiceError";
    this.code = code;
  }
}

const PROVIDER_NAMES: Record<TtsProviderId, string> = {
  kokoro: "Kokoro",
  elevenlabs: "ElevenLabs",
  openai: "OpenAI"
};

const KOKORO_MODELS: TtsModelOption[] = [{ id: "kokoro-82m", name: "Kokoro 82M" }];
const KOKORO_VOICES: VoiceOption[] = [
  { id: "af_heart", name: "Heart (American female)" },
  { id: "af_bella", name: "Bella (American female)" },
  { id: "af_nicole", name: "Nicole (American female)" },
  { id: "af_sarah", name: "Sarah (American female)" },
  { id: "af_kore", name: "Kore (American female)" },
  { id: "af_aoede", name: "Aoede (American female)" },
  { id: "af_alloy", name: "Alloy (American female)" },
  { id: "af_nova", name: "Nova (American female)" },
  { id: "af_sky", name: "Sky (American female)" },
  { id: "am_michael", name: "Michael (American male)" },
  { id: "am_fenrir", name: "Fenrir (American male)" },
  { id: "am_puck", name: "Puck (American male)" },
  { id: "am_echo", name: "Echo (American male)" },
  { id: "bf_emma", name: "Emma (British female)" },
  { id: "bf_isabella", name: "Isabella (British female)" },
  { id: "bm_george", name: "George (British male)" },
  { id: "bm_fable", name: "Fable (British male)" }
];

const OPENAI_MODELS: TtsModelOption[] = [
  { id: "gpt-4o-mini-tts", name: "GPT-4o mini TTS" },
  { id: "tts-1-hd", name: "TTS-1 HD" },
  { id: "tts-1", name: "TTS-1" }
];
const OPENAI_STANDARD_VOICE_IDS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
const OPENAI_MINI_VOICE_IDS = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"
];
const OPENAI_VOICE_NAMES: Record<string, string> = {
  alloy: "Alloy", ash: "Ash", ballad: "Ballad", coral: "Coral", echo: "Echo",
  fable: "Fable", onyx: "Onyx", nova: "Nova", sage: "Sage", shimmer: "Shimmer",
  verse: "Verse", marin: "Marin", cedar: "Cedar"
};
const OPENAI_VOICES: VoiceOption[] = OPENAI_MINI_VOICE_IDS.map((id) => ({
  id,
  name: OPENAI_VOICE_NAMES[id] ?? id,
  models: OPENAI_STANDARD_VOICE_IDS.includes(id)
    ? ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"]
    : ["gpt-4o-mini-tts"]
}));

const ELEVENLABS_MODELS: TtsModelOption[] = [
  { id: "eleven_multilingual_v2", name: "Multilingual v2" },
  { id: "eleven_turbo_v2_5", name: "Turbo v2.5" },
  { id: "eleven_flash_v2_5", name: "Flash v2.5" },
  { id: "eleven_v3", name: "Eleven v3" }
];

const MAX_AUTH_BYTES = 64 * 1024;
const MAX_PROBE_BYTES = 256 * 1024;
const PROBE_TIMEOUT_MS = 8_000;
const KOKORO_TIMEOUT_MS = 3_000;
const OPTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_MODELS = 32;
const MAX_VOICES = 100;
const MAX_KEY_LENGTH = 512;

type AuthFile = Partial<Record<CloudTtsProviderId, { type: "api_key"; key: string }>>;

export function isTtsProviderId(value: string): value is TtsProviderId {
  return (ttsProviderIds as readonly string[]).includes(value);
}

export function isCloudTtsProviderId(value: string): value is CloudTtsProviderId {
  return (cloudTtsProviderIds as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function voiceConfigDirectory(env: NodeJS.ProcessEnv): string {
  const explicit = env.OMAPILOT_CONFIG_DIR?.trim();
  if (explicit !== undefined && explicit.startsWith("/")) return explicit;
  return quickchatPaths(env).config;
}

function authPath(env: NodeJS.ProcessEnv): string {
  return join(voiceConfigDirectory(env), "voice-auth.json");
}

function readAuthFile(path: string): AuthFile {
  try {
    if (statSync(path).size > MAX_AUTH_BYTES) {
      throw new VoiceError("tts_auth_invalid", "voice-auth.json is unexpectedly large; not modifying it");
    }
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(value)) {
      throw new VoiceError("tts_auth_invalid", "voice-auth.json must contain a JSON object");
    }
    const file: AuthFile = {};
    for (const id of cloudTtsProviderIds) {
      const entry = value[id];
      if (!isObject(entry) || entry.type !== "api_key") continue;
      const key = text(entry.key).trim();
      if (key === "") continue;
      file[id] = { type: "api_key", key };
    }
    return file;
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    if (isObject(error) && error.code === "ENOENT") return {};
    throw new VoiceError("tts_auth_invalid", "voice-auth.json could not be read or parsed");
  }
}

function writeAuthFile(path: string, file: AuthFile): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const body = `${JSON.stringify(file, null, 2)}\n`;
  writeFileSync(temporary, body, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function storedKey(file: AuthFile, provider: CloudTtsProviderId): string | undefined {
  const key = file[provider]?.key.trim();
  return key === undefined || key === "" ? undefined : key;
}

function normalizeKey(raw: string): string {
  const key = raw.trim();
  if (key.length < 8) throw new VoiceError("invalid_tts_key", "Enter a complete API key");
  if (key.length > MAX_KEY_LENGTH) throw new VoiceError("invalid_tts_key", "That API key is unexpectedly long");
  if (/[\u0000-\u001f\u007f]/.test(key)) throw new VoiceError("invalid_tts_key", "The API key contains control characters");
  return key;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_PROBE_BYTES) {
    throw new VoiceError("tts_probe_failed", "The provider response is unexpectedly large");
  }
  if (response.body === null) throw new VoiceError("tts_probe_failed", "The provider returned an empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_PROBE_BYTES) {
      await reader.cancel();
      throw new VoiceError("tts_probe_failed", "The provider response is unexpectedly large");
    }
    chunks.push(next.value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new VoiceError("tts_probe_failed", "The provider did not return valid JSON");
  }
}

function option(id: string, name: string, models?: string[]): VoiceOption | TtsModelOption | undefined {
  if (!OPTION_ID.test(id)) return undefined;
  const label = name.trim().slice(0, 64) || id;
  return models === undefined ? { id, name: label } : { id, name: label, models };
}

export type VoiceServiceOptions = {
  fetch?: typeof fetch;
  dictationAvailable?: () => Promise<boolean>;
  kokoroAvailable?: () => Promise<boolean>;
};

export class VoiceService {
  readonly #env: NodeJS.ProcessEnv;
  readonly #fetch: typeof fetch;
  readonly #dictationAvailable: () => Promise<boolean>;
  readonly #kokoroAvailable: () => Promise<boolean>;

  constructor(env: NodeJS.ProcessEnv = process.env, options: VoiceServiceOptions = {}) {
    this.#env = env;
    this.#fetch = options.fetch ?? fetch;
    this.#dictationAvailable = options.dictationAvailable
      ?? (() => new DictationService(quickchatPaths(env), env).available());
    this.#kokoroAvailable = options.kokoroAvailable ?? (() => probeKokoro(env));
  }

  async status(): Promise<VoiceStatus> {
    const [dictation, kokoro, auth] = await Promise.all([
      this.#dictationStatus(),
      this.#kokoroStatus(),
      Promise.resolve(this.#auth())
    ]);
    const elevenlabs = await this.#cloudStatus("elevenlabs", storedKey(auth, "elevenlabs"));
    const openai = await this.#cloudStatus("openai", storedKey(auth, "openai"));
    return { dictation, tts: [kokoro, elevenlabs, openai] };
  }

  async setKey(provider: CloudTtsProviderId, apiKey: string): Promise<VoiceStatus> {
    const key = normalizeKey(apiKey);
    const probed = await this.#cloudStatus(provider, key);
    if (!probed.available) {
      throw new VoiceError("tts_auth_failed", probed.message || "The API key was rejected");
    }
    const file = this.#auth();
    file[provider] = { type: "api_key", key };
    writeAuthFile(authPath(this.#env), file);
    return this.status();
  }

  async clearKey(provider: CloudTtsProviderId): Promise<VoiceStatus> {
    const file = this.#auth();
    const remaining: AuthFile = {};
    for (const id of cloudTtsProviderIds) {
      if (id === provider) continue;
      const entry = file[id];
      if (entry !== undefined) remaining[id] = entry;
    }
    const path = authPath(this.#env);
    if (Object.keys(remaining).length === 0) {
      try { unlinkSync(path); }
      catch (error) {
        if (!(isObject(error) && error.code === "ENOENT")) throw error;
      }
    } else writeAuthFile(path, remaining);
    return this.status();
  }

  async testKey(provider: CloudTtsProviderId, apiKey: string): Promise<TtsProviderStatus> {
    return this.#cloudStatus(provider, normalizeKey(apiKey));
  }

  #auth(): AuthFile {
    return readAuthFile(authPath(this.#env));
  }

  async #dictationStatus(): Promise<VoiceStatus["dictation"]> {
    try {
      const available = await this.#dictationAvailable();
      return {
        available,
        message: available
          ? "Voxtype is ready for dictation."
          : "Voxtype is not installed or not ready. Install it, then reopen settings. OmaPilot uses it for listening and does not install it for you."
      };
    } catch {
      return {
        available: false,
        message: "Voxtype could not be reached. Install it, then reopen settings."
      };
    }
  }

  async #kokoroStatus(): Promise<TtsProviderStatus> {
    let available = false;
    try { available = await this.#kokoroAvailable(); }
    catch { available = false; }
    return {
      id: "kokoro",
      name: PROVIDER_NAMES.kokoro,
      kind: "local",
      available,
      configured: available,
      message: available
        ? "Kokoro is installed locally."
        : "Kokoro is not installed. Use Python 3.10–3.12 with `pip install kokoro soundfile`, and install espeak-ng. OmaPilot does not download the model for you.",
      models: KOKORO_MODELS,
      voices: KOKORO_VOICES
    };
  }

  async #cloudStatus(provider: CloudTtsProviderId, key: string | undefined): Promise<TtsProviderStatus> {
    const base: TtsProviderStatus = {
      id: provider,
      name: PROVIDER_NAMES[provider],
      kind: "cloud",
      available: false,
      configured: key !== undefined,
      message: key === undefined
        ? `Add an ${PROVIDER_NAMES[provider]} API key to enable this provider.`
        : `${PROVIDER_NAMES[provider]} is configured.`,
      models: provider === "openai" ? OPENAI_MODELS : ELEVENLABS_MODELS,
      voices: provider === "openai" ? OPENAI_VOICES : []
    };
    if (key === undefined) return base;
    try {
      const probed = provider === "openai"
        ? await probeOpenAi(key, this.#fetch)
        : await probeElevenLabs(key, this.#fetch);
      return {
        ...base,
        available: true,
        configured: true,
        message: `${PROVIDER_NAMES[provider]} is ready.`,
        models: probed.models.length > 0 ? probed.models : base.models,
        voices: probed.voices.length > 0 ? probed.voices : base.voices
      };
    } catch (error) {
      return {
        ...base,
        available: false,
        configured: true,
        message: error instanceof VoiceError
          ? error.message
          : `${PROVIDER_NAMES[provider]} could not be reached.`
      };
    }
  }
}

async function probeKokoro(env: NodeJS.ProcessEnv): Promise<boolean> {
  const python = await resolveExecutable("python3", env);
  if (python === undefined) return false;
  const result = await runCommand(python, ["-c", "import kokoro"], {
    env,
    timeoutMs: KOKORO_TIMEOUT_MS,
    maxOutput: 4_096
  });
  return result.code === 0;
}

async function probeOpenAi(apiKey: string, fetcher: typeof fetch): Promise<{ models: TtsModelOption[]; voices: VoiceOption[] }> {
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    throw new VoiceError("tts_probe_failed", "Could not reach OpenAI. Check the network and try again.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new VoiceError("tts_auth_failed", "OpenAI rejected the API key.");
  }
  if (!response.ok) {
    throw new VoiceError("tts_probe_failed", `OpenAI returned HTTP ${response.status}.`);
  }
  await boundedJson(response);
  return { models: OPENAI_MODELS, voices: OPENAI_VOICES };
}

async function probeElevenLabs(apiKey: string, fetcher: typeof fetch): Promise<{ models: TtsModelOption[]; voices: VoiceOption[] }> {
  const [models, voices] = await Promise.all([
    elevenLabsJson("https://api.elevenlabs.io/v1/models", apiKey, fetcher),
    elevenLabsJson("https://api.elevenlabs.io/v1/voices", apiKey, fetcher)
  ]);
  return {
    models: parseElevenLabsModels(models),
    voices: parseElevenLabsVoices(voices)
  };
}

async function elevenLabsJson(url: string, apiKey: string, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json", "xi-api-key": apiKey },
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
  } catch (error) {
    if (error instanceof VoiceError) throw error;
    throw new VoiceError("tts_probe_failed", "Could not reach ElevenLabs. Check the network and try again.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new VoiceError("tts_auth_failed", "ElevenLabs rejected the API key.");
  }
  if (!response.ok) {
    throw new VoiceError("tts_probe_failed", `ElevenLabs returned HTTP ${response.status}.`);
  }
  return boundedJson(response);
}

function parseElevenLabsModels(payload: unknown): TtsModelOption[] {
  const rows = Array.isArray(payload) ? payload : (isObject(payload) && Array.isArray(payload.models) ? payload.models : []);
  const models: TtsModelOption[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    if (!isObject(entry)) continue;
    if (entry.can_do_text_to_speech === false) continue;
    const id = text(entry.model_id ?? entry.id).trim();
    const parsed = option(id, text(entry.name) || id);
    if (parsed === undefined || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    models.push({ id: parsed.id, name: parsed.name });
    if (models.length >= MAX_MODELS) break;
  }
  return models;
}

function parseElevenLabsVoices(payload: unknown): VoiceOption[] {
  const rows = isObject(payload) && Array.isArray(payload.voices) ? payload.voices : [];
  const voices: VoiceOption[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    if (!isObject(entry)) continue;
    const id = text(entry.voice_id ?? entry.id).trim();
    const parsed = option(id, text(entry.name) || id);
    if (parsed === undefined || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    voices.push({ id: parsed.id, name: parsed.name });
    if (voices.length >= MAX_VOICES) break;
  }
  return voices;
}
