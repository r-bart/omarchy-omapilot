import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceError, VoiceService } from "../src/tts.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function service(options: {
  dictation?: boolean;
  kokoro?: boolean;
  fetch?: typeof fetch;
} = {}): Promise<{ voice: VoiceService; config: string }> {
  const root = await mkdtemp(join(tmpdir(), "omapilot-voice-"));
  roots.push(root);
  const config = join(root, "config");
  return {
    config,
    voice: new VoiceService(
      { HOME: root, OMAPILOT_CONFIG_DIR: config },
      {
        dictationAvailable: () => Promise.resolve(options.dictation === true),
        kokoroAvailable: () => Promise.resolve(options.kokoro === true),
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {})
      }
    )
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("voice TTS providers", () => {
  it("reports local Kokoro and Voxtype without storing secrets", async () => {
    const { voice, config } = await service({ dictation: true, kokoro: true });
    const status = await voice.status();
    expect(status.dictation.available).toBe(true);
    expect(status.tts.map((provider) => provider.id)).toEqual(["kokoro", "elevenlabs", "openai"]);
    const kokoro = status.tts[0];
    expect(kokoro).toMatchObject({ id: "kokoro", kind: "local", available: true, configured: true });
    expect(kokoro?.voices.some((voiceOption) => voiceOption.id === "af_heart")).toBe(true);
    expect(status.tts[1]).toMatchObject({ id: "elevenlabs", kind: "cloud", available: false, configured: false });
    await expect(stat(join(config, "voice-auth.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("saves an ElevenLabs key only after a successful probe and never returns it", async () => {
    const seen = new Map<string, string | null>();
    const fetcher: typeof fetch = (input) => {
      const url = requestUrl(input);
      seen.set(url, null);
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(jsonResponse([
          { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true },
          { model_id: "secret-sts", name: "STS", can_do_text_to_speech: false }
        ]));
      }
      return Promise.resolve(jsonResponse({
        voices: [{ voice_id: "voice-one", name: "Rachel" }, { voice_id: "voice-one", name: "Duplicate" }]
      }));
    };
    const { voice, config } = await service({ fetch: fetcher });
    const status = await voice.setKey("elevenlabs", "  eleven-test-key  ");
    const elevenlabs = status.tts.find((provider) => provider.id === "elevenlabs");
    expect(elevenlabs).toMatchObject({ available: true, configured: true });
    expect(elevenlabs?.models.map((model) => model.id)).toEqual(["eleven_multilingual_v2"]);
    expect(elevenlabs?.voices).toEqual([{ id: "voice-one", name: "Rachel" }]);
    expect(JSON.stringify(status)).not.toContain("eleven-test-key");
    const raw = await readFile(join(config, "voice-auth.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ elevenlabs: { type: "api_key", key: "eleven-test-key" } });
    expect(raw).not.toContain("secret-sts");
    expect([...seen.keys()].every((url) => url.startsWith("https://api.elevenlabs.io/"))).toBe(true);
  });

  it("validates an OpenAI key against /v1/models and keeps the static TTS catalog", async () => {
    let authorization = "";
    const fetcher: typeof fetch = (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(jsonResponse({ data: [{ id: "gpt-4o" }] }));
    };
    const { voice } = await service({ fetch: fetcher });
    const probed = await voice.testKey("openai", "sk-openai-test-key");
    expect(authorization).toBe("Bearer sk-openai-test-key");
    expect(probed).toMatchObject({ id: "openai", available: true, configured: true });
    expect(probed.models.map((model) => model.id)).toContain("gpt-4o-mini-tts");
    expect(probed.voices.some((voiceOption) => voiceOption.id === "coral")).toBe(true);
  });

  it("does not persist a rejected cloud key", async () => {
    const fetcher: typeof fetch = () => Promise.resolve(jsonResponse({ error: "invalid" }, 401));
    const { voice, config } = await service({ fetch: fetcher });
    await expect(voice.setKey("openai", "sk-bad-key-value")).rejects.toBeInstanceOf(VoiceError);
    await expect(stat(join(config, "voice-auth.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears a stored key without leaving an empty auth file", async () => {
    const fetcher: typeof fetch = (input) => {
      const url = requestUrl(input);
      if (url.includes("elevenlabs")) {
        if (url.endsWith("/v1/models")) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(jsonResponse({ voices: [{ voice_id: "abc", name: "Aria" }] }));
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    };
    const { voice, config } = await service({ fetch: fetcher });
    await voice.setKey("elevenlabs", "eleven-test-key");
    await voice.clearKey("elevenlabs");
    await expect(stat(join(config, "voice-auth.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const status = await voice.status();
    expect(status.tts.find((provider) => provider.id === "elevenlabs")?.configured).toBe(false);
  });
});
