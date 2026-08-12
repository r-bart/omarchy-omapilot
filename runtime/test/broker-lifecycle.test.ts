import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteAcpSession } from "../src/acp.js";
import { QuickchatBroker } from "../src/broker.js";
import { HistoryStore } from "../src/history.js";
import { ImageStore } from "../src/images.js";
import { quickchatPaths } from "../src/paths.js";
import type { DiscoveredProvider } from "../src/providers.js";
import type { BrokerEvent, ChatRecord, ProviderId } from "../src/types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("broker lifecycle cleanup", () => {
  it("keeps local delete successful when provider session cleanup fails", async () => {
    const fixture = await setup();
    await fixture.history.save(record(1));
    const cleaned: string[] = [];
    const broker = new QuickchatBroker(fixture.events.push.bind(fixture.events), {
      history: fixture.history, images: new ImageStore(fixture.paths), env: fixture.env,
      sessionCleaner: (_provider, sessionId) => { cleaned.push(sessionId); return Promise.reject(new Error("provider offline")); }
    });
    await broker.handle({ type: "initialize", protocolVersion: 1 });
    await broker.handle({ type: "history_delete", chatId: record(1).id });
    expect(await fixture.history.list()).toEqual([]);
    expect(cleaned).toEqual(["provider-session-1"]);
    expect(fixture.events.some((event) => event.type === "history" && event.history.length === 0)).toBe(true);
  });

  it("best-effort cleans every session after local clear", async () => {
    const fixture = await setup();
    await fixture.history.save(record(1));
    await fixture.history.save(record(2));
    const cleaned: string[] = [];
    const broker = new QuickchatBroker(() => undefined, {
      history: fixture.history, images: new ImageStore(fixture.paths), env: fixture.env,
      sessionCleaner: (_provider, sessionId) => { cleaned.push(sessionId); return Promise.resolve(sessionId !== "provider-session-1"); }
    });
    await broker.handle({ type: "initialize", protocolVersion: 1 });
    await broker.handle({ type: "history_clear" });
    expect(await fixture.history.list()).toEqual([]);
    expect(cleaned.sort()).toEqual(["provider-session-1", "provider-session-2"]);
  });

  it("cleans the provider session evicted by the 30-chat cap", async () => {
    const fixture = await setup();
    for (let index = 0; index < 30; index += 1) await fixture.history.save(record(index));
    const cleaned: string[] = [];
    const broker = new QuickchatBroker(fixture.events.push.bind(fixture.events), {
      history: fixture.history, images: new ImageStore(fixture.paths), env: fixture.env,
      sessionCleaner: (_provider, sessionId) => { cleaned.push(sessionId); return Promise.resolve(true); }
    });
    await broker.handle({ type: "initialize", protocolVersion: 1 });
    await broker.handle({ type: "submit", id: "evict", question: "Newest", provider: "codex", capability: "answer" });
    expect((await fixture.history.list())).toHaveLength(30);
    expect(cleaned).toContain("provider-session-0");
  }, 20_000);

  it("uses OpenCode's native CLI when ACP cannot delete persisted sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "quickchat-opencode-delete-")); roots.push(root);
    const audit = join(root, "session-audit.txt");
    const agentEnvironment = { ...process.env, FAKE_ACP_NO_DELETE: "1", OPENCODE_SESSION_AUDIT: audit };
    const provider: DiscoveredProvider = {
      id: "opencode", name: "OpenCode", models: [], capabilities: ["answer", "web"],
      harnessPath: resolve("runtime/test/fixtures/session-bin/opencode"),
      agent: { executable: resolve("runtime/test/fake-acp-agent.mjs"), args: [], env: agentEnvironment }
    };
    expect(await deleteAcpSession(provider, "provider-native-session")).toBe(true);
    expect(await readFile(audit, "utf8")).toBe("--pure session delete provider-native-session\n");
  });
});

describe("dictation generation guard", () => {
  it("discards a late stop result after cancellation", async () => {
    const events: BrokerEvent[] = [];
    let finishStop: (text: string) => void = () => undefined;
    const stopResult = new Promise<string>((resolveStop) => { finishStop = resolveStop; });
    const broker = new QuickchatBroker(events.push.bind(events), {
      dictation: { start: () => Promise.resolve(), stop: () => stopResult, cancel: () => Promise.resolve() }
    });
    const stopping = broker.handle({ type: "dictation_stop" });
    await new Promise((resolveTurn) => setTimeout(resolveTurn, 0));
    await broker.handle({ type: "dictation_cancel" });
    finishStop("late transcript");
    await stopping;
    expect(events).toEqual([
      { type: "dictation", state: "transcribing" },
      { type: "dictation", state: "idle" }
    ]);
  });
});

async function setup(): Promise<{
  paths: ReturnType<typeof quickchatPaths>;
  history: HistoryStore;
  events: BrokerEvent[];
  env: NodeJS.ProcessEnv;
}> {
  const root = await mkdtemp(join(tmpdir(), "quickchat-broker-lifecycle-"));
  roots.push(root);
  const paths = quickchatPaths({ HOME: root, XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), XDG_RUNTIME_DIR: join(root, "run") });
  return {
    paths,
    history: new HistoryStore(paths),
    events: [],
    env: {
      ...process.env,
      XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), XDG_RUNTIME_DIR: join(root, "run"),
      QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
      PATH: `${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`
    }
  };
}

function record(index: number, provider: ProviderId = "codex"): ChatRecord {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    schemaVersion: 1,
    id: `10000000-0000-4000-8000-${suffix}`,
    createdAt: new Date(Date.UTC(2026, 7, 11, 0, 0, index)).toISOString(),
    title: `Chat ${String(index)}`,
    provider,
    capability: "answer",
    question: "Question",
    answer: "Answer",
    images: [],
    session: { acpId: `provider-session-${String(index)}`, resumable: true, resumeKind: "native" }
  };
}
