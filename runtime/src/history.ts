import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChatRecord, ChatView, StoredImage } from "./types.js";
import { quickchatPaths, type QuickchatPaths } from "./paths.js";

const MAX_CHATS = 30;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export class HistoryStore {
  readonly #paths: QuickchatPaths;

  constructor(paths: QuickchatPaths = quickchatPaths()) {
    this.#paths = paths;
  }

  async list(): Promise<ChatRecord[]> {
    await mkdir(this.#paths.records, { recursive: true, mode: 0o700 });
    const names = await readdir(this.#paths.records);
    const records: ChatRecord[] = [];
    for (const name of names.filter((value) => /^[0-9a-f-]{36}\.json$/u.test(value))) {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(this.#paths.records, name), "utf8"));
        if (isChatRecord(parsed)) records.push(parsed);
      } catch {
        // Ignore an unreadable record without exposing its content.
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_CHATS);
  }

  async get(id: string): Promise<ChatRecord | undefined> {
    if (!isUuid(id)) return undefined;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.#paths.records, `${id}.json`), "utf8"));
      return isChatRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async save(chat: ChatRecord): Promise<void> {
    await mkdir(this.#paths.records, { recursive: true, mode: 0o700 });
    const destination = join(this.#paths.records, `${chat.id}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(chat)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const handle = await open(temporary, "r");
    await handle.sync();
    await handle.close();
    await rename(temporary, destination);
    await this.#evictRecords();
    await this.#evictImages();
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const chat = await this.get(id);
    try {
      await unlink(join(this.#paths.records, `${id}.json`));
    } catch {
      return false;
    }
    if (chat !== undefined) {
      await Promise.all(chat.images.map(async (image) => {
        if (basename(image.path) === image.path) await rm(join(this.#paths.images, image.path), { force: true });
      }));
    }
    return true;
  }

  async clear(): Promise<void> {
    await rm(this.#paths.records, { recursive: true, force: true });
    await rm(this.#paths.images, { recursive: true, force: true });
  }

  async #evictRecords(): Promise<void> {
    const records = await this.listAll();
    await Promise.all(records.slice(MAX_CHATS).map((chat) => this.delete(chat.id)));
  }

  async listAll(): Promise<ChatRecord[]> {
    await mkdir(this.#paths.records, { recursive: true, mode: 0o700 });
    const names = await readdir(this.#paths.records);
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(this.#paths.records, name), "utf8"));
        return isChatRecord(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }));
    return records.filter((record): record is ChatRecord => record !== undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async #evictImages(): Promise<void> {
    await mkdir(this.#paths.images, { recursive: true, mode: 0o700 });
    const names = await readdir(this.#paths.images);
    const files = (await Promise.all(names.map(async (name) => {
      try {
        const info = await stat(join(this.#paths.images, name));
        return info.isFile() ? { name, bytes: info.size, modified: info.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    }))).filter((item): item is { name: string; bytes: number; modified: number } => item !== undefined)
      .sort((a, b) => a.modified - b.modified);
    let total = files.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of files) {
      if (total <= MAX_IMAGE_BYTES) break;
      await rm(join(this.#paths.images, file.name), { force: true });
      total -= file.bytes;
    }
  }
}

export function presentImage(image: StoredImage, paths: QuickchatPaths = quickchatPaths()): StoredImage & { localUrl: string } {
  return { ...image, path: basename(image.path), localUrl: pathToFileURL(join(paths.images, basename(image.path))).toString() };
}

export function presentChat(chat: ChatRecord, paths: QuickchatPaths = quickchatPaths()): ChatView {
  return { ...chat, images: chat.images.map((image) => presentImage(image, paths)) };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isChatRecord(value: unknown): value is ChatRecord {
  if (typeof value !== "object" || value === null) return false;
  return "schemaVersion" in value && value.schemaVersion === 1 &&
    "id" in value && typeof value.id === "string" && isUuid(value.id) &&
    "createdAt" in value && typeof value.createdAt === "string" &&
    "provider" in value && ["codex", "claude", "opencode"].includes(String(value.provider)) &&
    "question" in value && typeof value.question === "string" &&
    "answer" in value && typeof value.answer === "string" &&
    "images" in value && Array.isArray(value.images);
}
