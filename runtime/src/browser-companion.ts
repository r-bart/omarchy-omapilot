import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const semanticNodeSchema: z.ZodType<SemanticNode> = z.lazy(() => z.object({
  tag: text(40),
  role: optionalText(80),
  name: optionalText(500),
  text: optionalText(4_000),
  attributes: z.record(z.string().max(80), z.string().max(2_000)).optional(),
  children: z.array(semanticNodeSchema).max(40).optional()
}).strict());

const contextElementSchema = z.object({
  tag: text(40), role: optionalText(80), name: optionalText(500),
  text: optionalText(12_000), tree: semanticNodeSchema,
  rect: z.object({
    x: z.number().finite().min(-20_000).max(20_000),
    y: z.number().finite().min(-20_000).max(20_000),
    width: z.number().finite().min(0).max(20_000),
    height: z.number().finite().min(0).max(20_000)
  }).strict()
}).strict();

const browserMessageSchema = z.discriminatedUnion("type", [
  z.object({
    version: z.literal(1), type: z.literal("hello"),
    family: z.enum(["chromium", "firefox"]),
    browser: text(80), extensionVersion: text(40)
  }).strict(),
  z.object({
    version: z.literal(1), type: z.literal("probe.result"),
    requestId: text(120), available: z.boolean(),
    title: optionalText(500), url: optionalText(8_192), reason: optionalText(160)
  }).strict(),
  z.object({
    version: z.literal(1), type: z.literal("capture.result"),
    requestId: text(120), title: text(500), url: text(8_192),
    selection: optionalText(12_000),
    element: z.object({
      tag: text(40), role: optionalText(80), name: optionalText(500),
      text: optionalText(12_000),
      attributes: z.record(z.string().max(80), z.string().max(2_000)).optional(),
      ancestors: z.array(z.object({ tag: text(40), role: optionalText(80), name: optionalText(300) }).strict()).max(8),
      tree: semanticNodeSchema,
      context: contextElementSchema.optional(),
      rect: z.object({
        x: z.number().finite().min(-20_000).max(20_000),
        y: z.number().finite().min(-20_000).max(20_000),
        width: z.number().finite().min(0).max(20_000),
        height: z.number().finite().min(0).max(20_000)
      }).strict()
    }).strict()
  }).strict(),
  z.object({
    version: z.literal(1), type: z.literal("capture.cancelled"),
    requestId: text(120)
  }).strict(),
  z.object({
    version: z.literal(1), type: z.literal("capture.error"),
    requestId: text(120), reason: text(240)
  }).strict()
]);

export type SemanticNode = {
  tag: string;
  role?: string | undefined;
  name?: string | undefined;
  text?: string | undefined;
  attributes?: Record<string, string> | undefined;
  children?: SemanticNode[] | undefined;
};

export type BrowserCapture = Extract<z.infer<typeof browserMessageSchema>, { type: "capture.result" }>;
export type BrowserArmResult =
  | { status: "armed"; browser: string; title: string; url: string }
  | { status: "not-browser" | "unavailable" | "permission-required" };

type BrowserFamily = "chromium" | "firefox";
type BrowserSession = {
  socket: Socket;
  family: BrowserFamily;
  browser: string;
};
type ProbeResult = Extract<z.infer<typeof browserMessageSchema>, { type: "probe.result" }>;
type PendingProbe = {
  requestId: string;
  targetTitle?: string;
  responses: Array<{ session: BrowserSession; probe: ProbeResult }>;
  resolve: (result: BrowserArmResult) => void;
  timer: NodeJS.Timeout;
};

type BrowserCompanionCallbacks = {
  capture: (capture: BrowserCapture) => void | Promise<void>;
  cancelled: (requestId: string) => void;
  error: (requestId: string, reason: string) => void;
  statusChanged?: () => void;
};

export class BrowserCompanionServer {
  readonly socketPath: string;
  readonly #callbacks: BrowserCompanionCallbacks;
  readonly #sockets = new Set<Socket>();
  readonly #sessions = new Set<BrowserSession>();
  readonly #pendingProbes = new Map<string, PendingProbe>();
  readonly #armedCaptures = new Map<string, BrowserSession>();
  #server: Server | undefined;
  #ready?: Promise<void>;
  #closing = false;

  constructor(env: NodeJS.ProcessEnv, callbacks: BrowserCompanionCallbacks) {
    const configuredRuntimeRoot = env.XDG_RUNTIME_DIR?.trim();
    const runtimeRoot = configuredRuntimeRoot === undefined || configuredRuntimeRoot === ""
      ? join(env.HOME ?? "/tmp", ".cache") : configuredRuntimeRoot;
    this.socketPath = join(runtimeRoot, "omapilot", "browser-companion.sock");
    this.#callbacks = callbacks;
  }

  start(): Promise<void> {
    this.#ready ??= this.#listen();
    return this.#ready;
  }

  status(): { chromiumConnected: boolean; firefoxConnected: boolean } {
    const sessions = [...this.#sessions].filter((session) => !session.socket.destroyed);
    return {
      chromiumConnected: sessions.some((session) => session.family === "chromium"),
      firefoxConnected: sessions.some((session) => session.family === "firefox")
    };
  }

  async tryArm(requestId: string, appId?: string, targetTitle?: string): Promise<BrowserArmResult> {
    const family = browserFamily(appId);
    if (family === undefined) return { status: "not-browser" };
    await this.start();
    const sessions = [...this.#sessions].filter((session) => session.family === family && !session.socket.destroyed);
    if (sessions.length === 0) return { status: "unavailable" };
    return new Promise<BrowserArmResult>((resolve) => {
      const timer = setTimeout(() => this.#finishProbe(requestId), 350);
      timer.unref();
      this.#pendingProbes.set(requestId, {
        requestId,
        ...(targetTitle === undefined ? {} : { targetTitle }),
        responses: [], resolve, timer
      });
      for (const session of sessions) this.#send(session.socket, { version: 1, type: "probe", requestId });
    });
  }

  cancel(requestId: string): void {
    const pending = this.#pendingProbes.get(requestId);
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      this.#pendingProbes.delete(requestId);
      pending.resolve({ status: "unavailable" });
    }
    const armed = this.#armedCaptures.get(requestId);
    this.#armedCaptures.delete(requestId);
    if (armed !== undefined) this.#send(armed.socket, { version: 1, type: "capture.cancel", requestId });
    else for (const session of this.#sessions)
      this.#send(session.socket, { version: 1, type: "capture.cancel", requestId });
  }

  disconnect(): void {
    for (const pending of this.#pendingProbes.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ status: "unavailable" });
    }
    this.#pendingProbes.clear();
    this.#armedCaptures.clear();
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    this.#sessions.clear();
    if (!this.#closing) this.#callbacks.statusChanged?.();
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.disconnect();
    const server = this.#server;
    this.#server = undefined;
    if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(this.socketPath, { force: true });
  }

  async #listen(): Promise<void> {
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await rm(this.socketPath, { force: true });
    const server = createServer((socket) => this.#accept(socket));
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await chmod(this.socketPath, 0o600);
  }

  #accept(socket: Socket): void {
    this.#sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let session: BrowserSession | undefined;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > 1_100_000) { socket.destroy(); return; }
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let value: unknown;
        try { value = JSON.parse(line); } catch { socket.destroy(); return; }
        const parsed = browserMessageSchema.safeParse(value);
        if (!parsed.success) { socket.destroy(); return; }
        const message = parsed.data;
        if (message.type === "hello") {
          if (session !== undefined) { socket.destroy(); return; }
          session = { socket, family: message.family, browser: message.browser };
          this.#sessions.add(session);
          this.#send(socket, { version: 1, type: "hello.ack" });
          if (!this.#closing) this.#callbacks.statusChanged?.();
          continue;
        }
        if (session === undefined) { socket.destroy(); return; }
        this.#handle(session, message);
      }
    });
    socket.on("close", () => {
      this.#sockets.delete(socket);
      if (session !== undefined) {
        this.#sessions.delete(session);
        for (const [requestId, armed] of this.#armedCaptures) {
          if (armed !== session) continue;
          this.#armedCaptures.delete(requestId);
          if (!this.#closing)
            this.#callbacks.error(requestId, "The browser companion disconnected before capture completed");
        }
        if (!this.#closing) this.#callbacks.statusChanged?.();
      }
    });
    socket.on("error", () => socket.destroy());
  }

  #handle(session: BrowserSession, message: z.infer<typeof browserMessageSchema>): void {
    if (message.type === "probe.result") {
      const pending = this.#pendingProbes.get(message.requestId);
      if (pending === undefined) return;
      pending.responses.push({ session, probe: message });
      return;
    }
    if (message.type === "capture.result" || message.type === "capture.cancelled" || message.type === "capture.error") {
      if (this.#armedCaptures.get(message.requestId) !== session) return;
      this.#armedCaptures.delete(message.requestId);
      if (message.type === "capture.result") void this.#callbacks.capture(message);
      else if (message.type === "capture.cancelled") this.#callbacks.cancelled(message.requestId);
      else this.#callbacks.error(message.requestId, message.reason);
    }
  }

  #finishProbe(requestId: string): void {
    const pending = this.#pendingProbes.get(requestId);
    if (pending === undefined) return;
    this.#pendingProbes.delete(requestId);
    const available = pending.responses.filter(({ probe }) => probe.available && probe.title !== undefined && probe.url !== undefined);
    if (available.length === 0) {
      pending.resolve({ status: pending.responses.length > 0 ? "permission-required" : "unavailable" });
      return;
    }
    available.sort((left, right) =>
      titleScore(right.probe.title, pending.targetTitle) - titleScore(left.probe.title, pending.targetTitle));
    const selected = available[0];
    if (selected === undefined || selected.session.socket.destroyed
        || selected.probe.title === undefined || selected.probe.url === undefined) {
      pending.resolve({ status: "unavailable" });
      return;
    }
    const cancelledSessions = new Set<BrowserSession>();
    for (const candidate of available) {
      if (candidate.session === selected.session || cancelledSessions.has(candidate.session)) continue;
      cancelledSessions.add(candidate.session);
      this.#send(candidate.session.socket, { version: 1, type: "capture.cancel", requestId });
    }
    this.#armedCaptures.set(requestId, selected.session);
    this.#send(selected.session.socket, { version: 1, type: "capture.arm", requestId });
    pending.resolve({
      status: "armed", browser: selected.session.browser,
      title: selected.probe.title, url: selected.probe.url
    });
  }

  #send(socket: Socket, message: Record<string, unknown>): void {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }
}

function browserFamily(appId?: string): BrowserFamily | undefined {
  const value = appId?.trim().toLowerCase() ?? "";
  if (/^(?:chromium(?:-browser)?|google-chrome(?:-stable)?|chrome|brave-browser|brave-browser-beta|microsoft-edge(?:-stable|-dev)?|vivaldi-stable|helium)$/.test(value))
    return "chromium";
  if (/^(?:firefox|zen|zen-browser|librewolf)$/.test(value)) return "firefox";
  return undefined;
}

function normalizedTitle(value?: string): string {
  return (value ?? "")
    .replace(/\s+[—-]\s+(?:Google Chrome|Chromium|Brave|Microsoft Edge|Firefox|Zen Browser|LibreWolf)$/iu, "")
    .trim().toLocaleLowerCase();
}

function titleScore(candidate?: string, target?: string): number {
  const left = normalizedTitle(candidate);
  const right = normalizedTitle(target);
  if (left === "" || right === "") return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 50;
  return 0;
}
