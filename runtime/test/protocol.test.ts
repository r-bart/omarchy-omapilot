import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { commandSchema } from "../src/types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("NDJSON protocol", () => {
  it("executes the checked-in Codex ACP adapter without duplicate script headers", async () => {
    const child = spawn(resolve("runtime/bin/codex-acp"), ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    const code = await new Promise<number | null>((resolveExit) => child.once("close", resolveExit));
    expect(code).toBe(0);
    expect(output).toContain("@agentclientprotocol/codex-acp");
  });

  it("normalizes a blank model and ignores a legacy capability field", () => {
    const parsed = commandSchema.parse({ type: "submit", id: "one", question: "hello", provider: "codex", model: "", capability: "answer" });
    expect(parsed.type === "submit" ? parsed.model : "wrong-command").toBeUndefined();
    expect(parsed).not.toHaveProperty("capability");
  });

  it("rejects malformed commands", () => {
    expect(commandSchema.safeParse({ type: "submit", id: "one", question: "", provider: "codex" }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "permission_response", id: "one", permissionId: "not-a-uuid", decision: "allow_always" }).success).toBe(false);
  });

  it("rejects incompatible protocol versions without becoming ready", async () => {
    const child = spawn(brokerExecutable(), [], { stdio: ["pipe", "pipe", "pipe"] });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":1}\n');
    await until(() => events.some((event) => event.code === "unsupported_protocol"));
    expect(events.some((event) => event.type === "ready")).toBe(false);
    expect(events.find((event) => event.code === "unsupported_protocol")?.message).toBe("Quickchat supports broker protocol version 2");
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  });

  it("rejects initialize without an explicit protocol version", async () => {
    const child = spawn(brokerExecutable(), [], { stdio: ["pipe", "pipe", "pipe"] });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize"}\n');
    await until(() => events.some((event) => event.code === "invalid_command"));
    expect(events.some((event) => event.type === "ready")).toBe(false);
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  });

  it("initializes, exposes models, streams markdown, and stores completion", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-protocol-")); roots.push(state);
    const fake = resolve("runtime/test/fake-acp-agent.mjs");
    const audit = join(state, "acp-audit.txt");
    const launcher = brokerExecutable();
    const env = {
      ...process.env,
      XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
      QUICKCHAT_CODEX_ACP: fake, QUICKCHAT_CLAUDE_ACP: fake,
      FAKE_ACP_AUDIT_FILE: audit,
      PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
    };
    const child = spawn(launcher, [], { env, stdio: ["pipe", "pipe", "pipe"] });
    const events: Record<string, unknown>[] = [];
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => events.push(parseObject(line)));
    child.stdin.write(`${JSON.stringify({ type: "initialize", protocolVersion: 2, client: "test" })}\n`);
    await until(() => events.some((event) => event.type === "ready"));
    const ready = readySchema.parse(events.find((event) => event.type === "ready"));
    expect(ready.protocolVersion).toBe(2);
    expect(ready.providers.find((provider) => provider.id === "codex")?.models).toContainEqual({ id: "test/default", name: "Default" });
    expect(ready.providers.map(({ id, policy }) => ({ id, policy }))).toEqual([
      { id: "codex", policy: { tools: "device-approval", web: "approved-command", hostReads: true } },
      { id: "opencode", policy: { tools: "blocked", web: "search", hostReads: false } }
    ]);
    expect(JSON.stringify(events.find((event) => event.type === "ready"))).not.toContain('"capabilities"');
    child.stdin.write(`${JSON.stringify({ type: "submit", id: "wire-1", question: "Say hello", provider: "codex" })}\n`);
    await until(() => events.some((event) => event.type === "complete"));
    expect(events).toContainEqual({ type: "content", id: "wire-1", delta: "# Answer\n\nHello [link](https://example.com)." });
    const complete = completeSchema.parse(events.find((event) => event.type === "complete"));
    expect(complete.chat.answer).toContain("Hello");
    const saved = await readFile(join(state, "state/quickchat/chats", `${complete.chat.id}.json`), "utf8");
    expect(saved).not.toContain("localUrl");
    child.stdin.write(`${JSON.stringify({ type: "history_delete", chatId: complete.chat.id })}\n`);
    await until(async () => (await readFile(audit, "utf8")).trim() === "delete:fake-1");
    child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 25_000);

  it("refreshes provider models from the real answer session", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-late-models-")); roots.push(state);
    const child = spawn(brokerExecutable(), [], {
      env: {
        ...process.env,
        XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
        PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
    await until(() => events.some((event) => event.type === "ready"));
    const ready = readySchema.parse(events.find((event) => event.type === "ready"));
    expect(ready.providers.find((provider) => provider.id === "codex")?.models).toContainEqual({ id: "test/default", name: "Default" });
    child.stdin.write('{"type":"submit","id":"late-models","question":"hello","provider":"codex"}\n');
    await until(() => events.some((event) => event.type === "providers"));
    const update = readySchema.shape.providers.parse(events.find((event) => event.type === "providers")?.providers);
    expect(update.find((provider) => provider.id === "codex")?.models).toContainEqual({ id: "test/default", name: "Default" });
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 20_000);

  it("routes action-shaped prompts through ACP without broker hardcoding", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-action-prompt-")); roots.push(state);
    const audit = join(state, "prompt-audit.txt");
    const child = spawn(brokerExecutable(), [], {
      env: {
        ...process.env,
        FAKE_ACP_PROMPT_AUDIT: audit,
        XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
        PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
    await until(() => events.some((event) => event.type === "ready"));
    child.stdin.write('{"type":"submit","id":"action-shaped","question":"open zoom","provider":"codex"}\n');
    await until(() => events.some((event) => event.type === "complete"));
    expect(await readFile(audit, "utf8")).toBe("prompt\n");
    expect(events.some((event) => event.type === "permission" && JSON.stringify(event).includes("local_action"))).toBe(false);
    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({ type: "complete", chat: { question: "open zoom" } });
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 20_000);

  it("fails closed when automatic OpenCode attempts a device tool", async () => {
    const events = await forbiddenAttempt("opencode", { FAKE_ACP_PERMISSION_ATTEMPT: "1" });
    expect(events.find((event) => event.type === "error")).toMatchObject({
      code: "forbidden_tool_attempt",
      message: "The selected harness attempted a device tool that Quickchat cannot safely authorize",
      retryable: false
    });
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(events.some((event) => event.type === "content")).toBe(false);
  }, 20_000);

  it.each(["codex", "claude"] as const)("round-trips a bounded allow-once tool decision for %s without exposing provider option IDs", async (provider) => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-tool-permission-")); roots.push(state);
    const child = spawn(brokerExecutable(), [], {
      env: {
        ...process.env,
        FAKE_ACP_PERMISSION_ATTEMPT: "1",
        FAKE_ACP_EXPECT_ALLOW: "1",
        XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
        QUICKCHAT_CLAUDE_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
        PATH: `${resolve("runtime/test/fixtures/claude-auth")}:${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
    await until(() => events.some((event) => event.type === "ready"));
    child.stdin.write(`${JSON.stringify({ type: "submit", id: "tool-turn", question: "Run uname", provider })}\n`);
    await until(() => events.some((event) => event.type === "permission"));
    const permission = z.object({
      type: z.literal("permission"),
      permission: z.object({ id: z.string().uuid(), requestId: z.literal("tool-turn"), kind: z.literal("execute"), detail: z.string(), allowOnce: z.literal(true) })
    }).parse(events.find((event) => event.type === "permission"));
    expect(permission.permission.detail).toBe('{\n  "command": "uname -s"\n}');
    expect(JSON.stringify(permission)).not.toContain("provider-allow");
    child.stdin.write(`${JSON.stringify({ type: "permission_response", id: "tool-turn", permissionId: permission.permission.id, decision: "allow_once" })}\n`);
    await until(() => events.some((event) => event.type === "complete"));
    expect(events).toContainEqual({ type: "permission_closed", id: "tool-turn", permissionId: permission.permission.id, reason: "decided" });
    expect(events.some((event) => event.type === "error")).toBe(false);
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 25_000);

  it("round-trips a deny decision and lets the harness answer without the tool", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-tool-deny-")); roots.push(state);
    const child = spawn(brokerExecutable(), [], {
      env: {
        ...process.env,
        FAKE_ACP_PERMISSION_ATTEMPT: "1",
        XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
        QUICKCHAT_CLAUDE_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
        PATH: `${resolve("runtime/test/fixtures/claude-auth")}:${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
    await until(() => events.some((event) => event.type === "ready"));
    child.stdin.write('{"type":"submit","id":"deny-turn","question":"Do not run it","provider":"claude"}\n');
    await until(() => events.some((event) => event.type === "permission"));
    const permission = z.object({ type: z.literal("permission"), permission: z.object({ id: z.string().uuid() }) })
      .parse(events.find((event) => event.type === "permission"));
    child.stdin.write(`${JSON.stringify({ type: "permission_response", id: "deny-turn", permissionId: permission.permission.id, decision: "reject_once" })}\n`);
    await until(() => events.some((event) => event.type === "complete"));
    expect(events).toContainEqual({ type: "permission_closed", id: "deny-turn", permissionId: permission.permission.id, reason: "decided" });
    expect(events.some((event) => event.type === "error")).toBe(false);
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 25_000);

  it("rejects OpenCode DSML tool syntax before it reaches streamed content or history", async () => {
    const events = await forbiddenAttempt("opencode", { FAKE_ACP_RAW_TOOL_MARKUP: "1" });
    expect(events.find((event) => event.type === "error")).toMatchObject({ code: "forbidden_tool_attempt", retryable: false });
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(events.filter((event) => event.type === "content").map((event) => JSON.stringify(event)).join(""))
      .not.toContain("DSML");
  }, 20_000);

  it("never forwards provider stderr or exception details", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-errors-")); roots.push(state);
    const child = spawn(brokerExecutable(), [], {
      env: {
        ...process.env, FAKE_ACP_FAIL_SECRET: "1", XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"), PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
    await until(() => events.some((event) => event.type === "ready"));
    child.stdin.write('{"type":"submit","id":"fail","question":"fail","provider":"codex"}\n');
    await until(() => events.some((event) => event.type === "error"));
    const error = events.find((event) => event.type === "error");
    expect(error?.message).toBe("The selected harness failed to answer");
    expect(JSON.stringify(error)).not.toContain("person@example.com");
    expect(JSON.stringify(error)).not.toContain("top-secret");
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 20_000);

  it("cooperatively cancels an active ACP turn without saving it", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-cancel-")); roots.push(state);
    const fake = resolve("runtime/test/fake-acp-agent.mjs");
    const child = spawn(brokerExecutable(), [], {
      env: {
        ...process.env, FAKE_ACP_WAIT: "1", XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: fake, QUICKCHAT_CLAUDE_ACP: fake, PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
    await until(() => events.some((event) => event.type === "ready"));
    child.stdin.write('{"type":"submit","id":"cancel-me","question":"wait","provider":"codex"}\n');
    await until(() => events.some((event) => event.type === "state" && event.state === "streaming"));
    child.stdin.write('{"type":"cancel","id":"cancel-me"}\n');
    await until(() => events.some((event) => event.type === "error" && event.code === "cancelled"));
    expect(events.some((event) => event.type === "complete")).toBe(false);
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 25_000);
});

const readySchema = z.object({
  type: z.literal("ready"),
  protocolVersion: z.literal(2),
  providers: z.array(z.object({
    id: z.string(),
    models: z.array(z.object({ id: z.string(), name: z.string() })),
    policy: z.object({
      tools: z.enum(["device-approval", "sandboxed", "blocked"]),
      web: z.enum(["approved-command", "search", "blocked"]),
      hostReads: z.boolean()
    })
  }))
});
const completeSchema = z.object({ type: z.literal("complete"), chat: z.object({ id: z.string().uuid(), answer: z.string() }) });

async function until(predicate: () => boolean | Promise<boolean>, timeout = 12_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for broker event");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

function parseObject(line: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(line);
  return z.record(z.string(), z.unknown()).parse(raw);
}

function brokerExecutable(): string {
  return process.env.QUICKCHAT_TEST_BROKER ?? resolve("runtime/bin/quickchat-broker");
}

async function forbiddenAttempt(provider: "codex" | "opencode", extraEnv: NodeJS.ProcessEnv): Promise<Record<string, unknown>[]> {
  const state = await mkdtemp(join(tmpdir(), "quickchat-forbidden-tool-")); roots.push(state);
  const child = spawn(brokerExecutable(), [], {
    env: {
      ...process.env,
      ...extraEnv,
      XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
      QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
      QUICKCHAT_CLAUDE_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
      PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const events: Record<string, unknown>[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
  child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
  await until(() => events.some((event) => event.type === "ready"));
  child.stdin.write(`${JSON.stringify({ type: "submit", id: "forbidden", question: "Run a device command", provider })}\n`);
  await until(() => events.some((event) => event.type === "error"));
  child.stdin.end('{"type":"shutdown"}\n');
  await new Promise((resolveExit) => child.once("close", resolveExit));
  return events;
}
