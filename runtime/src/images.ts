import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { basename, extname, join } from "node:path";
import type { StoredImage } from "./types.js";
import { omapilotPaths, type OmaPilotPaths } from "./paths.js";
import { resolveExecutable, runCommand } from "./process.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 12_000;
export const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_CACHE_BYTES = 50 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);

export class ImageStore {
  readonly #paths: OmaPilotPaths;
  readonly #env: NodeJS.ProcessEnv;

  constructor(paths: OmaPilotPaths = omapilotPaths(), env: NodeJS.ProcessEnv = process.env) {
    this.#paths = paths;
    this.#env = env;
  }

  async saveBase64(data: string, claimedMime: string, sourceUrl?: string): Promise<StoredImage> {
    const maxEncodedBytes = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
    if (data.length === 0 || data.length > maxEncodedBytes || !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/u.test(data)) {
      throw new ImagePolicyError("image_size", "Image encoding is invalid or exceeds the 5 MiB limit");
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new ImagePolicyError("image_size", "Image exceeds the 5 MiB limit");
    return this.save(bytes, claimedMime, sourceUrl);
  }

  async fetchRemote(rawUrl: string): Promise<StoredImage> {
    const response = await fetchSafe(rawUrl, 3);
    return this.save(response.body, response.mime, response.finalUrl);
  }

  async save(bytes: Buffer, claimedMime: string, sourceUrl?: string): Promise<StoredImage> {
    const claimed = claimedMime.toLowerCase().split(";")[0] ?? "";
    if (!MIME_EXTENSIONS.has(claimed)) throw new ImagePolicyError("image_mime", "Unsupported image type");
    const source = inspectImage(bytes);
    if (source.mime !== claimed) throw new ImagePolicyError("image_mime", "Image content does not match its MIME type");
    const normalized = await normalizeImage(bytes, claimed, this.#paths, this.#env);
    const detected = inspectImage(normalized);
    if (detected.mime !== claimed) throw new ImagePolicyError("image_decode", "Image normalization changed the media type unexpectedly");
    await mkdir(this.#paths.images, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const extension = MIME_EXTENSIONS.get(detected.mime);
    if (extension === undefined) throw new ImagePolicyError("image_mime", "Unsupported normalized image type");
    const filename = `${id}${extension}`;
    await writeFile(join(this.#paths.images, filename), normalized, { flag: "wx", mode: 0o600 });
    const image = {
      id,
      mimeType: detected.mime,
      path: basename(filename),
      bytes: normalized.byteLength,
      width: detected.width,
      height: detected.height,
      ...(sourceUrl === undefined ? {} : { sourceUrl })
    };
    await pruneImageCache(this.#paths);
    return image;
  }

  async remove(image: StoredImage): Promise<void> {
    if (basename(image.path) !== image.path || !/^[0-9a-f-]{36}\.(?:png|jpg|webp)$/iu.test(image.path)) return;
    await rm(join(this.#paths.images, image.path), { force: true });
  }
}

async function normalizeImage(bytes: Buffer, mime: string, paths: OmaPilotPaths, env: NodeJS.ProcessEnv): Promise<Buffer> {
  const magick = await resolveExecutable("magick", env);
  if (magick === undefined) throw new ImagePolicyError("image_decoder_unavailable", "Secure image decoding is unavailable");
  await mkdir(paths.runtime, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(paths.runtime, "image-"));
  try {
    const extension = MIME_EXTENSIONS.get(mime);
    if (extension === undefined) throw new ImagePolicyError("image_mime", "Unsupported image type");
    const input = join(temporary, `source${extension}`);
    const output = join(temporary, `normalized${extension}`);
    const outputTarget = mime === "image/png" ? `PNG32:${output}` : mime === "image/jpeg" ? `JPEG:${output}` : `WEBP:${output}`;
    await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
    const result = await runCommand(magick, [
      "-limit", "memory", "128MiB",
      "-limit", "map", "256MiB",
      "-limit", "disk", "512MiB",
      "-limit", "area", "16MP",
      "-limit", "width", String(MAX_IMAGE_DIMENSION),
      "-limit", "height", String(MAX_IMAGE_DIMENSION),
      `${input}[0]`,
      "-auto-orient",
      "-strip",
      ...(mime === "image/png" ? ["-define", "png:exclude-chunks=date,time"] : ["-quality", "90"]),
      outputTarget
    ], { env, timeoutMs: 15_000, maxOutput: 32_768 });
    if (result.code !== 0) throw new ImagePolicyError("image_decode", "Image decoder rejected the payload");
    const normalized = await readFile(output);
    if (normalized.byteLength === 0 || normalized.byteLength > MAX_IMAGE_BYTES) throw new ImagePolicyError("image_size", "Normalized image exceeds the 5 MiB limit");
    return normalized;
  } catch (error) {
    if (error instanceof ImagePolicyError) throw error;
    throw new ImagePolicyError("image_decode", "Image decoder could not normalize the payload");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export class ImagePolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ImagePolicyError";
  }
}

export function inspectImage(bytes: Buffer): { mime: string; width: number; height: number } {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImagePolicyError("image_size", "Image exceeds the 5 MiB limit");
  const dimensions = inspectPng(bytes) ?? inspectWebp(bytes) ?? inspectJpeg(bytes);
  if (dimensions !== undefined) return validateDimensions(dimensions);
  throw new ImagePolicyError("image_mime", "Only valid PNG, JPEG, and WebP images are supported");
}

function inspectPng(bytes: Buffer): { mime: string; width: number; height: number } | undefined {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) return undefined;
  if (bytes.byteLength < 45) throw new ImagePolicyError("image_structure", "PNG image is truncated");
  let offset = 8;
  let width = 0;
  let height = 0;
  let chunkIndex = 0;
  let ended = false;
  let hasImageData = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new ImagePolicyError("image_structure", "PNG chunk is truncated");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > bytes.byteLength) throw new ImagePolicyError("image_structure", "PNG chunk length exceeds the file");
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) throw new ImagePolicyError("image_structure", "PNG must begin with a complete IHDR chunk");
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
    }
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.byteLength) throw new ImagePolicyError("image_structure", "PNG must end with one empty IEND chunk");
      ended = true;
    }
    if (type === "IDAT") hasImageData = true;
    offset = end;
    chunkIndex += 1;
  }
  if (!ended || !hasImageData) throw new ImagePolicyError("image_structure", "PNG is missing image data or its IEND chunk");
  return { mime: "image/png", width, height };
}

function inspectWebp(bytes: Buffer): { mime: string; width: number; height: number } | undefined {
  if (bytes.byteLength < 12 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") return undefined;
  if (bytes.readUInt32LE(4) + 8 !== bytes.byteLength) throw new ImagePolicyError("image_structure", "WebP RIFF size does not match the file");
  let offset = 12;
  let dimensions: { mime: string; width: number; height: number } | undefined;
  let hasImagePayload = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new ImagePolicyError("image_structure", "WebP chunk is truncated");
    const kind = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const end = data + length;
    const paddedEnd = end + (length % 2);
    if (end > bytes.byteLength || paddedEnd > bytes.byteLength) throw new ImagePolicyError("image_structure", "WebP chunk length exceeds the file");
    if (dimensions === undefined && kind === "VP8X" && length >= 10) {
      dimensions = { mime: "image/webp", width: 1 + bytes.readUIntLE(data + 4, 3), height: 1 + bytes.readUIntLE(data + 7, 3) };
    } else if (kind === "VP8 " && length >= 10 && bytes.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      hasImagePayload = true;
      dimensions ??= { mime: "image/webp", width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff };
    } else if (kind === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      hasImagePayload = true;
      const bits = bytes.readUInt32LE(data + 1);
      dimensions ??= { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (kind === "ANMF" && length >= 16) {
      hasImagePayload = true;
    }
    offset = paddedEnd;
  }
  if (offset !== bytes.byteLength || dimensions === undefined || !hasImagePayload) throw new ImagePolicyError("image_structure", "WebP image has no complete image payload");
  return dimensions;
}

function inspectJpeg(bytes: Buffer): { mime: string; width: number; height: number } | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new ImagePolicyError("image_structure", "JPEG is missing its end marker");
  let offset = 2;
  let dimensions: { mime: string; width: number; height: number } | undefined;
  let hasScan = false;
  while (offset < bytes.byteLength - 2) {
    while (offset < bytes.byteLength - 2 && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) break;
    offset += 1;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength - 2) throw new ImagePolicyError("image_structure", "JPEG segment is truncated");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.byteLength - 2) throw new ImagePolicyError("image_structure", "JPEG segment length exceeds the file");
    if (marker === 0xda) { hasScan = true; break; }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) throw new ImagePolicyError("image_structure", "JPEG frame header is truncated");
      dimensions = { mime: "image/jpeg", height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  if (dimensions === undefined || !hasScan) throw new ImagePolicyError("image_structure", "JPEG is missing a supported frame header or scan");
  return dimensions;
}

function validateDimensions(dimensions: { mime: string; width: number; height: number }): { mime: string; width: number; height: number } {
  if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    throw new ImagePolicyError("image_dimensions", "Image dimensions are not supported");
  }
  return dimensions;
}

export async function pruneImageCache(paths: OmaPilotPaths = omapilotPaths()): Promise<void> {
  await mkdir(paths.images, { recursive: true, mode: 0o700 });
  const files = (await Promise.all((await readdir(paths.images)).map(async (name) => {
    try {
      const info = await stat(join(paths.images, name));
      return info.isFile() ? { name, bytes: info.size, modified: info.mtimeMs } : undefined;
    } catch {
      return undefined;
    }
  }))).filter((item): item is { name: string; bytes: number; modified: number } => item !== undefined)
    .sort((a, b) => a.modified - b.modified);
  let total = files.reduce((sum, file) => sum + file.bytes, 0);
  const evicted: string[] = [];
  for (const file of files) {
    if (total <= MAX_CACHE_BYTES) break;
    evicted.push(file.name);
    total -= file.bytes;
  }
  if (evicted.length === 0) return;
  await removeEvictedImageReferences(paths, new Set(evicted));
  await Promise.all(evicted.map((name) => rm(join(paths.images, name), { force: true })));
}

async function removeEvictedImageReferences(paths: OmaPilotPaths, evicted: ReadonlySet<string>): Promise<void> {
  await mkdir(paths.records, { recursive: true, mode: 0o700 });
  for (const name of (await readdir(paths.records)).filter((value) => /^[0-9a-f-]{36}\.json$/iu.test(value))) {
    const destination = join(paths.records, name);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(destination, "utf8"));
    } catch {
      continue;
    }
    if (!isRecordWithImages(value)) continue;
    const images = value.images.filter((image) => !referencesEvictedImage(image, evicted));
    if (images.length === value.images.length) continue;
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ ...value, images })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const handle = await open(temporary, "r");
      await handle.sync();
      await handle.close();
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

function isRecordWithImages(value: unknown): value is Record<string, unknown> & { images: unknown[] } {
  return typeof value === "object" && value !== null && "images" in value && Array.isArray(value.images);
}

function referencesEvictedImage(value: unknown, evicted: ReadonlySet<string>): boolean {
  if (typeof value !== "object" || value === null || !("path" in value) || typeof value.path !== "string") return false;
  return basename(value.path) === value.path && evicted.has(value.path);
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
