import { mkdir, mkdtemp, readFile, readdir, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { presentChat } from "../src/history.js";
import { ImagePolicyError, ImageStore, inspectImage, isAllowedExternalLink, isPublicAddress } from "../src/images.js";
import { omapilotPaths } from "../src/paths.js";
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
    const png = onePixelPng();
    expect(inspectImage(png)).toEqual({ mime: "image/png", width: 1, height: 1 });
    expect(() => inspectImage(Buffer.from("not-image"))).toThrow("Only valid PNG");
  });

  it("rejects truncated, trailing, and excessive-pixel image structures", () => {
    const png = onePixelPng();
    expect(() => inspectImage(png.subarray(0, png.length - 6))).toThrow(/PNG/u);
    expect(() => inspectImage(Buffer.concat([png, Buffer.from("trailing")]))).toThrow(/PNG/u);
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(5_000, 16);
    oversized.writeUInt32BE(5_000, 20);
    expect(() => inspectImage(oversized)).toThrow("dimensions");
    expect(() => inspectImage(webp(1, 1, 31))).toThrow("RIFF size");
    expect(() => inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00])))
      .toThrow("end marker");
  });

  it("prunes the shared image cache after every direct save", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-image-cache-")); roots.push(root);
    const paths = omapilotPaths({ HOME: root, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_RUNTIME_DIR: join(root, "run") });
    await mkdir(paths.images, { recursive: true });
    for (let index = 0; index < 10; index += 1) {
      const file = join(paths.images, `old-${String(index)}.png`);
      await writeFile(file, "");
      await truncate(file, 5 * 1024 * 1024);
      await utimes(file, 1_600_000_000 + index, 1_600_000_000 + index);
    }
    await new ImageStore(paths, decoderEnvironment()).save(onePixelPng(), "image/png");
    const total = (await Promise.all((await readdir(paths.images)).map(async (name) => (await stat(join(paths.images, name))).size)))
      .reduce((sum, bytes) => sum + bytes, 0);
    expect(total).toBeLessThanOrEqual(50 * 1024 * 1024);
    expect(await readdir(paths.images)).not.toContain("old-0.png");
  });

  it("fails closed when the full image decoder is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-no-decoder-")); roots.push(root);
    const paths = omapilotPaths({ HOME: root, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_RUNTIME_DIR: join(root, "run") });
    await expect(new ImageStore(paths, { PATH: "/missing" }).save(onePixelPng(), "image/png"))
      .rejects.toMatchObject({ code: "image_decoder_unavailable" } satisfies Partial<ImagePolicyError>);
  });

  it("fully decodes, strips, and preserves PNG alpha and JPEG photo media", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-normalize-")); roots.push(root);
    const paths = omapilotPaths({ HOME: root, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_RUNTIME_DIR: join(root, "run") });
    const audit = join(root, "decoder-audit.txt");
    const store = new ImageStore(paths, decoderEnvironment({ FAKE_MAGICK_AUDIT: audit }));
    const alpha = await store.save(alphaPng(), "image/png");
    const photo = await store.save(photoJpeg(), "image/jpeg");
    expect(alpha.mimeType).toBe("image/png");
    expect(alpha.path).toMatch(/\.png$/u);
    expect(photo.mimeType).toBe("image/jpeg");
    expect(photo.path).toMatch(/\.jpg$/u);
    expect(await readFile(audit, "utf8")).toBe("PNG32\nJPEG\n");
  });

  it("rejects structurally plausible but undecodable compressed image data", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-malformed-decode-")); roots.push(root);
    const paths = omapilotPaths({ HOME: root, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_RUNTIME_DIR: join(root, "run") });
    const malformed = onePixelPng();
    malformed.fill(0, 41, 48);
    await expect(new ImageStore(paths, decoderEnvironment()).save(malformed, "image/png"))
      .rejects.toMatchObject({ code: "image_decode" } satisfies Partial<ImagePolicyError>);
  });

  it("rejects oversized provider base64 before decoding", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-base64-limit-")); roots.push(root);
    const paths = omapilotPaths({ HOME: root, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_RUNTIME_DIR: join(root, "run") });
    await expect(new ImageStore(paths, decoderEnvironment()).saveBase64("A".repeat(7_000_000), "image/png"))
      .rejects.toMatchObject({ code: "image_size" } satisfies Partial<ImagePolicyError>);
  });

  it("preserves remote image placeholder ids", () => {
    const command = commandSchema.parse({ type: "load_image", id: "placeholder-2", url: "https://example.com/image.png" });
    expect(command).toEqual({ type: "load_image", id: "placeholder-2", url: "https://example.com/image.png" });
  });

  it("derives file URLs but never persists them", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-present-")); roots.push(root);
    const paths = omapilotPaths({ HOME: root, XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_RUNTIME_DIR: join(root, "run") });
    const chat = sampleChat();
    const view = presentChat(chat, paths);
    expect(view.images[0]?.localUrl).toMatch(/^file:\/\//u);
    expect(chat.images[0]).not.toHaveProperty("localUrl");
  });
});

function onePixelPng(): Buffer {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
}

function alphaPng(): Buffer {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAgMAAAAP2OW3AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURQAAAP8AAP///2cZZB4AAAACdFJOUwCAmytOGAAAAAFiS0dEAmYLfGQAAAAHdElNRQfqCAwDFh18dQFqAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA4LTEyVDAzOjIyOjI5KzAwOjAwQSSISwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOC0xMlQwMzoyMjoyOSswMDowMDB5MPcAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDgtMTJUMDM6MjI6MjkrMDA6MDBnbBEoAAAADElEQVQI12NwYGAAAADEAEFsh7KrAAAAAElFTkSuQmCC", "base64");
}

function photoJpeg(): Buffer {
  return Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABsQAAAHAQAAAAAAAAAAAAAAAAACBAUWVZPR/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwn/xAAbEQAABwEAAAAAAAAAAAAAAAAAAwYWVZPSBP/aAAwDAQACEQMRAD8AA8hdbNZufoo0xElE81BWQD0U8mfcZof/2Q==", "base64");
}

function decoderEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, PATH: `${resolveFixture("runtime/test/fixtures/image-bin")}:${process.env.PATH ?? ""}` };
}

function resolveFixture(path: string): string {
  return new URL(`../../${path}`, import.meta.url).pathname;
}

function webp(width: number, height: number, declaredSize?: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(declaredSize ?? 22, 4);
  bytes.write("WEBPVP8X", 8, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

function sampleChat(): ChatRecord {
  return {
    schemaVersion: 1, id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-08-11T00:00:00.000Z", title: "A",
    provider: "codex", question: "Q", answer: "A",
    images: [{ id: "22222222-2222-4222-8222-222222222222", mimeType: "image/png", path: "image.png", bytes: 20, width: 1, height: 1 }],
    session: { resumable: true, resumeKind: "native" }
  };
}
