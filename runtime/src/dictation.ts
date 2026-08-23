import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { omapilotPaths, type OmaPilotPaths } from "./paths.js";
import { resolveExecutable, runCommand } from "./process.js";

export class DictationService {
  readonly #paths: OmaPilotPaths;
  readonly #env: NodeJS.ProcessEnv;
  #voxtype: string | undefined;
  #transcript: string;
  #generation = 0;
  #operation: Promise<void> = Promise.resolve();

  constructor(paths: OmaPilotPaths = omapilotPaths(), env: NodeJS.ProcessEnv = process.env) {
    this.#paths = paths;
    this.#env = env;
    this.#transcript = join(paths.runtime, "dictation.txt");
  }

  async available(): Promise<boolean> {
    this.#voxtype ??= await resolveExecutable("voxtype", this.#env);
    if (this.#voxtype === undefined) return false;
    const result = await runCommand(this.#voxtype, ["status", "--format", "json"], { env: this.#env, timeoutMs: 3_000, maxOutput: 16_384 });
    return result.code === 0;
  }

  start(): Promise<void> {
    return this.#serialize(() => this.#start());
  }

  async #start(): Promise<void> {
    const generation = ++this.#generation;
    if (!await this.available() || this.#voxtype === undefined) throw new Error("Voxtype is not ready");
    if (generation !== this.#generation) throw new DictationCancelledError();
    await mkdir(this.#paths.runtime, { recursive: true, mode: 0o700 });
    await rm(this.#transcript, { force: true });
    const result = await runCommand(this.#voxtype, dictationStartArgs(this.#transcript), { env: this.#env, timeoutMs: 5_000, maxOutput: 16_384 });
    if (result.code !== 0) throw new Error("Voxtype could not start recording");
    if (generation !== this.#generation) {
      await runCommand(this.#voxtype, ["record", "cancel"], { env: this.#env, timeoutMs: 5_000, maxOutput: 16_384 });
      throw new DictationCancelledError();
    }
  }

  stop(timeoutMs = 60_000): Promise<string> {
    return this.#serialize(() => this.#stop(timeoutMs));
  }

  async #stop(timeoutMs: number): Promise<string> {
    const generation = this.#generation;
    if (this.#voxtype === undefined) throw new Error("Voxtype is not recording");
    const result = await runCommand(this.#voxtype, ["record", "stop"], { env: this.#env, timeoutMs: 5_000, maxOutput: 16_384 });
    if (result.code !== 0) throw new Error("Voxtype could not stop recording");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (generation !== this.#generation) throw new DictationCancelledError();
      try {
        const text = (await readFile(this.#transcript, "utf8")).trim();
        if (text !== "") { await rm(this.#transcript, { force: true }); return text; }
      } catch {
        // The transcript is written only after transcription completes.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    }
    throw new Error("Voxtype transcription timed out");
  }

  cancel(): Promise<void> {
    this.#generation += 1;
    return this.#serialize(() => this.#cancel());
  }

  async #cancel(): Promise<void> {
    if (this.#voxtype !== undefined) await runCommand(this.#voxtype, ["record", "cancel"], { env: this.#env, timeoutMs: 5_000, maxOutput: 16_384 });
    await rm(this.#transcript, { force: true });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operation.then(operation, operation);
    this.#operation = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class DictationCancelledError extends Error {
  constructor() {
    super("Dictation was cancelled");
    this.name = "DictationCancelledError";
  }
}

export function dictationStartArgs(transcript: string): string[] {
  return ["record", "start", `--file=${transcript}`, "--no-auto-submit", "--no-smart-auto-submit"];
}
