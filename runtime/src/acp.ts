import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type { ContentBlock, NewSessionRequest, SessionConfigOption } from "@agentclientprotocol/sdk";
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

export function providerPolicyEnvironment(provider: DiscoveredProvider, capability: Capability): NodeJS.ProcessEnv {
  return secureEnvironment(provider, capability);
}

export async function probeAcpModels(provider: DiscoveredProvider, timeoutMs = 15_000): Promise<{ models: ModelOption[]; defaultModel?: string }> {
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
        if (!canRemoveSession(initialized.agentCapabilities)) return { models: [] };
        const session = await ctx.buildSession(sessionRequest(provider.id, cwd, "answer")).start();
        const config = modelConfiguration(session.newSessionResponse.configOptions ?? []);
        session.dispose();
        await removeSession(ctx, initialized.agentCapabilities, session.sessionId);
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
  imageStore = new ImageStore()
): AcpRun {
  const child = spawn(provider.agent.executable, provider.agent.args, {
    env: secureEnvironment(provider, capability),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });
  let cancelSession: (() => Promise<void>) | undefined;
  let cancelled = false;
  child.stderr?.resume();

  const cancel = async (): Promise<void> => {
    cancelled = true;
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

      const app = acp.client({ name: "omarchy-quickchat" })
        .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: "cancelled" } }))
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
        const newRequest = sessionRequest(provider.id, cwd, capability);
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
        for (;;) {
          const update = await session.nextUpdate();
          if (update.kind === "stop") break;
          const content = update.update.sessionUpdate === "agent_message_chunk" ? update.update.content : undefined;
          if (content === undefined) continue;
          const handled = await handleContent(content, requestId, emit, imageStore, images.length);
          if (handled.text !== undefined) answer += handled.text;
          if (handled.image !== undefined) images.push(handled.image);
        }
        await promptPromise;
        session.dispose();
      });

      if (cancelled) throw new BrokerAcpError("cancelled", "Question was cancelled", false);
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
    const features = Object.fromEntries((provider.lockdownFeatures ?? []).map((feature) => [feature, false]));
    const config = {
      approval_policy: "never",
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

function sessionRequest(provider: DiscoveredProvider["id"], cwd: string, capability: Capability): NewSessionRequest {
  const base: NewSessionRequest = { cwd, mcpServers: [] };
  if (provider !== "claude") return base;
  const tools = capability === "web" ? ["WebSearch", "WebFetch"] : [];
  return {
    ...base,
    _meta: {
      systemPrompt: "Answer the user's question directly and concisely. Do not access local files or execute commands.",
      claudeCode: {
        options: {
          tools,
          disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit", "Task", "Agent", "WebSearch", "WebFetch"].filter((tool) => !tools.includes(tool)),
          settingSources: []
        }
      }
    }
  };
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
  emit: (event: BrokerEvent) => void,
  imageStore: ImageStore,
  imageCount: number
): Promise<{ text?: string; image?: StoredImage }> {
  if (content.type === "text") {
    emit({ type: "content", id: requestId, delta: content.text });
    return { text: content.text };
  }
  if (content.type === "image" && imageCount < 4) {
    const image = await imageStore.saveBase64(content.data, content.mimeType, content.uri ?? undefined);
    emit({ type: "image", id: requestId, image: presentImage(image) });
    return { image };
  }
  if (content.type === "resource_link") {
    const markdown = `[${escapeMarkdown(content.title ?? content.name)}](${content.uri})`;
    emit({ type: "content", id: requestId, delta: markdown });
    return { text: markdown };
  }
  if (content.type === "resource" && "text" in content.resource) {
    emit({ type: "content", id: requestId, delta: content.resource.text });
    return { text: content.resource.text };
  }
  return {};
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
