import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryStore } from "../src/history.js";
import { quickchatPaths } from "../src/paths.js";
import type { ChatRecord } from "../src/types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("history store", () => {
  it("atomically retains only the newest 30 complete chats", async () => {
    const root = await mkdtemp(join(tmpdir(), "quickchat-history-")); roots.push(root);
    const paths = quickchatPaths({ HOME: root, XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), XDG_RUNTIME_DIR: join(root, "run") });
    const store = new HistoryStore(paths);
    const evicted: ChatRecord[] = [];
    for (let index = 0; index < 35; index += 1) evicted.push(...await store.save(record(index)));
    const records = await store.list();
    expect(records).toHaveLength(30);
    expect(records[0]?.title).toBe("Chat 34");
    expect(records.at(-1)?.title).toBe("Chat 5");
    expect((await readdir(paths.records)).some((name) => name.endsWith(".tmp"))).toBe(false);
    expect(evicted.map((chat) => chat.title)).toEqual(["Chat 0", "Chat 1", "Chat 2", "Chat 3", "Chat 4"]);
  });

  it("deletes one record and clears all state", async () => {
    const root = await mkdtemp(join(tmpdir(), "quickchat-history-")); roots.push(root);
    const paths = quickchatPaths({ HOME: root, XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), XDG_RUNTIME_DIR: join(root, "run") });
    const store = new HistoryStore(paths);
    await store.save(record(1));
    expect((await store.delete(record(1).id))?.id).toBe(record(1).id);
    await store.save(record(2));
    expect((await store.clear()).map((chat) => chat.id)).toEqual([record(2).id]);
    expect(await store.list()).toEqual([]);
  });
});

function record(index: number): ChatRecord {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    schemaVersion: 1, id: `00000000-0000-4000-8000-${suffix}`, createdAt: new Date(Date.UTC(2026, 7, 11, 0, 0, index)).toISOString(),
    title: `Chat ${String(index)}`, provider: "codex", capability: "answer", question: "Q", answer: "A", images: [],
    session: { resumable: false, resumeKind: "transcript" }
  };
}
