import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { AcpRun, PermissionDecision } from "./acp.js";
import { BrokerAcpError, deleteAcpSession, probeAcpModels, runAcpQuestion } from "./acp.js";
import { DictationService } from "./dictation.js";
import { promptWithDesktopContext } from "./context.js";
import { HistoryStore, presentChat, presentImage } from "./history.js";
import { continueInHerdr, describeHerdrError } from "./herdr.js";
import { ImagePolicyError, ImageStore, isAllowedExternalLink } from "./images.js";
import { normalizeToolPermission, type PendingToolPermission } from "./permissions.js";
import { discoverProviders, fallbackModels, type DiscoveredProvider } from "./providers.js";
import { resolveExecutable, runCommand } from "./process.js";
import type { BrokerCommand, BrokerEvent, ChatRecord, ProviderId, ProviderInfo } from "./types.js";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

type DictationClient = Pick<DictationService, "start" | "stop" | "cancel">;
type SessionCleaner = (provider: DiscoveredProvider, sessionId: string) => Promise<boolean>;
type HerdrContinue = typeof continueInHerdr;
type HerdrResult = Awaited<ReturnType<HerdrContinue>>;
type PermissionWaiter = PendingToolPermission & {
  resolve: (decision: PermissionDecision) => void;
  timeout: NodeJS.Timeout;
};

export class QuickchatBroker {
  readonly #emit: (event: BrokerEvent) => void;
  readonly #history: HistoryStore;
  readonly #images: ImageStore;
  readonly #dictation: DictationClient;
  readonly #sessionCleaner: SessionCleaner;
  readonly #herdrContinue: HerdrContinue;
  readonly #env: NodeJS.ProcessEnv;
  readonly #permissionTimeoutMs: number;
  #providers = new Map<string, DiscoveredProvider>();
  #runs = new Map<string, AcpRun>();
  #handoffs = new Map<string, Promise<void>>();
  #permissions = new Map<string, PermissionWaiter>();
  #submissions = new Set<string>();
  #dictationGeneration = 0;

  constructor(
    emit: (event: BrokerEvent) => void,
    options: { history?: HistoryStore; images?: ImageStore; dictation?: DictationClient; sessionCleaner?: SessionCleaner; herdrContinue?: HerdrContinue; env?: NodeJS.ProcessEnv; permissionTimeoutMs?: number } = {}
  ) {
    this.#emit = emit;
    this.#history = options.history ?? new HistoryStore();
    this.#images = options.images ?? new ImageStore();
    this.#dictation = options.dictation ?? new DictationService();
    this.#sessionCleaner = options.sessionCleaner ?? deleteAcpSession;
    this.#herdrContinue = options.herdrContinue ?? continueInHerdr;
    this.#env = options.env ?? process.env;
    this.#permissionTimeoutMs = options.permissionTimeoutMs ?? 60_000;
  }

  async handle(command: BrokerCommand): Promise<boolean> {
    switch (command.type) {
      case "initialize": await this.#initialize(command); break;
      case "submit": await this.#submit(command); break;
      case "cancel": await this.#cancel(command.id); break;
      case "permission_response": this.#respondPermission(command); break;
      case "history_list": await this.#emitHistory(); break;
      case "history_delete": {
        const deleted = await this.#history.delete(command.chatId);
        await this.#emitHistory();
        if (deleted !== undefined) await this.#cleanupSessions([deleted]);
        break;
      }
      case "history_clear": {
        const deleted = await this.#history.clear();
        await this.#emitHistory();
        await this.#cleanupSessions(deleted);
        break;
      }
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

  async #initialize(command: Extract<BrokerCommand, { type: "initialize" }>): Promise<void> {
    if (command.protocolVersion !== 2) {
      this.#error("unsupported_protocol", "Quickchat supports broker protocol version 2", false);
      return;
    }
    const discovered = await discoverProviders(this.#env);
    await Promise.all(discovered.map(async (provider) => {
      const acpModels = await probeAcpModels(provider);
      const models = acpModels.models.length > 0 ? acpModels.models : await fallbackModels(provider);
      provider.models = models;
      if (acpModels.defaultModel !== undefined) provider.defaultModel = acpModels.defaultModel;
    }));
    this.#providers = new Map(discovered.map((provider) => [provider.id, provider]));
    const history = (await this.#history.list()).map((chat) => presentChat(chat));
    this.#emit({ type: "ready", protocolVersion: 2, features: ["desktop-context"], providers: discovered.map(publicProvider), history });
  }

  async #submit(command: Extract<BrokerCommand, { type: "submit" }>): Promise<void> {
    if (this.#submissions.has(command.id)) { this.#error("duplicate_id", "This request is already running", false, command.id); return; }
    this.#submissions.add(command.id);
    try {
      await this.#submitOnce(command);
    } finally {
      this.#submissions.delete(command.id);
    }
  }

  async #submitOnce(command: Extract<BrokerCommand, { type: "submit" }>): Promise<void> {
    const provider = this.#providers.get(command.provider);
    if (provider === undefined) { this.#error("provider_unavailable", "The selected harness is not installed and authenticated", false, command.id); return; }
    const dangerousAutoApprove = command.dangerousAutoApprove === true
      && provider.policy.tools === "device-approval";
    this.#emit({ type: "state", id: command.id, state: "preparing", message: `Preparing ${provider.name}…` });
    const run = runAcpQuestion(
      provider, command.id, promptWithDesktopContext(command.question, command.desktopContext), command.model,
      this.#emit, 180_000, this.#images,
      (request) => this.#requestToolPermission(
        command.id, provider.id, request, dangerousAutoApprove),
      () => this.#cancelPermissions(command.id)
    );
    this.#runs.set(command.id, run);
    this.#emit({ type: "state", id: command.id, state: "streaming", message: `Waiting for ${provider.name}…` });
    try {
      const result = await run.result;
      const selectedModel = result.defaultModel ?? command.model;
      if (result.models.length > 0) {
        provider.models = result.models;
        if (result.defaultModel !== undefined) provider.defaultModel = result.defaultModel;
        this.#emit({ type: "providers", providers: [...this.#providers.values()].map(publicProvider) });
      }
      const chat: ChatRecord = {
        schemaVersion: 1,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        title: command.question.replaceAll(/\s+/g, " ").slice(0, 80),
        provider: provider.id,
        ...(selectedModel === undefined ? {} : { model: selectedModel }),
        question: command.question,
        answer: result.answer,
        images: result.images,
        session: {
          acpId: result.sessionId,
          ...(this.#env.HOME === undefined ? {} : { cwd: this.#env.HOME }),
          resumable: result.resumable,
          resumeKind: result.resumable ? "native" : "transcript"
        }
      };
      const evicted = await this.#history.save(chat);
      await this.#cleanupSessions(evicted);
      this.#emit({ type: "complete", chat: presentChat(chat) });
      this.#emit({ type: "state", id: command.id, state: "idle" });
    } catch (error) {
      if (error instanceof BrokerAcpError) this.#error(error.code, error.message, error.retryable, command.id);
      else this.#error("agent_failed", "The selected harness stopped unexpectedly", true, command.id);
    } finally {
      this.#cancelPermissions(command.id);
      this.#runs.delete(command.id);
    }
  }

  async #requestToolPermission(
    requestId: string,
    provider: ProviderId,
    request: RequestPermissionRequest,
    dangerousAutoApprove: boolean
  ): Promise<PermissionDecision> {
    const permissionId = randomUUID();
    const pending = normalizeToolPermission(requestId, permissionId, provider, request);
    if (pending === undefined) return { invalid: true };
    if (dangerousAutoApprove)
      return pending.allowOptionId === undefined
        ? { invalid: true }
        : { optionId: pending.allowOptionId };
    return new Promise<PermissionDecision>((resolvePermission) => {
      const timeout = setTimeout(() => {
        this.#permissions.delete(permissionId);
        this.#emit({ type: "permission_closed", id: requestId, permissionId, reason: "expired" });
        resolvePermission({});
      }, this.#permissionTimeoutMs);
      timeout.unref();
      this.#permissions.set(permissionId, { ...pending, resolve: resolvePermission, timeout });
      this.#emit({ type: "permission", permission: pending.view });
    });
  }

  #respondPermission(command: Extract<BrokerCommand, { type: "permission_response" }>): void {
    const pending = this.#permissions.get(command.permissionId);
    if (pending === undefined || pending.view.requestId !== command.id) return;
    this.#permissions.delete(command.permissionId);
    clearTimeout(pending.timeout);
    this.#emit({ type: "permission_closed", id: command.id, permissionId: command.permissionId, reason: "decided" });
    const optionId = command.decision === "allow_once" ? pending.allowOptionId : pending.rejectOptionId;
    pending.resolve(optionId === undefined ? {} : { optionId });
  }

  #cancelPermissions(requestId: string): void {
    for (const [permissionId, pending] of this.#permissions) {
      if (pending.view.requestId !== requestId) continue;
      this.#permissions.delete(permissionId);
      clearTimeout(pending.timeout);
      this.#emit({ type: "permission_closed", id: requestId, permissionId, reason: "cancelled" });
      pending.resolve({});
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
    const generation = ++this.#dictationGeneration;
    try {
      await this.#dictation.start();
      if (generation === this.#dictationGeneration) this.#emit({ type: "dictation", state: "recording" });
    } catch {
      if (generation === this.#dictationGeneration) this.#emit({ type: "dictation", state: "unavailable", message: "Voxtype is unavailable or not ready" });
    }
  }

  async #dictationStop(): Promise<void> {
    const generation = this.#dictationGeneration;
    this.#emit({ type: "dictation", state: "transcribing" });
    try {
      const text = await this.#dictation.stop();
      if (generation === this.#dictationGeneration) this.#emit({ type: "dictation", state: "idle", text });
    } catch {
      if (generation === this.#dictationGeneration) this.#emit({ type: "dictation", state: "unavailable", message: "Voxtype could not finish transcription" });
    }
  }

  async #dictationCancel(): Promise<void> {
    this.#dictationGeneration += 1;
    await this.#dictation.cancel();
    this.#emit({ type: "dictation", state: "idle" });
  }

  async #continue(chatId: string): Promise<void> {
    const existing = this.#handoffs.get(chatId);
    if (existing !== undefined) { await existing; return; }
    const flight = this.#runContinue(chatId);
    this.#handoffs.set(chatId, flight);
    try {
      await flight;
    } finally {
      if (this.#handoffs.get(chatId) === flight) this.#handoffs.delete(chatId);
    }
  }

  async #runContinue(chatId: string): Promise<void> {
    const chat = await this.#history.get(chatId);
    if (chat === undefined) { this.#emit({ type: "herdr", chatId, state: "failed", message: "Saved chat was not found" }); return; }
    this.#emit({ type: "herdr", chatId, state: "opening" });
    try {
      const result: HerdrResult = await this.#herdrContinue(chat, this.#env);
      this.#emit({ type: "herdr", chatId, state: "continued", mode: result.mode });
    } catch (error) {
      const failure = describeHerdrError(error);
      this.#emit({ type: "herdr", chatId, ...failure });
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

  async #cleanupSessions(chats: ChatRecord[]): Promise<void> {
    await Promise.allSettled(chats.map(async (chat) => {
      const sessionId = chat.session.acpId;
      const provider = this.#providers.get(chat.provider);
      if (sessionId !== undefined && provider !== undefined) await this.#sessionCleaner(provider, sessionId);
    }));
  }
}

function publicProvider(provider: DiscoveredProvider): ProviderInfo {
  return {
    id: provider.id,
    name: provider.name,
    models: provider.models,
    policy: provider.policy,
    ...(provider.version === undefined ? {} : { version: provider.version }),
    ...(provider.defaultModel === undefined ? {} : { defaultModel: provider.defaultModel })
  };
}
