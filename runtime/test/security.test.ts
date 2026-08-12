import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installVerifiedAdapter, sha256File } from "../src/bootstrap.js";
import { presentChat } from "../src/history.js";
import { inspectImage, isAllowedExternalLink, isPublicAddress } from "../src/images.js";
import { quickchatPaths } from "../src/paths.js";
import { commandSchema, type ChatRecord } from "../src/types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("network and image policy", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.10.2", "192.168.1.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("allows public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("permits only external link schemes", () => {
    expect(isAllowedExternalLink("https://example.com/a?b=1")).toBe(true);
    expect(isAllowedExternalLink("mailto:person@example.com")).toBe(true);
    expect(isAllowedExternalLink("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalLink("file:///etc/passwd")).toBe(false);
  });

  it("detects PNG dimensions and rejects mismatched data", () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");
    expect(inspectImage(png)).toEqual({ mime: "image/png", width: 1, height: 1 });
    expect(() => inspectImage(Buffer.from("not-image"))).toThrow("Only valid PNG");
  });

  it("preserves remote image placeholder ids", () => {
    const command = commandSchema.parse({ type: "load_image", id: "placeholder-2", url: "https://example.com/image.png" });
    expect(command).toEqual({ type: "load_image", id: "placeholder-2", url: "https://example.com/image.png" });
  });

  it("derives file URLs but never persists them", async () => {
    const root = await mkdtemp(join(tmpdir(), "quickchat-present-")); roots.push(root);
    const paths = quickchatPaths({ HOME: root, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_RUNTIME_DIR: join(root, "run") });
    const chat = sampleChat();
    const view = presentChat(chat, paths);
    expect(view.images[0]?.localUrl).toMatch(/^file:\/\//u);
    expect(chat.images[0]).not.toHaveProperty("localUrl");
  });
});

describe("adapter bootstrap", () => {
  it("hashes files deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "quickchat-hash-")); roots.push(root);
    const file = join(root, "asset");
    await writeFile(file, "quickchat");
    expect(await sha256File(file)).toBe("ebf05b0c850773a6e1475226439972d741b56835d3adcec42c9c75272b4132fa");
  });

  it("fails closed for unpinned or insecure assets", async () => {
    await expect(installVerifiedAdapter({ url: "http://example.com/a", sha256: "bad", executable: "a" }, "/tmp/never"))
      .rejects.toThrow("Invalid pinned");
  });

});

function sampleChat(): ChatRecord {
  return {
    schemaVersion: 1, id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-08-11T00:00:00.000Z", title: "A",
    provider: "codex", capability: "answer", question: "Q", answer: "A",
    images: [{ id: "22222222-2222-4222-8222-222222222222", mimeType: "image/png", path: "image.png", bytes: 20, width: 1, height: 1 }],
    session: { resumable: true, resumeKind: "native" }
  };
}
