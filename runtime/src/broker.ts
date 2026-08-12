import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { AcpRun } from "./acp.js";
import { BrokerAcpError, probeAcpModels, runAcpQuestion } from "./acp.js";
import { DictationService } from "./dictation.js";
import { HistoryStore, presentChat, presentImage } from "./history.js";
import { continueInHerdr } from "./herdr.js";
import { ImagePolicyError, ImageStore, isAllowedExternalLink } from "./images.js";
import { discoverProviders, fallbackModels, type DiscoveredProvider } from "./providers.js";
import { resolveExecutable, runCommand } from "./process.js";
import type { BrokerCommand, BrokerEvent, ChatRecord, ProviderInfo } from "./types.js";

export class QuickchatBroker {
  readonly #emit: (event: BrokerEvent) => void;
  readonly #history: HistoryStore;
  readonly #images: ImageStore;
  readonly #dictation: DictationService;
  readonly #env: NodeJS.ProcessEnv;
  #providers = new Map<string, DiscoveredProvider>();
  #runs = new Map<string, AcpRun>();

  constructor(
    emit: (event: BrokerEvent) => void,
    options: { history?: HistoryStore; images?: ImageStore; dictation?: DictationService; env?: NodeJS.ProcessEnv } = {}
  ) {
    this.#emit = emit;
    this.#history = options.history ?? new HistoryStore();
    this.#images = options.images ?? new ImageStore();
    this.#dictation = options.dictation ?? new DictationService();
    this.#env = options.env ?? process.env;
  }

  async handle(command: BrokerCommand): Promise<boolean> {
    switch (command.type) {
      case "initialize": await this.#initialize(); break;
      case "submit": await this.#submit(command); break;
      case "cancel": await this.#cancel(command.id); break;
      case "history_list": await this.#emitHistory(); break;
      case "history_delete": await this.#history.delete(command.chatId); await this.#emitHistory(); break;
      case "history_clear": await this.#history.clear(); await this.#emitHistory(); break;
      case "dictation_start": await this.#dictationStart(); break;
      case "dictation_stop": await this.#dictationStop(); break;
      case "dictation_cancel": await this.#dictationCancel(); break;
      case "continue_in_herdr": await this.#continue(command.chatId); break;
      case "load_image": await this.#loadImage(command.url, command.id); break;
      case "open_link": await this.#openLink(command.url); break;
      case "copy": await this.#copy(command.text); break;
      case "shutdown": await Promise.all([...this.#runs.values()].map((run) => run.cancel())); return false;
    }
    return true;
  }

  async #initialize(): Promise<void> {
    const discovered = await discoverProviders(this.#env);
    await Promise.all(discovered.map(async (provider) => {
      const acpModels = await probeAcpModels(provider);
      const models = acpModels.models.length > 0 ? acpModels.models : await fallbackModels(provider);
      provider.models = models;
      if (acpModels.defaultModel !== undefined) provider.defaultModel = acpModels.defaultModel;
    }));
    this.#providers = new Map(discovered.map((provider) => [provider.id, provider]));
    const history = (await this.#history.list()).map((chat) => presentChat(chat));
    this.#emit({ type: "ready", protocolVersion: 1, providers: discovered.map(publicProvider), history });
  }

  async #submit(command: Extract<BrokerCommand, { type: "submit" }>): Promise<void> {
    if (this.#runs.has(command.id)) { this.#error("duplicate_id", "This request is already running", false, command.id); return; }
    const provider = this.#providers.get(command.provider);
    if (provider === undefined) { this.#error("provider_unavailable", "The selected harness is not installed and authenticated", false, command.id); return; }
    if (!provider.capabilities.includes(command.capability)) { this.#error("capability_unavailable", "This harness cannot safely enforce the selected capability", false, command.id); return; }
    this.#emit({ type: "state", id: command.id, state: "preparing", message: `Preparing ${provider.name}…` });
    const run = runAcpQuestion(provider, command.id, command.question, command.model, command.capability, this.#emit, 90_000, this.#images);
    this.#runs.set(command.id, run);
    this.#emit({ type: "state", id: command.id, state: "streaming" });
    try {
      const result = await run.result;
      const selectedModel = result.defaultModel ?? command.model;
      const chat: ChatRecord = {
        schemaVersion: 1,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        title: command.question.replaceAll(/\s+/g, " ").slice(0, 80),
        provider: provider.id,
        ...(selectedModel === undefined ? {} : { model: selectedModel }),
        capability: command.capability,
        question: command.question,
        answer: result.answer,
        images: result.images,
        session: { acpId: result.sessionId, resumable: result.resumable, resumeKind: result.resumable ? "native" : "transcript" }
      };
      await this.#history.save(chat);
      this.#emit({ type: "complete", chat: presentChat(chat) });
      this.#emit({ type: "state", id: command.id, state: "idle" });
    } catch (error) {
      if (error instanceof BrokerAcpError) this.#error(error.code, error.message, error.retryable, command.id);
      else this.#error("agent_failed", "The selected harness stopped unexpectedly", true, command.id);
    } finally {
      this.#runs.delete(command.id);
    }
  }

  async #cancel(id: string): Promise<void> {
    const run = this.#runs.get(id);
    if (run === undefined) return;
    this.#emit({ type: "state", id, state: "stopping" });
    await run.cancel();
  }

  async #emitHistory(): Promise<void> {
    this.#emit({ type: "history", history: (await this.#history.list()).map((chat) => presentChat(chat)) });
  }

  async #dictationStart(): Promise<void> {
    try { await this.#dictation.start(); this.#emit({ type: "dictation", state: "recording" }); }
    catch { this.#emit({ type: "dictation", state: "unavailable", message: "Voxtype is unavailable or not ready" }); }
  }

  async #dictationStop(): Promise<void> {
    this.#emit({ type: "dictation", state: "transcribing" });
    try { this.#emit({ type: "dictation", state: "idle", text: await this.#dictation.stop() }); }
    catch { this.#emit({ type: "dictation", state: "unavailable", message: "Voxtype could not finish transcription" }); }
  }

  async #dictationCancel(): Promise<void> {
    await this.#dictation.cancel();
    this.#emit({ type: "dictation", state: "idle" });
  }

  async #continue(chatId: string): Promise<void> {
    const chat = await this.#history.get(chatId);
    if (chat === undefined) { this.#emit({ type: "herdr", chatId, state: "failed", message: "Saved chat was not found" }); return; }
    this.#emit({ type: "herdr", chatId, state: "opening" });
    try {
      const result = await continueInHerdr(chat, this.#env);
      this.#emit({ type: "herdr", chatId, state: "continued", mode: result.mode });
    } catch (error) {
      const unavailable = error instanceof Error && error.message.includes("not installed");
      this.#emit({ type: "herdr", chatId, state: unavailable ? "unavailable" : "failed", message: unavailable ? "Herdr is not installed" : "Could not continue this chat in Herdr" });
    }
  }

  async #loadImage(url: string, id?: string): Promise<void> {
    try { const image = await this.#images.fetchRemote(url); this.#emit({ type: "image", id: id ?? url, image: presentImage(image) }); }
    catch (error) { this.#error(error instanceof ImagePolicyError ? error.code : "image_fetch", error instanceof Error ? error.message : "Image fetch failed", false); }
  }

  async #openLink(url: string): Promise<void> {
    if (!isAllowedExternalLink(url)) { this.#emit({ type: "link", url, opened: false }); return; }
    const opener = await resolveExecutable("xdg-open", this.#env);
    if (opener === undefined) { this.#emit({ type: "link", url, opened: false }); return; }
    const result = await runCommand(opener, [url], { env: this.#env, timeoutMs: 5_000, maxOutput: 8_192 });
    this.#emit({ type: "link", url, opened: result.code === 0 });
  }

  async #copy(text: string): Promise<void> {
    const copy = await resolveExecutable("wl-copy", this.#env);
    if (copy === undefined) { this.#emit({ type: "copied", copied: false }); return; }
    const copied = await new Promise<boolean>((resolveCopy) => {
      const child = spawn(copy, [], { env: this.#env, stdio: ["pipe", "ignore", "ignore"] });
      child.stdin.end(text);
      child.once("error", () => resolveCopy(false));
      child.once("close", (code) => resolveCopy(code === 0));
    });
    this.#emit({ type: "copied", copied });
  }

  #error(code: string, message: string, retryable: boolean, id?: string): void {
    this.#emit({ type: "error", code, message, retryable, ...(id === undefined ? {} : { id }) });
  }
}

function publicProvider(provider: DiscoveredProvider): ProviderInfo {
  return {
    id: provider.id,
    name: provider.name,
    models: provider.models,
    capabilities: provider.capabilities,
    ...(provider.version === undefined ? {} : { version: provider.version }),
    ...(provider.defaultModel === undefined ? {} : { defaultModel: provider.defaultModel })
  };
}
