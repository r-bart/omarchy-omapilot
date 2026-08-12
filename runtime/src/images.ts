import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { basename, extname, join } from "node:path";
import type { StoredImage } from "./types.js";
import { quickchatPaths, type QuickchatPaths } from "./paths.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 12_000;
const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);

export class ImageStore {
  readonly #paths: QuickchatPaths;

  constructor(paths: QuickchatPaths = quickchatPaths()) {
    this.#paths = paths;
  }

  async saveBase64(data: string, claimedMime: string, sourceUrl?: string): Promise<StoredImage> {
    const bytes = Buffer.from(data, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new ImagePolicyError("image_size", "Image exceeds the 5 MiB limit");
    return this.save(bytes, claimedMime, sourceUrl);
  }

  async fetchRemote(rawUrl: string): Promise<StoredImage> {
    const response = await fetchSafe(rawUrl, 3);
    return this.save(response.body, response.mime, response.finalUrl);
  }

  async save(bytes: Buffer, claimedMime: string, sourceUrl?: string): Promise<StoredImage> {
    const detected = inspectImage(bytes);
    if (detected.mime !== claimedMime.toLowerCase().split(";")[0]) throw new ImagePolicyError("image_mime", "Image content does not match its MIME type");
    if (detected.width < 1 || detected.height < 1 || detected.width > MAX_IMAGE_DIMENSION || detected.height > MAX_IMAGE_DIMENSION) {
      throw new ImagePolicyError("image_dimensions", "Image dimensions are not supported");
    }
    await mkdir(this.#paths.images, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const extension = MIME_EXTENSIONS.get(detected.mime);
    if (extension === undefined) throw new ImagePolicyError("image_mime", "Unsupported image type");
    const filename = `${id}${extension}`;
    await writeFile(join(this.#paths.images, filename), bytes, { flag: "wx", mode: 0o600 });
    return {
      id,
      mimeType: detected.mime,
      path: basename(filename),
      bytes: bytes.byteLength,
      width: detected.width,
      height: detected.height,
      ...(sourceUrl === undefined ? {} : { sourceUrl })
    };
  }
}

export class ImagePolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ImagePolicyError";
  }
}

export function inspectImage(bytes: Buffer): { mime: string; width: number; height: number } {
  if (bytes.byteLength >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mime: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.byteLength >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = bytes.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") return { mime: "image/webp", width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (kind === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return { mime: "image/webp", width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === undefined || marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.byteLength) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { mime: "image/jpeg", height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  throw new ImagePolicyError("image_mime", "Only valid PNG, JPEG, and WebP images are supported");
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const first = parts[0] ?? 0;
    const second = parts[1] ?? 0;
    return !(first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 198 && (second === 18 || second === 19)));
  }
  if (version === 6) {
    const lower = address.toLowerCase().split("%")[0] ?? "";
    if (lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/u.test(lower) || lower.startsWith("ff")) return false;
    if (lower.startsWith("::ffff:")) return isPublicAddress(lower.slice(7));
    return !lower.startsWith("2001:db8") && !lower.startsWith("2001:10") && !lower.startsWith("2001:2");
  }
  return false;
}

async function resolvePublic(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const entries = await lookup(hostname, { all: true, verbatim: true });
  if (entries.length === 0 || entries.some((entry) => !isPublicAddress(entry.address))) {
    throw new ImagePolicyError("image_url_private", "Remote images cannot use private or reserved network addresses");
  }
  const entry = entries[0];
  if (entry === undefined || (entry.family !== 4 && entry.family !== 6)) throw new ImagePolicyError("image_dns", "Image host could not be resolved safely");
  return { address: entry.address, family: entry.family };
}

async function fetchSafe(rawUrl: string, redirects: number): Promise<{ body: Buffer; mime: string; finalUrl: string }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new ImagePolicyError("image_url", "Invalid image URL"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    throw new ImagePolicyError("image_url", "Remote images require a credential-free HTTPS URL on port 443");
  }
  const resolved = await resolvePublic(url.hostname);
  return new Promise((resolveRequest, reject) => {
    const request = get(url, {
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family)
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location !== undefined) {
        response.resume();
        if (redirects <= 0) { reject(new ImagePolicyError("image_redirects", "Too many image redirects")); return; }
        const next = new URL(response.headers.location, url).toString();
        fetchSafe(next, redirects - 1).then(resolveRequest, reject);
        return;
      }
      if (status !== 200) { response.resume(); reject(new ImagePolicyError("image_http", `Image server returned HTTP ${status}`)); return; }
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > MAX_IMAGE_BYTES) { response.destroy(); reject(new ImagePolicyError("image_size", "Image exceeds the 5 MiB limit")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_IMAGE_BYTES) response.destroy(new ImagePolicyError("image_size", "Image exceeds the 5 MiB limit"));
        else chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        const mime = String(response.headers["content-type"] ?? "").toLowerCase().split(";")[0] ?? "";
        resolveRequest({ body: Buffer.concat(chunks), mime, finalUrl: url.toString() });
      });
    });
    request.setTimeout(15_000, () => request.destroy(new ImagePolicyError("image_timeout", "Image request timed out")));
    request.once("error", reject);
  });
}

export function isAllowedExternalLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function imageExtension(mime: string): string | undefined {
  return MIME_EXTENSIONS.get(mime);
}

export function hasSafeImageExtension(name: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp"].includes(extname(name).toLowerCase());
}
