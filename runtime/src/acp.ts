import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as acp from "@agentclientprotocol/sdk";
import type { ContentBlock, NewSessionRequest, RequestPermissionRequest, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { DiscoveredProvider } from "./providers.js";
import type { BrokerEvent, Capability, ModelOption, StoredImage } from "./types.js";
import { ImageStore } from "./images.js";
import { presentImage } from "./history.js";
import { quickchatPaths } from "./paths.js";
import { runCommand, terminateProcessGroup } from "./process.js";

export type AcpResult = {
  answer: string;
  images: StoredImage[];
  sessionId: string;
  models: ModelOption[];
  defaultModel?: string;
  resumable: boolean;
};

export type AcpRun = { result: Promise<AcpResult>; cancel: () => Promise<void> };
export type PermissionHandler = (request: RequestPermissionRequest) => Promise<string | undefined>;

export function providerPolicyEnvironment(provider: DiscoveredProvider, capability: Capability): NodeJS.ProcessEnv {
  return secureEnvironment(provider, capability);
}

export async function probeAcpModels(provider: DiscoveredProvider, timeoutMs = 15_000): Promise<{ models: ModelOption[]; defaultModel?: string }> {
  if (provider.id === "codex") return probeCodexModels(provider, timeoutMs);
  const child = spawn(provider.agent.executable, provider.agent.args, {
    env: secureEnvironment(provider, "answer"), stdio: ["pipe", "pipe", "ignore"], detached: process.platform !== "win32"
  });
  const paths = quickchatPaths(provider.agent.env);
  await mkdir(paths.runtime, { recursive: true, mode: 0o700 });
  const cwd = await mkdtemp(join(paths.runtime, "probe-"));
  const timeout = setTimeout(() => terminateProcessGroup(child.pid), timeoutMs);
  timeout.unref();
  try {
    if (child.stdin === null || child.stdout === null) return { models: [] };
    const stream = acp.ndJsonStream(
      webWritable(child),
      webReadable(child)
    );
    return await acp.client({ name: "omarchy-quickchat-probe" })
      .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: "cancelled" } }))
      .connectWith(stream, async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { session: { configOptions: { boolean: {} } } },
          clientInfo: { name: "omarchy-quickchat", version: "0.1.0" }
        });
        const ephemeral = provider.id === "claude";
        if (!ephemeral && !canRemoveSession(initialized.agentCapabilities)) return { models: [] };
        const session = await ctx.buildSession(providerSessionRequest(provider, cwd, "answer", ephemeral)).start();
        const config = modelConfiguration(session.newSessionResponse.configOptions ?? []);
        session.dispose();
        if (!ephemeral) await removeSession(ctx, initialized.agentCapabilities, session.sessionId);
        return { models: config.models, ...(config.current === undefined ? {} : { defaultModel: config.current }) };
      });
  } catch {
    return { models: [] };
  } finally {
    clearTimeout(timeout);
    terminateProcessGroup(child.pid);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function probeCodexModels(provider: DiscoveredProvider, timeoutMs: number): Promise<{ models: ModelOption[]; defaultModel?: string }> {
  const maximumResponseLineBytes = 4 * 1024 * 1024;
  const featureArgs = (provider.lockdownFeatures ?? []).flatMap((feature) => ["-c", `features.${feature}=false`]);
  const child = spawn(provider.harnessPath, [
    "app-server", "--strict-config",
    "-c", 'approval_policy="on-request"',
    "-c", 'sandbox_mode="read-only"',
    "-c", 'web_search="disabled"',
    "-c", "mcp_servers={}",
    ...featureArgs,
    "--listen", "stdio://"
  ], { env: provider.agent.env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32" });
  child.stderr?.resume();
  try {
    if (child.stdin === null || child.stdout === null) return { models: [] };
    const catalog = await new Promise<unknown>((resolveCatalog, rejectCatalog) => {
      let settled = false;
      const timeout = setTimeout(() => finish(() => rejectCatalog(new Error("Codex model discovery timed out"))), timeoutMs);
      timeout.unref();
      const lines = createInterface({ input: child.stdout });
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        lines.close();
        callback();
      };
      child.once("error", (error) => finish(() => rejectCatalog(error)));
      child.once("close", () => finish(() => rejectCatalog(new Error("Codex app server stopped during model discovery"))));
      lines.on("line", (line) => {
        if (Buffer.byteLength(line, "utf8") > maximumResponseLineBytes) {
          finish(() => rejectCatalog(new Error("Codex model response exceeded the size limit")));
          return;
        }
        let message: unknown;
        try { message = JSON.parse(line); } catch { return; }
        if (!isObject(message) || typeof message.id !== "number") return;
        if (message.id === 1) {
          if ("error" in message) { finish(() => rejectCatalog(new Error("Codex initialization failed"))); return; }
          child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
          child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "model/list", params: {} })}\n`);
        } else if (message.id === 2) {
          if ("error" in message) { finish(() => rejectCatalog(new Error("Codex model discovery failed"))); return; }
          finish(() => resolveCatalog(message.result));
        }
      });
      child.stdin?.write(`${JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { clientInfo: { name: "omarchy-quickchat", version: "0.1.0" }, capabilities: { experimentalApi: true, requestAttestation: false } }
      })}\n`);
    });
    return parseCodexModelCatalog(catalog);
  } catch {
    return { models: [] };
  } finally {
    terminateProcessGroup(child.pid);
  }
}

export function parseCodexModelCatalog(value: unknown): { models: ModelOption[]; defaultModel?: string } {
  if (!isObject(value) || !Array.isArray(value.data)) return { models: [] };
  const models: ModelOption[] = [];
  const modelIds = new Set<string>();
  let defaultModel: string | undefined;
  for (const item of value.data) {
    if (!isObject(item) || item.hidden === true || typeof item.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,127}$/u.test(item.id)) continue;
    if (modelIds.has(item.id) || models.length >= 100) continue;
    modelIds.add(item.id);
    const name = typeof item.displayName === "string" && item.displayName.trim() !== "" ? item.displayName.trim() : item.id;
    const description = typeof item.description === "string" && item.description.trim() !== "" ? item.description.trim().slice(0, 240) : undefined;
    models.push({ id: item.id, name: name.slice(0, 120), ...(description === undefined ? {} : { description }) });
    if (item.isDefault === true) defaultModel = item.id;
  }
  return { models, ...(defaultModel === undefined ? {} : { defaultModel }) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function deleteAcpSession(provider: DiscoveredProvider, sessionId: string, timeoutMs = 15_000): Promise<boolean> {
  const child = spawn(provider.agent.executable, provider.agent.args, {
    env: secureEnvironment(provider, "answer"), stdio: ["pipe", "pipe", "ignore"], detached: process.platform !== "win32"
  });
  const timeout = setTimeout(() => terminateProcessGroup(child.pid), timeoutMs);
  timeout.unref();
  try {
    if (child.stdin === null || child.stdout === null) return false;
    const deleted = await acp.client({ name: "omarchy-quickchat-cleanup" })
      .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: "cancelled" } }))
      .connectWith(acp.ndJsonStream(webWritable(child), webReadable(child)), async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "omarchy-quickchat", version: "0.1.0" }
        });
        return removeSession(ctx, initialized.agentCapabilities, sessionId);
      });
    if (deleted) return true;
    if (provider.id === "opencode") {
      const fallback = await runCommand(provider.harnessPath, ["--pure", "session", "delete", sessionId], {
        env: provider.agent.env,
        timeoutMs,
        maxOutput: 32_768
      });
      return fallback.code === 0;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    terminateProcessGroup(child.pid);
  }
}

export function runAcpQuestion(
  provider: DiscoveredProvider,
  requestId: string,
  question: string,
  model: string | undefined,
  capability: Capability,
  emit: (event: BrokerEvent) => void,
  timeoutMs = 90_000,
  imageStore = new ImageStore(),
  requestPermission?: PermissionHandler,
  cancelPermissions?: () => void
): AcpRun {
  const child = spawn(provider.agent.executable, provider.agent.args, {
    env: secureEnvironment(provider, capability),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });
  let cancelSession: (() => Promise<void>) | undefined;
  let cancelled = false;
  let forbiddenToolAttempt = false;
  child.stderr?.resume();

  const cancel = async (): Promise<void> => {
    cancelled = true;
    cancelPermissions?.();
    if (cancelSession !== undefined) await cancelSession().catch(() => undefined);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    terminateProcessGroup(child.pid);
  };

  const result = (async (): Promise<AcpResult> => {
    const paths = quickchatPaths(provider.agent.env);
    await mkdir(paths.runtime, { recursive: true, mode: 0o700 });
    const cwd = await mkdtemp(join(paths.runtime, "chat-"));
    const timeout = setTimeout(() => { void cancel(); }, timeoutMs);
    timeout.unref();
    try {
      if (child.stdin === null || child.stdout === null) throw new Error("ACP process streams are unavailable");
      const stream = acp.ndJsonStream(webWritable(child), webReadable(child));
      let answer = "";
      const images: StoredImage[] = [];
      let sessionIdentifier = "";
      let modelOptions: ModelOption[] = [];
      let defaultModel: string | undefined;
      let resumable = false;

      const text = new GuardedTextEmitter(requestId, emit);
      const app = acp.client({ name: "omarchy-quickchat" })
        .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
          if (capability !== "tools" || requestPermission === undefined) {
            forbiddenToolAttempt = true;
            return { outcome: { outcome: "cancelled" } };
          }
          const optionId = await requestPermission(params);
          return optionId === undefined
            ? { outcome: { outcome: "cancelled" } }
            : { outcome: { outcome: "selected", optionId } };
        })
        .onRequest(acp.methods.client.fs.readTextFile, () => { throw new Error("Quickchat does not expose filesystem reads"); })
        .onRequest(acp.methods.client.fs.writeTextFile, () => { throw new Error("Quickchat does not expose filesystem writes"); })
        .onRequest(acp.methods.client.terminal.create, () => { throw new Error("Quickchat does not expose a terminal"); })
        .onRequest(acp.methods.client.terminal.output, () => { throw new Error("Quickchat does not expose a terminal"); })
        .onRequest(acp.methods.client.terminal.release, () => { throw new Error("Quickchat does not expose a terminal"); })
        .onRequest(acp.methods.client.terminal.waitForExit, () => { throw new Error("Quickchat does not expose a terminal"); })
        .onRequest(acp.methods.client.terminal.kill, () => { throw new Error("Quickchat does not expose a terminal"); });

      await app.connectWith(stream, async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { session: { configOptions: { boolean: {} } } },
          clientInfo: { name: "omarchy-quickchat", version: "0.1.0" }
        });
        if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) throw new Error("ACP protocol version is unsupported");
        resumable = initialized.agentCapabilities?.loadSession === true;
        const newRequest = providerSessionRequest(provider, cwd, capability);
        const session = await ctx.buildSession(newRequest).start();
        sessionIdentifier = session.sessionId;
        cancelSession = async () => {
          await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
        };
        const modelConfig = modelConfiguration(session.newSessionResponse.configOptions ?? []);
        modelOptions = modelConfig.models;
        defaultModel = modelConfig.current;
        if (provider.id === "codex") {
          await ctx.request(acp.methods.agent.session.setMode, { sessionId: session.sessionId, modeId: "read-only" });
        }
        if (model !== undefined && modelConfig.configId !== undefined && modelConfig.models.some((option) => option.id === model)) {
          await ctx.request(acp.methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: modelConfig.configId,
            value: model
          });
          defaultModel = model;
        }
        const promptPromise = session.prompt(question);
        try {
          for (;;) {
            const update = await session.nextUpdate();
            if (forbiddenToolAttempt) {
              await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
              break;
            }
            if (update.kind === "stop") break;
            if (capability === "answer" && isToolUpdate(update.update.sessionUpdate)) {
              forbiddenToolAttempt = true;
              await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
              break;
            }
            const content = update.update.sessionUpdate === "agent_message_chunk" ? update.update.content : undefined;
            if (content === undefined) continue;
            const handled = await handleContent(content, requestId, text, emit, imageStore, images.length);
            if (handled.text !== undefined) answer += handled.text;
            if (handled.image !== undefined) images.push(handled.image);
          }
          await promptPromise;
          if (forbiddenToolAttempt) throw forbiddenToolError(provider, capability);
          text.finish();
        } catch (error) {
          await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId }).catch(() => undefined);
          await promptPromise.catch(() => undefined);
          throw error;
        }
        session.dispose();
      });

      if (cancelled) throw new BrokerAcpError("cancelled", "Question was cancelled", false);
      if (forbiddenToolAttempt) throw forbiddenToolError(provider, capability);
      return {
        answer,
        images,
        sessionId: sessionIdentifier,
        models: modelOptions,
        ...(defaultModel === undefined ? {} : { defaultModel }),
        resumable
      };
    } catch (error) {
      if (error instanceof BrokerAcpError) throw error;
      if (error instanceof ForbiddenToolMarkupError || forbiddenToolAttempt) throw forbiddenToolError(provider, capability);
      throw new BrokerAcpError(
        cancelled ? "cancelled" : "agent_failed",
        cancelled ? "Question was cancelled" : "The selected harness failed to answer",
        !cancelled
      );
    } finally {
      clearTimeout(timeout);
      terminateProcessGroup(child.pid);
      await rm(cwd, { recursive: true, force: true });
    }
  })();
  return { result, cancel };
}

function secureEnvironment(provider: DiscoveredProvider, capability: Capability): NodeJS.ProcessEnv {
  if (provider.id === "codex") {
    const features = Object.fromEntries((provider.lockdownFeatures ?? [])
      .map((feature) => [feature, capability === "tools" && (feature === "shell_tool" || feature === "unified_exec")]));
    const config = {
      // Codex read-only still permits reads; on-request routes command attempts
      // to Quickchat's exact allow-once handler in Tools and deny-all handler in
      // Answer/Web.
      approval_policy: "on-request",
      sandbox_mode: "read-only",
      web_search: capability === "web" ? "live" : "disabled",
      mcp_servers: {},
      features
    };
    return { ...provider.agent.env, CODEX_CONFIG: JSON.stringify(config), INITIAL_AGENT_MODE: "read-only" };
  }
  if (provider.id === "opencode") {
    const permission = capability === "web" ? { "*": "deny", websearch: "allow", webfetch: "allow" } : { "*": "deny" };
    return { ...provider.agent.env, OPENCODE_PERMISSION: JSON.stringify(permission) };
  }
  return provider.agent.env;
}

function canRemoveSession(capabilities: acp.AgentCapabilities | null | undefined): boolean {
  return capabilities?.sessionCapabilities?.delete !== undefined && capabilities.sessionCapabilities.delete !== null;
}

async function removeSession(
  ctx: acp.ClientContext,
  capabilities: acp.AgentCapabilities | null | undefined,
  sessionId: string
): Promise<boolean> {
  if (capabilities?.sessionCapabilities?.delete !== undefined && capabilities.sessionCapabilities.delete !== null) {
    await ctx.request(acp.methods.agent.session.delete, { sessionId });
    return true;
  }
  return false;
}

export function providerSessionRequest(provider: DiscoveredProvider, cwd: string, capability: Capability, ephemeral = false): NewSessionRequest {
  const base: NewSessionRequest = { cwd, mcpServers: [] };
  if (provider.id !== "claude") return base;
  const tools = capability === "tools"
    ? ["Bash"]
    : capability === "web" ? ["WebSearch", "WebFetch"] : [];
  const systemPrompt = capability === "tools"
    ? "Answer the user's question directly and concisely. You may use Bash only inside the isolated disposable workspace. Host files, credentials, network, and writes outside that workspace are unavailable."
    : "Answer the user's question directly and concisely. Do not access local files or execute commands.";
  return {
    ...base,
    _meta: {
      systemPrompt,
      claudeCode: {
        options: {
          tools,
          ...(ephemeral ? { persistSession: false } : {}),
          disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit", "Task", "Agent", "WebSearch", "WebFetch"].filter((tool) => !tools.includes(tool)),
          settingSources: [],
          ...(capability === "tools" ? {
            settings: {
              permissions: {
                ask: ["Bash(*)"],
                deny: ["Write(*)", "Edit(*)", "NotebookEdit(*)", "Task(*)", "Agent(*)"],
                disableBypassPermissionsMode: "disable"
              }
            },
            sandbox: {
              enabled: true,
              failIfUnavailable: true,
              autoAllowBashIfSandboxed: false,
              allowUnsandboxedCommands: false,
              network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowUnixSockets: [] },
              filesystem: {
                denyRead: sandboxDeniedReadPaths(),
                allowRead: [cwd, "/dev/null", "/etc/ld.so.cache"],
                denyWrite: ["/"],
                allowWrite: [cwd]
              },
              credentials: {
                envVars: sandboxCredentialEnvironment(provider.agent.env)
              }
            }
          } : {})
        }
      }
    }
  };
}

const SANDBOX_SYSTEM_ROOTS = new Set(["bin", "sbin", "lib", "lib64", "usr"]);

function sandboxDeniedReadPaths(): string[] {
  // Discover the actual root at turn creation rather than maintaining an
  // incomplete list. Only executable/library roots remain generally readable;
  // /usr/local is host-managed data and is denied separately.
  return [
    ...readdirSync("/").filter((name) => !SANDBOX_SYSTEM_ROOTS.has(name)).map((name) => `/${name}`),
    "/usr/local"
  ].sort();
}

function sandboxCredentialEnvironment(env: NodeJS.ProcessEnv): Array<{ name: string; mode: "deny" }> {
  const safe = /^(?:PATH|LANG|LC_[A-Z0-9_]+|TERM|COLORTERM|SHELL)$/u;
  return Object.keys(env)
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) && !safe.test(name))
    .sort()
    .map((name) => ({ name, mode: "deny" as const }));
}

export function modelConfiguration(options: SessionConfigOption[]): { configId?: string; current?: string; models: ModelOption[] } {
  const option = options.find((item) => item.type === "select" && (item.category === "model" || item.id.toLowerCase().includes("model")));
  if (option === undefined || option.type !== "select") return { models: [] };
  const flat = option.options.flatMap((item) => "options" in item ? item.options : [item]);
  return {
    configId: option.id,
    current: option.currentValue,
    models: flat.map((item) => ({ id: item.value, name: item.name, ...(item.description === undefined || item.description === null ? {} : { description: item.description }) }))
  };
}

async function handleContent(
  content: ContentBlock,
  requestId: string,
  text: GuardedTextEmitter,
  emit: (event: BrokerEvent) => void,
  imageStore: ImageStore,
  imageCount: number
): Promise<{ text?: string; image?: StoredImage }> {
  if (content.type === "text") {
    text.write(content.text);
    return { text: content.text };
  }
  if (content.type === "image" && imageCount < 4) {
    text.finish();
    const image = await imageStore.saveBase64(content.data, content.mimeType, content.uri ?? undefined);
    emit({ type: "image", id: requestId, image: presentImage(image) });
    return { image };
  }
  if (content.type === "resource_link") {
    text.finish();
    const markdown = `[${escapeMarkdown(content.title ?? content.name)}](${content.uri})`;
    emit({ type: "content", id: requestId, delta: markdown });
    return { text: markdown };
  }
  if (content.type === "resource" && "text" in content.resource) {
    text.write(content.resource.text);
    return { text: content.resource.text };
  }
  return {};
}

const TEXT_GUARD_TAIL = 64;

class GuardedTextEmitter {
  #pending = "";

  constructor(readonly requestId: string, readonly emit: (event: BrokerEvent) => void) {}

  write(delta: string): void {
    this.#pending += delta;
    if (containsToolMarkup(this.#pending)) throw new ForbiddenToolMarkupError();
    if (this.#pending.length <= TEXT_GUARD_TAIL) return;
    const boundary = this.#pending.length - TEXT_GUARD_TAIL;
    this.emit({ type: "content", id: this.requestId, delta: this.#pending.slice(0, boundary) });
    this.#pending = this.#pending.slice(boundary);
  }

  finish(): void {
    if (containsToolMarkup(this.#pending)) throw new ForbiddenToolMarkupError();
    if (this.#pending !== "") this.emit({ type: "content", id: this.requestId, delta: this.#pending });
    this.#pending = "";
  }
}

function containsToolMarkup(value: string): boolean {
  return /<\/?(?:[|｜]{1,2}\s*DSML\s*[|｜]{1,2}\s*)?(?:tool[_ -]?calls?|function[_ -]?calls?|invoke|parameter)\b/iu.test(value);
}

function isToolUpdate(kind: string): boolean {
  return kind === "tool_call" || kind === "tool_call_update";
}

function forbiddenToolError(provider: DiscoveredProvider, capability: Capability): BrokerAcpError {
  if (capability !== "tools" && provider.capabilities.includes("tools")) {
    return new BrokerAcpError("tool_mode_required", "This request needs Tools mode. Select Tools and try again", false);
  }
  return new BrokerAcpError("forbidden_tool_attempt", "The harness attempted a tool that Quickchat does not permit", false);
}

class ForbiddenToolMarkupError extends Error {
  constructor() {
    super("Provider returned raw tool-call markup");
    this.name = "ForbiddenToolMarkupError";
  }
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/[\\[\]]/g, "\\$&");
}

export class BrokerAcpError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "BrokerAcpError";
  }
}

export function childIsRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

export function defaultTemporaryRoot(): string {
  return join(tmpdir(), "quickchat");
}

function webWritable(child: ChildProcess): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolveWrite, rejectWrite) => {
        child.stdin?.write(chunk, (error) => error === null ? resolveWrite() : rejectWrite(error));
      });
    },
    close() { child.stdin?.end(); },
    abort() { child.stdin?.destroy(); }
  });
}

function webReadable(child: ChildProcess): ReadableStream<Uint8Array> {
  const maxFrameBytes = 8 * 1024 * 1024;
  let currentFrameBytes = 0;
  let settled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        for (const byte of chunk) {
          currentFrameBytes = byte === 0x0a ? 0 : currentFrameBytes + 1;
          if (currentFrameBytes > maxFrameBytes) {
            settled = true;
            controller.error(new Error("ACP frame exceeds the Quickchat limit"));
            child.stdout?.destroy();
            terminateProcessGroup(child.pid);
            return;
          }
        }
        controller.enqueue(chunk);
      });
      child.stdout?.once("end", () => {
        if (!settled) { settled = true; controller.close(); }
      });
      child.stdout?.once("error", (error) => {
        if (!settled) { settled = true; controller.error(error); }
      });
    },
    cancel() { settled = true; child.stdout?.destroy(); }
  });
}
