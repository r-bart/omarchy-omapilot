import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ELEVENLABS_DEFAULT_VOICE_ID,
  pcm16Envelope,
  spokenText,
  VoiceError,
  VoiceService,
  type VoiceServiceOptions
} from "../src/tts.js";

const elevenLabsKey = process.env.ELEVEN_LABS_API_KEY?.trim() ?? "";
const liveElevenLabs = elevenLabsKey.length >= 8;

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function service(options: {
  dictation?: boolean;
  kokoro?: boolean;
  fetch?: typeof fetch;
  analyzeAudio?: NonNullable<VoiceServiceOptions["analyzeAudio"]>;
  playAudio?: NonNullable<VoiceServiceOptions["playAudio"]>;
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
        ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
        ...(options.analyzeAudio !== undefined ? { analyzeAudio: options.analyzeAudio } : {}),
        ...(options.playAudio !== undefined ? { playAudio: options.playAudio } : {})
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
  it("probes every import required by Kokoro synthesis", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-kokoro-probe-"));
    roots.push(root);
    const bin = join(root, "bin");
    const python = join(bin, "python3");
    await mkdir(bin);
    await writeFile(python, [
      `#!${process.execPath}`,
      "const source = process.argv[3] ?? '';",
      "const imports = ['import numpy as np', 'import soundfile as sf', 'from kokoro import KPipeline'];",
      "process.exit(process.argv[2] === '-c' && imports.every((value) => source.includes(value)) ? 0 : 1);"
    ].join("\n"));
    await chmod(python, 0o700);

    const voice = new VoiceService(
      { HOME: root, OMAPILOT_CONFIG_DIR: join(root, "config"), PATH: bin },
      { dictationAvailable: () => Promise.resolve(false) }
    );
    const status = await voice.status();
    expect(status.tts[0]).toMatchObject({ id: "kokoro", available: true, configured: true });
  });

  it("reports local Kokoro and Voxtype without storing secrets", async () => {
    const { voice, config } = await service({ dictation: true, kokoro: true });
    const status = await voice.status();
    expect(status.dictation.available).toBe(true);
    expect(status.tts.map((provider) => provider.id)).toEqual(["kokoro", "elevenlabs", "openai"]);
    const kokoro = status.tts[0];
    expect(kokoro).toMatchObject({ id: "kokoro", kind: "local", available: true, configured: true });
    expect(kokoro?.voices.some((voiceOption) => voiceOption.id === "af_heart")).toBe(true);
    expect(status.tts[1]).toMatchObject({ id: "elevenlabs", kind: "cloud", available: false, configured: false });
    expect(status.tts[1]?.voices[0]).toEqual({ id: ELEVENLABS_DEFAULT_VOICE_ID, name: "Clyde" });
    await expect(stat(join(config, "voice-auth.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("saves an ElevenLabs key only after a successful probe and never returns it", async () => {
    const seen = new Map<string, string | null>();
    const fetcher: typeof fetch = (input) => {
      const url = requestUrl(input);
      seen.set(url, null);
      if (url.includes("/v1/models")) {
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
    expect(elevenlabs?.voices).toEqual([
      { id: ELEVENLABS_DEFAULT_VOICE_ID, name: "Clyde" },
      { id: "voice-one", name: "Rachel" }
    ]);
    expect(JSON.stringify(status)).not.toContain("eleven-test-key");
    const raw = await readFile(join(config, "voice-auth.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ elevenlabs: { type: "api_key", key: "eleven-test-key" } });
    expect(raw).not.toContain("secret-sts");
    expect([...seen.keys()].every((url) => url.startsWith("https://api.elevenlabs.io/"))).toBe(true);
    expect([...seen.keys()].some((url) => url.includes("/v2/voices"))).toBe(true);
  });

  it("accepts an ElevenLabs key that can list voices even when /v1/models is out of scope", async () => {
    const fetcher: typeof fetch = (input) => {
      const url = requestUrl(input);
      if (url.includes("/v1/models")) return Promise.resolve(jsonResponse({ detail: { status: "unauthorized" } }, 401));
      return Promise.resolve(jsonResponse({ voices: [{ voice_id: "voice-one", name: "Rachel" }] }));
    };
    const { voice } = await service({ fetch: fetcher });
    const probed = await voice.testKey("elevenlabs", "eleven-test-key");
    expect(probed).toMatchObject({ id: "elevenlabs", available: true, configured: true });
    expect(probed.models.map((model) => model.id)).toEqual([
      "eleven_multilingual_v2",
      "eleven_turbo_v2_5",
      "eleven_flash_v2_5",
      "eleven_v3"
    ]);
    expect(probed.voices.map((voiceOption) => voiceOption.id)).toEqual([
      ELEVENLABS_DEFAULT_VOICE_ID,
      "voice-one"
    ]);
  });

  it("keeps Clyde first when ElevenLabs returns it later in the catalog", async () => {
    const fetcher: typeof fetch = (input) => {
      const url = requestUrl(input);
      if (url.includes("/v1/models")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({
        voices: [
          { voice_id: "voice-one", name: "Rachel" },
          { voice_id: ELEVENLABS_DEFAULT_VOICE_ID, name: "Clyde" }
        ]
      }));
    };
    const { voice } = await service({ fetch: fetcher });
    const probed = await voice.testKey("elevenlabs", "eleven-test-key");
    expect(probed.voices.map((voiceOption) => voiceOption.id)).toEqual([
      ELEVENLABS_DEFAULT_VOICE_ID,
      "voice-one"
    ]);
    expect(probed.voices[0]).toEqual({ id: ELEVENLABS_DEFAULT_VOICE_ID, name: "Clyde" });
  });

  it("paginates a large ElevenLabs voice catalog without exceeding the per-response limit", async () => {
    const requestedPages: string[] = [];
    const fetcher: typeof fetch = (input) => {
      const url = new URL(requestUrl(input));
      if (url.pathname === "/v1/models") return Promise.resolve(jsonResponse([]));
      expect(url.pathname).toBe("/v2/voices");
      expect(url.searchParams.get("page_size")).toBe("20");
      expect(url.searchParams.get("include_total_count")).toBe("false");

      const token = url.searchParams.get("next_page_token") ?? "page-0";
      requestedPages.push(token);
      const offset = Number(token.replace("page-", "")) * 20;
      const voices = Array.from({ length: 20 }, (_, index) => ({
        voice_id: `voice-${offset + index}`,
        name: `Voice ${offset + index}`,
        description: "x".repeat(8_000)
      }));
      const nextOffset = offset + voices.length;
      return Promise.resolve(jsonResponse({
        voices,
        has_more: nextOffset < 100,
        next_page_token: nextOffset < 100 ? `page-${nextOffset / 20}` : null
      }));
    };

    const { voice } = await service({ fetch: fetcher });
    const probed = await voice.testKey("elevenlabs", "eleven-test-key");
    expect(requestedPages).toEqual(["page-0", "page-1", "page-2", "page-3", "page-4"]);
    expect(probed.available).toBe(true);
    expect(probed.voices).toHaveLength(100);
    expect(probed.voices[0]).toEqual({ id: ELEVENLABS_DEFAULT_VOICE_ID, name: "Clyde" });
    expect(probed.voices.at(-1)?.id).toBe("voice-98");
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

  it("strips markdown before speaking", () => {
    expect(spokenText("Hello **world** and a [link](https://example.com).")).toBe("Hello world and a link.");
    expect(spokenText("# Title\n\n```js\nsecret()\n```\nDone.")).toBe("Title Done.");
    expect(spokenText("   ")).toBe("");
  });

  it("derives a bounded envelope from decoded mono PCM", () => {
    const pcm = Buffer.alloc(200);
    for (let sample = 50; sample < 100; sample += 1) pcm.writeInt16LE(16_000, sample * 2);
    const envelope = pcm16Envelope(pcm, 1_000, 50);
    expect(envelope).toHaveLength(2);
    expect(envelope[0]).toBe(0);
    expect(envelope[1]).toBeGreaterThan(0.5);
    expect(envelope[1]).toBeLessThanOrEqual(1);
  });

  it("speaks an ElevenLabs answer without returning the key", async () => {
    let posted: { url: string; body: string } | undefined;
    const played: string[] = [];
    const started: boolean[] = [];
    const observedLevels: number[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = requestUrl(input);
      if (String(init?.method ?? "GET").toUpperCase() === "POST") {
        posted = { url, body: typeof init?.body === "string" ? init.body : "" };
        return Promise.resolve(new Response(Buffer.from("ID3fake-mp3"), {
          status: 200,
          headers: { "content-type": "audio/mpeg" }
        }));
      }
      if (url.includes("/v1/models")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ voices: [] }));
    };
    const { voice } = await service({
      fetch: fetcher,
      analyzeAudio: () => Promise.resolve([0.12, 0.74]),
      playAudio: (path, _signal, telemetry) => {
        played.push(path);
        if (telemetry !== undefined) {
          telemetry.onStarted();
          for (const level of telemetry.levels) telemetry.onLevel(level);
        }
        return Promise.resolve();
      }
    });
    await voice.setKey("elevenlabs", "eleven-test-key");
    await voice.speak({ provider: "elevenlabs", text: "Hello **world**" }, {
      started: (metered) => started.push(metered),
      level: (level) => observedLevels.push(level)
    });
    expect(posted?.url).toContain(`/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE_ID}`);
    expect(JSON.parse(posted?.body ?? "{}")).toMatchObject({ text: "Hello world" });
    expect(played).toHaveLength(1);
    expect(started).toEqual([true]);
    expect(observedLevels).toEqual([0.12, 0.74]);
  });

  it("keeps playback available with an explicitly unmetered fallback", async () => {
    const started: boolean[] = [];
    const fetcher: typeof fetch = (input, init) => {
      const url = requestUrl(input);
      if (String(init?.method ?? "GET").toUpperCase() === "POST") {
        return Promise.resolve(new Response(Buffer.from("ID3fake-mp3"), { status: 200 }));
      }
      if (url.includes("/v1/models")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ voices: [] }));
    };
    const { voice } = await service({
      fetch: fetcher,
      playAudio: (_path, _signal, telemetry) => {
        expect(telemetry?.levels).toEqual([]);
        telemetry?.onStarted();
        return Promise.resolve();
      }
    });
    await voice.setKey("elevenlabs", "eleven-test-key");
    await voice.speak({ provider: "elevenlabs", text: "Fallback still speaks" }, {
      started: (metered) => started.push(metered),
      level: () => undefined
    });
    expect(started).toEqual([false]);
  });

  it("does not speak when no cloud key is stored", async () => {
    const { voice } = await service({ playAudio: () => Promise.resolve() });
    await expect(voice.speak({ provider: "elevenlabs", text: "Hello" })).rejects.toBeInstanceOf(VoiceError);
  });

  it.runIf(liveElevenLabs)("probes a real ElevenLabs key and keeps Clyde as the default voice", async () => {
    const { voice } = await service();
    const probed = await voice.testKey("elevenlabs", elevenLabsKey);
    expect(probed.id).toBe("elevenlabs");
    expect(probed.available, probed.message).toBe(true);
    expect(probed.configured).toBe(true);
    expect(probed.models.length).toBeGreaterThan(0);
    expect(probed.voices[0]?.id).toBe(ELEVENLABS_DEFAULT_VOICE_ID);
    expect(probed.voices.some((voiceOption) => voiceOption.id === ELEVENLABS_DEFAULT_VOICE_ID)).toBe(true);
    expect(JSON.stringify(probed).includes(elevenLabsKey)).toBe(false);
  }, 30_000);
});
