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
  it("normalizes a blank model to provider default", () => {
    const parsed = commandSchema.parse({ type: "submit", id: "one", question: "hello", provider: "codex", model: "", capability: "answer" });
    expect(parsed.type === "submit" ? parsed.model : "wrong-command").toBeUndefined();
  });

  it("rejects malformed commands", () => {
    expect(commandSchema.safeParse({ type: "submit", id: "one", question: "", provider: "codex" }).success).toBe(false);
  });

  it("rejects incompatible protocol versions without becoming ready", async () => {
    const child = spawn(resolve("runtime/bin/quickchat-broker"), [], { stdio: ["pipe", "pipe", "pipe"] });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":2}\n');
    await until(() => events.some((event) => event.code === "unsupported_protocol"));
    expect(events.some((event) => event.type === "ready")).toBe(false);
    expect(events.find((event) => event.code === "unsupported_protocol")?.message).toBe("Quickchat supports broker protocol version 1");
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  });

  it("rejects initialize without an explicit protocol version", async () => {
    const child = spawn(resolve("runtime/bin/quickchat-broker"), [], { stdio: ["pipe", "pipe", "pipe"] });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize"}\n');
    await until(() => events.some((event) => event.code === "invalid_command"));
    expect(events.some((event) => event.type === "ready")).toBe(false);
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  });

  it("initializes, exposes models, streams markdown, denies permission, and stores completion", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-protocol-")); roots.push(state);
    const fake = resolve("runtime/test/fake-acp-agent.mjs");
    const audit = join(state, "acp-audit.txt");
    const launcher = resolve("runtime/bin/quickchat-broker");
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
    child.stdin.write(`${JSON.stringify({ type: "initialize", protocolVersion: 1, client: "test" })}\n`);
    await until(() => events.some((event) => event.type === "ready"));
    const ready = readySchema.parse(events.find((event) => event.type === "ready"));
    expect(ready.protocolVersion).toBe(1);
    expect(ready.providers.find((provider) => provider.id === "codex")?.models).toContainEqual({ id: "test/default", name: "Default" });
    expect(await readFile(audit, "utf8")).toContain("delete:fake-1");
    child.stdin.write(`${JSON.stringify({ type: "submit", id: "wire-1", question: "Say hello", provider: "codex", capability: "answer" })}\n`);
    await until(() => events.some((event) => event.type === "complete"));
    expect(events).toContainEqual({ type: "content", id: "wire-1", delta: "# Answer\n\nHello [link](https://example.com)." });
    const complete = completeSchema.parse(events.find((event) => event.type === "complete"));
    expect(complete.chat.answer).toContain("Hello");
    const saved = await readFile(join(state, "state/quickchat/chats", `${complete.chat.id}.json`), "utf8");
    expect(saved).not.toContain("localUrl");
    child.stdin.write(`${JSON.stringify({ type: "history_delete", chatId: complete.chat.id })}\n`);
    await until(async () => (await readFile(audit, "utf8")).trim().split("\n").length >= 2);
    child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 25_000);

  it("never forwards provider stderr or exception details", async () => {
    const state = await mkdtemp(join(tmpdir(), "quickchat-errors-")); roots.push(state);
    const child = spawn(resolve("runtime/bin/quickchat-broker"), [], {
      env: {
        ...process.env, FAKE_ACP_FAIL_SECRET: "1", XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"), PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":1}\n');
    await until(() => events.some((event) => event.type === "ready"));
    child.stdin.write('{"type":"submit","id":"fail","question":"fail","provider":"codex","capability":"answer"}\n');
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
    const child = spawn(resolve("runtime/bin/quickchat-broker"), [], {
      env: {
        ...process.env, FAKE_ACP_WAIT: "1", XDG_STATE_HOME: join(state, "state"), XDG_CACHE_HOME: join(state, "cache"), XDG_RUNTIME_DIR: join(state, "run"),
        QUICKCHAT_CODEX_ACP: fake, QUICKCHAT_CLAUDE_ACP: fake, PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const events: Record<string, unknown>[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => events.push(parseObject(line)));
    child.stdin.write('{"type":"initialize","protocolVersion":1}\n');
    await until(() => events.some((event) => event.type === "ready"));
    child.stdin.write('{"type":"submit","id":"cancel-me","question":"wait","provider":"codex","capability":"answer"}\n');
    await until(() => events.some((event) => event.type === "content"));
    child.stdin.write('{"type":"cancel","id":"cancel-me"}\n');
    await until(() => events.some((event) => event.type === "error" && event.code === "cancelled"));
    expect(events.some((event) => event.type === "complete")).toBe(false);
    child.stdin.end('{"type":"shutdown"}\n');
    await new Promise((resolveExit) => child.once("close", resolveExit));
  }, 25_000);
});

const readySchema = z.object({
  type: z.literal("ready"),
  protocolVersion: z.literal(1),
  providers: z.array(z.object({ id: z.string(), models: z.array(z.object({ id: z.string(), name: z.string() })) }))
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
