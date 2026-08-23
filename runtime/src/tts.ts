import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DictationService } from "./dictation.js";
import { omapilotPaths } from "./paths.js";
import { resolveExecutable, runBinaryCommand, runCommand, terminateProcessGroup } from "./process.js";

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
export type AudioPlaybackTelemetry = {
  levels: readonly number[];
  intervalMs: number;
  onStarted: () => void;
  onLevel: (level: number) => void;
};
export type TtsPlaybackObserver = {
  started: (metered: boolean) => void;
  level: (level: number) => void;
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
const KOKORO_RUNTIME_IMPORTS = [
  "import numpy as np",
  "import soundfile as sf",
  "from kokoro import KPipeline"
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
export const ELEVENLABS_DEFAULT_VOICE_ID = "wyWA56cQNU2KqUW4eCsI";
export const ELEVENLABS_DEFAULT_VOICE: VoiceOption = { id: ELEVENLABS_DEFAULT_VOICE_ID, name: "Clyde" };
const ELEVENLABS_VOICES: VoiceOption[] = [ELEVENLABS_DEFAULT_VOICE];
const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v2/voices";
const ELEVENLABS_VOICE_PAGE_SIZE = 20;
const MAX_ELEVENLABS_VOICE_PAGES = 5;

const MAX_AUTH_BYTES = 64 * 1024;
const MAX_PROBE_BYTES = 256 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_SPOKEN_CHARS = 3_500;
const PROBE_TIMEOUT_MS = 8_000;
const SPEECH_TIMEOUT_MS = 30_000;
const PLAY_TIMEOUT_MS = 180_000;
const KOKORO_TIMEOUT_MS = 3_000;
const KOKORO_SPEAK_TIMEOUT_MS = 120_000;
const AUDIO_METER_SAMPLE_RATE = 1_000;
const AUDIO_METER_INTERVAL_MS = 50;
const AUDIO_METER_MAX_BYTES = 512 * 1024;
const AUDIO_METER_TIMEOUT_MS = 30_000;
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
  return omapilotPaths(env).config;
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
  analyzeAudio?: (path: string, signal: AbortSignal) => Promise<number[]>;
  playAudio?: (path: string, signal: AbortSignal, telemetry?: AudioPlaybackTelemetry) => Promise<void>;
};

export class VoiceService {
  readonly #env: NodeJS.ProcessEnv;
  readonly #fetch: typeof fetch;
  readonly #dictationAvailable: () => Promise<boolean>;
  readonly #kokoroAvailable: () => Promise<boolean>;
  readonly #analyzeAudio: (path: string, signal: AbortSignal) => Promise<number[]>;
  readonly #playAudio: (path: string, signal: AbortSignal, telemetry?: AudioPlaybackTelemetry) => Promise<void>;
  #playback: AbortController | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env, options: VoiceServiceOptions = {}) {
    this.#env = env;
    this.#fetch = options.fetch ?? fetch;
    this.#dictationAvailable = options.dictationAvailable
      ?? (() => new DictationService(omapilotPaths(env), env).available());
    this.#kokoroAvailable = options.kokoroAvailable ?? (() => probeKokoro(env));
    this.#analyzeAudio = options.analyzeAudio ?? ((path, signal) => analyzeAudioFile(path, env, signal));
    this.#playAudio = options.playAudio
      ?? ((path, signal, telemetry) => playAudioFile(path, env, signal, telemetry));
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

  stop(): void {
    this.#playback?.abort();
    this.#playback = undefined;
  }

  async speak(input: {
    provider: TtsProviderId;
    model?: string | undefined;
    voice?: string | undefined;
    text: string;
  }, observer?: TtsPlaybackObserver): Promise<void> {
    this.stop();
    const spoken = spokenText(input.text);
    if (spoken === "") throw new VoiceError("tts_empty", "There is nothing to speak");
    const controller = new AbortController();
    this.#playback = controller;
    const root = await mkdtemp(join(tmpdir(), "omapilot-tts-"));
    try {
      const audio = await this.#synthesize(input.provider, input.model, input.voice, spoken, controller.signal);
      const path = join(root, audio.extension === "wav" ? "speech.wav" : "speech.mp3");
      await writeFile(path, audio.bytes, { mode: 0o600 });
      if (controller.signal.aborted) throw cancelled();
      const levels = observer === undefined ? [] : await this.#analyzeAudio(path, controller.signal);
      if (controller.signal.aborted) throw cancelled();
      const telemetry = observer === undefined ? undefined : {
        levels,
        intervalMs: AUDIO_METER_INTERVAL_MS,
        onStarted: () => observer.started(levels.length > 0),
        onLevel: observer.level
      };
      await this.#playAudio(path, controller.signal, telemetry);
    } catch (error) {
      if (controller.signal.aborted) throw cancelled();
      throw error;
    } finally {
      if (this.#playback === controller) this.#playback = undefined;
      await rm(root, { recursive: true, force: true });
    }
  }

  async #synthesize(
    provider: TtsProviderId,
    model: string | undefined,
    voice: string | undefined,
    text: string,
    signal: AbortSignal
  ): Promise<{ bytes: Buffer; extension: "mp3" | "wav" }> {
    if (provider === "kokoro") return synthesizeKokoro(voice, text, this.#env, signal);
    const key = storedKey(this.#auth(), provider);
    if (key === undefined) {
      throw new VoiceError("tts_not_configured", `Add an ${PROVIDER_NAMES[provider]} API key to speak answers.`);
    }
    if (provider === "openai") {
      return synthesizeOpenAi(key, model, voice, text, this.#fetch, signal);
    }
    return synthesizeElevenLabs(key, model, voice, text, this.#fetch, signal);
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
      voices: provider === "openai" ? OPENAI_VOICES : ELEVENLABS_VOICES
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
        voices: provider === "elevenlabs"
          ? withElevenLabsDefaultVoice(probed.voices)
          : (probed.voices.length > 0 ? probed.voices : base.voices)
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
  const result = await runCommand(python, ["-c", KOKORO_RUNTIME_IMPORTS.join("\n")], {
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
  const [modelsResult, voicesResult] = await Promise.allSettled([
    elevenLabsJson("https://api.elevenlabs.io/v1/models", apiKey, fetcher),
    listElevenLabsVoices(apiKey, fetcher)
  ]);
  if (voicesResult.status === "rejected") throw voicesResult.reason;
  return {
    models: modelsResult.status === "fulfilled" ? parseElevenLabsModels(modelsResult.value) : [],
    voices: withElevenLabsDefaultVoice(voicesResult.value)
  };
}

async function listElevenLabsVoices(apiKey: string, fetcher: typeof fetch): Promise<VoiceOption[]> {
  const voices: VoiceOption[] = [];
  const voiceIds = new Set<string>();
  const pageTokens = new Set<string>();
  let nextPageToken = "";

  for (let page = 0; page < MAX_ELEVENLABS_VOICE_PAGES && voices.length < MAX_VOICES; page += 1) {
    const url = new URL(ELEVENLABS_VOICES_URL);
    url.searchParams.set("page_size", String(ELEVENLABS_VOICE_PAGE_SIZE));
    url.searchParams.set("include_total_count", "false");
    if (nextPageToken !== "") url.searchParams.set("next_page_token", nextPageToken);

    const payload = await elevenLabsJson(url.href, apiKey, fetcher);
    for (const voice of parseElevenLabsVoices(payload)) {
      if (voiceIds.has(voice.id)) continue;
      voiceIds.add(voice.id);
      voices.push(voice);
      if (voices.length >= MAX_VOICES) break;
    }

    if (!isObject(payload) || payload.has_more !== true) break;
    const token = text(payload.next_page_token).trim();
    if (token === "" || token.length > 2_048 || pageTokens.has(token)) break;
    pageTokens.add(token);
    nextPageToken = token;
  }

  return voices;
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

function withElevenLabsDefaultVoice(voices: VoiceOption[]): VoiceOption[] {
  const preferred = voices.find((voice) => voice.id === ELEVENLABS_DEFAULT_VOICE_ID);
  const rest = voices.filter((voice) => voice.id !== ELEVENLABS_DEFAULT_VOICE_ID);
  return [
    { id: ELEVENLABS_DEFAULT_VOICE_ID, name: preferred?.name ?? ELEVENLABS_DEFAULT_VOICE.name },
    ...rest
  ].slice(0, MAX_VOICES);
}

export function spokenText(markdown: string, maxChars = MAX_SPOKEN_CHARS): string {
  let text = markdown.replaceAll("\r\n", "\n");
  text = text.replaceAll(/```[\s\S]*?```/g, " ");
  text = text.replaceAll(/~~~[\s\S]*?~~~/g, " ");
  text = text.replaceAll(/!\[[^\]]*]\([^)]*\)/g, " ");
  text = text.replaceAll(/\[([^\]]+)]\([^)]*\)/g, "$1");
  text = text.replaceAll(/<[^>]+>/g, " ");
  text = text.replaceAll(/^#{1,6}\s+/gm, "");
  text = text.replaceAll(/[*_~`>#]/g, "");
  text = text.replaceAll(/[\u0000-\u001f\u007f]/g, " ");
  text = text.replaceAll(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const boundary = sliced.lastIndexOf(" ");
  const clipped = (boundary > maxChars * 0.6 ? sliced.slice(0, boundary) : sliced).trim();
  return `${clipped}…`;
}

function optionOrFallback(value: string | undefined, fallback: string): string {
  const id = value?.trim() ?? "";
  return OPTION_ID.test(id) ? id : fallback;
}

function cancelled(): VoiceError {
  return new VoiceError("tts_cancelled", "Speaking was cancelled");
}

function speechSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

async function boundedAudio(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    throw new VoiceError("tts_probe_failed", "The spoken audio is unexpectedly large");
  }
  if (response.body === null) throw new VoiceError("tts_probe_failed", "The provider returned an empty body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new VoiceError("tts_probe_failed", "The spoken audio is unexpectedly large");
    }
    chunks.push(next.value);
  }
  if (size === 0) throw new VoiceError("tts_probe_failed", "The provider returned empty audio");
  return Buffer.concat(chunks, size);
}

async function synthesizeElevenLabs(
  apiKey: string,
  model: string | undefined,
  voice: string | undefined,
  text: string,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<{ bytes: Buffer; extension: "mp3" }> {
  const voiceId = optionOrFallback(voice, ELEVENLABS_DEFAULT_VOICE_ID);
  const modelId = optionOrFallback(model, ELEVENLABS_MODELS[0]?.id ?? "eleven_multilingual_v2");
  let response: Response;
  try {
    response = await fetcher(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          accept: "audio/mpeg",
          "content-type": "application/json",
          "xi-api-key": apiKey
        },
        body: JSON.stringify({ text, model_id: modelId }),
        redirect: "error",
        signal: speechSignal(signal, SPEECH_TIMEOUT_MS)
      }
    );
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (error instanceof VoiceError) throw error;
    throw new VoiceError("tts_probe_failed", "Could not reach ElevenLabs. Check the network and try again.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new VoiceError("tts_auth_failed", "ElevenLabs rejected the API key.");
  }
  if (!response.ok) {
    throw new VoiceError("tts_probe_failed", `ElevenLabs returned HTTP ${response.status}.`);
  }
  return { bytes: await boundedAudio(response), extension: "mp3" };
}

async function synthesizeOpenAi(
  apiKey: string,
  model: string | undefined,
  voice: string | undefined,
  text: string,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<{ bytes: Buffer; extension: "mp3" }> {
  const voiceId = optionOrFallback(voice, "alloy");
  const modelId = optionOrFallback(model, OPENAI_MODELS[0]?.id ?? "gpt-4o-mini-tts");
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        accept: "audio/mpeg",
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        voice: voiceId,
        input: text,
        response_format: "mp3"
      }),
      redirect: "error",
      signal: speechSignal(signal, SPEECH_TIMEOUT_MS)
    });
  } catch (error) {
    if (signal.aborted) throw cancelled();
    if (error instanceof VoiceError) throw error;
    throw new VoiceError("tts_probe_failed", "Could not reach OpenAI. Check the network and try again.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new VoiceError("tts_auth_failed", "OpenAI rejected the API key.");
  }
  if (!response.ok) {
    throw new VoiceError("tts_probe_failed", `OpenAI returned HTTP ${response.status}.`);
  }
  return { bytes: await boundedAudio(response), extension: "mp3" };
}

const KOKORO_SPEAK_SCRIPT = [
  "import sys",
  "from pathlib import Path",
  ...KOKORO_RUNTIME_IMPORTS,
  "voice, wav_path, text_path = sys.argv[1], sys.argv[2], sys.argv[3]",
  "text = Path(text_path).read_text(encoding='utf-8')",
  "pipeline = KPipeline(lang_code='a')",
  "chunks = [audio for _, _, audio in pipeline(text, voice=voice)]",
  "audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)",
  "sf.write(wav_path, audio, 24000)"
].join("\n");

async function synthesizeKokoro(
  voice: string | undefined,
  text: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal
): Promise<{ bytes: Buffer; extension: "wav" }> {
  if (signal.aborted) throw cancelled();
  const python = await resolveExecutable("python3", env);
  if (python === undefined) {
    throw new VoiceError("tts_not_configured", "Kokoro is not installed.");
  }
  const root = await mkdtemp(join(tmpdir(), "omapilot-kokoro-"));
  const wavPath = join(root, "speech.wav");
  const textPath = join(root, "speech.txt");
  try {
    await writeFile(textPath, text, { encoding: "utf8", mode: 0o600 });
    const result = await runCommand(python, ["-c", KOKORO_SPEAK_SCRIPT, optionOrFallback(voice, "af_heart"), wavPath, textPath], {
      env,
      timeoutMs: KOKORO_SPEAK_TIMEOUT_MS,
      maxOutput: 16_384
    });
    if (signal.aborted) throw cancelled();
    if (result.code !== 0) {
      throw new VoiceError("tts_probe_failed", "Kokoro could not speak that answer.");
    }
    const bytes = readFileSync(wavPath);
    if (bytes.byteLength === 0) throw new VoiceError("tts_probe_failed", "Kokoro returned empty audio");
    return { bytes, extension: "wav" };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const PLAYERS: Array<{ name: string; args: (path: string) => string[] }> = [
  { name: "mpv", args: (path) => ["--no-video", "--really-quiet", "--no-terminal", "--audio-display=no", path] },
  { name: "ffplay", args: (path) => ["-nodisp", "-autoexit", "-loglevel", "quiet", path] },
  { name: "pw-play", args: (path) => [path] },
  { name: "paplay", args: (path) => [path] }
];

export function pcm16Envelope(
  pcm: Buffer,
  sampleRate = AUDIO_METER_SAMPLE_RATE,
  intervalMs = AUDIO_METER_INTERVAL_MS
): number[] {
  const samplesPerBucket = Math.max(1, Math.floor(sampleRate * intervalMs / 1_000));
  const levels: number[] = [];
  let smoothed = 0;
  for (let sampleOffset = 0; sampleOffset * 2 + 1 < pcm.byteLength; sampleOffset += samplesPerBucket) {
    const end = Math.min(sampleOffset + samplesPerBucket, Math.floor(pcm.byteLength / 2));
    let energy = 0;
    let count = 0;
    for (let sample = sampleOffset; sample < end; sample += 1) {
      const normalized = pcm.readInt16LE(sample * 2) / 32_768;
      energy += normalized * normalized;
      count += 1;
    }
    if (count === 0) continue;
    const rms = Math.sqrt(energy / count);
    const target = Math.min(1, Math.sqrt(Math.max(0, (rms - 0.004) * 3.4)));
    smoothed = target > smoothed
      ? target * 0.72 + smoothed * 0.28
      : target * 0.34 + smoothed * 0.66;
    levels.push(smoothed);
  }
  return levels;
}

async function analyzeAudioFile(path: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<number[]> {
  if (signal.aborted) throw cancelled();
  const ffmpeg = await resolveExecutable("ffmpeg", env);
  if (ffmpeg === undefined) return [];
  try {
    const result = await runBinaryCommand(ffmpeg, [
      "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", String(AUDIO_METER_SAMPLE_RATE),
      "-f", "s16le", "pipe:1"
    ], {
      env,
      timeoutMs: AUDIO_METER_TIMEOUT_MS,
      maxOutput: AUDIO_METER_MAX_BYTES
    });
    if (signal.aborted) throw cancelled();
    if (result.code !== 0 || result.stdout.byteLength < 2) return [];
    return pcm16Envelope(result.stdout);
  } catch {
    if (signal.aborted) throw cancelled();
    // Metering is enhancement-only. Playback remains available when FFmpeg is
    // missing, rejects the source, or disappears between lookup and spawn.
    return [];
  }
}

async function playAudioFile(
  path: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  telemetry?: AudioPlaybackTelemetry
): Promise<void> {
  if (signal.aborted) throw cancelled();
  for (const player of PLAYERS) {
    const executable = await resolveExecutable(player.name, env);
    if (executable === undefined) continue;
    await runPlayer(executable, player.args(path), env, signal, telemetry);
    return;
  }
  throw new VoiceError("tts_playback_failed", "No audio player is available. Install mpv or PipeWire.");
}

function runPlayer(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  telemetry?: AudioPlaybackTelemetry
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let levelTimer: NodeJS.Timeout | undefined;
    let levelIndex = 0;
    const child = spawn(executable, args, {
      env,
      stdio: "ignore",
      detached: process.platform !== "win32"
    });
    const finish = (error?: VoiceError): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeoutTimer);
      if (levelTimer !== undefined) clearInterval(levelTimer);
      if (telemetry !== undefined && telemetry.levels.length > 0) telemetry.onLevel(0);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const onAbort = (): void => {
      terminateProcessGroup(child.pid);
      finish(cancelled());
    };
    const timeoutTimer = setTimeout(() => {
      terminateProcessGroup(child.pid);
      finish(new VoiceError("tts_playback_failed", "Speaking took too long"));
    }, PLAY_TIMEOUT_MS);
    timeoutTimer.unref();
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("spawn", () => {
      if (telemetry === undefined) return;
      telemetry.onStarted();
      if (telemetry.levels.length === 0) return;
      const emitNextLevel = (): void => {
        const level = telemetry.levels[levelIndex];
        if (level === undefined) {
          if (levelTimer !== undefined) clearInterval(levelTimer);
          levelTimer = undefined;
          telemetry.onLevel(0);
          return;
        }
        telemetry.onLevel(level);
        levelIndex += 1;
      };
      emitNextLevel();
      levelTimer = setInterval(emitNextLevel, telemetry.intervalMs);
      levelTimer.unref();
    });
    child.once("error", () => finish(new VoiceError("tts_playback_failed", "Could not start the audio player")));
    child.once("close", (code) => {
      if (signal.aborted) finish(cancelled());
      else if (code === 0) finish();
      else finish(new VoiceError("tts_playback_failed", "The audio player failed"));
    });
  });
}
