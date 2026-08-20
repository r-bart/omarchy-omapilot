import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  addCustomProvider,
  CustomProviderError,
  listCustomProviders,
  normalizeBaseUrl,
  probeCustomProvider,
  removeCustomProvider,
  validateCustomProvider
} from "../src/custom-providers.js";

const roots: string[] = [];

async function root(): Promise<{ env: NodeJS.ProcessEnv; modelsPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "omapilot-custom-provider-"));
  roots.push(dir);
  const config = join(dir, "config");
  return { env: { HOME: dir, OMAPILOT_CONFIG_DIR: config }, modelsPath: join(config, "models.json") };
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const valid = {
  id: "my-server",
  name: "My Server",
  baseUrl: "https://llm.example.com/v1/",
  api: "openai-responses",
  models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B", contextWindow: 131072 }]
};

describe("custom OpenAI-compatible providers", () => {
  it("rejects endpoints that could leak credentials or downgrade transport", () => {
    expect(() => normalizeBaseUrl("not a url")).toThrow(CustomProviderError);
    expect(() => normalizeBaseUrl("ftp://host/v1")).toThrow(/must use https/u);
    expect(() => normalizeBaseUrl("https://user:pw@host/v1")).toThrow(/Remove the credentials/u);
    expect(() => normalizeBaseUrl("https://host/v1?key=secret")).toThrow(/query string/u);
    expect(() => normalizeBaseUrl("http://remote.example.com/v1")).toThrow(/only allowed for localhost or Tailscale/u);
    // Loopback is the one place plaintext is legitimate: a local inference server.
    expect(normalizeBaseUrl("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1");
    expect(normalizeBaseUrl("http://finn.example.ts.net:8888/v1"))
      .toBe("http://finn.example.ts.net:8888/v1");
    // Trailing slashes are canonicalized so the same server cannot be added twice.
    expect(normalizeBaseUrl("https://llm.example.com/v1/")).toBe("https://llm.example.com/v1");
  });

  it("refuses to shadow a built-in provider id", () => {
    for (const id of ["openai", "openai-codex", "xai", "anthropic", "builtin"]) {
      expect(() => validateCustomProvider({ ...valid, id })).toThrow(/reserved/u);
    }
  });

  it("bounds ids, model lists, and the chosen API", () => {
    expect(() => validateCustomProvider({ ...valid, id: "Bad Id" })).toThrow(/lowercase id/u);
    expect(() => validateCustomProvider({ ...valid, api: "anthropic-messages" })).toThrow(/responses/u);
    expect(() => validateCustomProvider({ ...valid, models: [] })).toThrow(/at least one model/u);
    expect(() => validateCustomProvider({
      ...valid,
      models: [{ id: "a" }, { id: "a" }]
    })).toThrow(/listed twice/u);
    expect(() => validateCustomProvider({
      ...valid,
      models: Array.from({ length: 201 }, (_, index) => ({ id: `m${index}` }))
    })).toThrow(/at most 200/u);
    const normalized = validateCustomProvider({ ...valid, models: [{ id: "plain" }] });
    expect(normalized.models[0]).toEqual({ id: "plain", name: "plain", contextWindow: 128_000 });
  });

  it("writes a Pi-readable provider whose models declare the selected API", async () => {
    const { env, modelsPath } = await root();
    const view = addCustomProvider(valid, env);
    expect(view).toEqual({
      id: "my-server",
      name: "My Server",
      baseUrl: "https://llm.example.com/v1",
      api: "openai-responses",
      models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B", contextWindow: 131_072 }],
      requiresAuth: false
    });
    const raw = await readFile(modelsPath, "utf8");
    const file: unknown = JSON.parse(raw);
    expect(file).toMatchObject({
      providers: {
        "my-server": {
          omapilotManaged: true,
          omapilotAuthRequired: false,
          baseUrl: "https://llm.example.com/v1",
          api: "openai-responses",
          // The harness only surfaces configured providers whose models
          // advertise an OpenAI-compatible api, so it must be on each model too.
          models: [{ id: "gpt-oss-120b", api: "openai-responses" }]
        }
      }
    });
    // No credential is ever persisted here; auth goes through the built-in flow.
    expect(raw).not.toContain("apiKey");
  });

  it("discovers models without an Authorization header when the key is blank", async () => {
    let receivedAuthorization: string | null = "not-called";
    const fetcher: typeof fetch = (_input, init) => {
      receivedAuthorization = new Headers(init?.headers).get("authorization");
      return Promise.resolve(new Response(JSON.stringify({
        object: "list",
        data: [{ id: "Qwen3.8-27B", max_model_len: 262_144 }]
      }), { status: 200, headers: { "content-type": "application/json" } }));
    };
    await expect(probeCustomProvider({
      baseUrl: "http://finn.example.ts.net:8888/v1"
    }, fetcher)).resolves.toEqual({
      baseUrl: "http://finn.example.ts.net:8888/v1",
      models: [{ id: "Qwen3.8-27B", name: "Qwen3.8-27B", contextWindow: 262_144 }]
    });
    expect(receivedAuthorization).toBeNull();
  });

  it("uses the optional key only for the /models probe", async () => {
    let receivedAuthorization = "";
    const fetcher: typeof fetch = (_input, init) => {
      receivedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "secured" }] }), { status: 200 }));
    };
    await probeCustomProvider({ baseUrl: "https://models.example.com/v1", apiKey: "test-key" }, fetcher);
    expect(receivedAuthorization).toBe("Bearer test-key");
  });

  it("ignores a credential handed to the writer, whatever the caller sends", async () => {
    // The add command carries an optional apiKey so a server can be registered
    // and signed in in one step, but the credential is the broker's business:
    // this writer must never let one reach models.json.
    const { env, modelsPath } = await root();
    addCustomProvider({ ...valid, apiKey: "sk-should-never-be-written" }, env);
    const raw = await readFile(modelsPath, "utf8");
    expect(raw).not.toContain("sk-should-never-be-written");
    expect(raw).not.toContain("apiKey");
    // And the spec it returns carries no credential field either.
    expect(JSON.stringify(validateCustomProvider({ ...valid, apiKey: "sk-x" })))
      .not.toContain("sk-x");
  });

  it("round-trips through list and remove without touching foreign entries", async () => {
    const { env, modelsPath } = await root();
    addCustomProvider(valid, env);
    addCustomProvider({ ...valid, id: "local", baseUrl: "http://localhost:1234/v1", api: "openai-completions" }, env);
    expect(listCustomProviders(env).map((provider) => provider.id)).toEqual(["local", "my-server"]);

    removeCustomProvider("my-server", env);
    expect(listCustomProviders(env).map((provider) => provider.id)).toEqual(["local"]);
    // Removing something absent is a no-op rather than an error.
    expect(() => removeCustomProvider("my-server", env)).not.toThrow();

    const file: unknown = JSON.parse(await readFile(modelsPath, "utf8"));
    expect(file).toMatchObject({ providers: { local: { omapilotManaged: true } } });
    expect(Object.keys((file as { providers: Record<string, unknown> }).providers)).toEqual(["local"]);
  });

  it("never rewrites or deletes a hand-written models.json entry", async () => {
    const { env, modelsPath } = await root();
    addCustomProvider(valid, env);
    const file = JSON.parse(await readFile(modelsPath, "utf8")) as { providers: Record<string, unknown> };
    file.providers["hand-written"] = { name: "Mine", baseUrl: "https://mine.example.com", api: "openai-responses" };
    await writeFile(modelsPath, JSON.stringify(file, null, 2));

    // Not managed by OmaPilot, so it is invisible to the UI list...
    expect(listCustomProviders(env).map((provider) => provider.id)).toEqual(["my-server"]);
    // ...and protected from both overwrite and removal.
    expect(() => addCustomProvider({ ...valid, id: "hand-written" }, env)).toThrow(/already defines/u);
    expect(() => removeCustomProvider("hand-written", env)).toThrow(/not added by OmaPilot/u);

    const after: unknown = JSON.parse(await readFile(modelsPath, "utf8"));
    expect(after).toMatchObject({
      providers: {
        "hand-written": { name: "Mine", baseUrl: "https://mine.example.com", api: "openai-responses" }
      }
    });
  });

  it("preserves unrelated top-level models.json keys", async () => {
    const { env, modelsPath } = await root();
    addCustomProvider(valid, env);
    const file = JSON.parse(await readFile(modelsPath, "utf8")) as Record<string, unknown>;
    file.modelOverrides = { "openai/gpt-5": { maxTokens: 1000 } };
    await writeFile(modelsPath, JSON.stringify(file, null, 2));

    addCustomProvider({ ...valid, id: "second" }, env);
    const after = JSON.parse(await readFile(modelsPath, "utf8")) as {
      providers: Record<string, unknown>;
      modelOverrides: unknown;
    };
    expect(after.modelOverrides).toEqual({ "openai/gpt-5": { maxTokens: 1000 } });
    expect(Object.keys(after.providers).sort()).toEqual(["my-server", "second"]);
  });

  it.each([
    ["malformed JSON", "{ definitely-not-json"],
    ["a non-object root", "[]"]
  ])("refuses to replace models.json containing %s", async (_label, contents) => {
    const { env, modelsPath } = await root();
    await mkdir(join(modelsPath, ".."), { recursive: true });
    await writeFile(modelsPath, contents);

    expect(() => addCustomProvider(valid, env)).toThrow(/models\.json/u);
    expect(await readFile(modelsPath, "utf8")).toBe(contents);
  });
});
