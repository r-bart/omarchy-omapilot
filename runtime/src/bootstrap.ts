import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { runCommand } from "./process.js";

export type AdapterAsset = { url: string; sha256: string; executable: string };

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export async function installVerifiedAdapter(asset: AdapterAsset, destination: string): Promise<void> {
  if (!/^https:\/\//u.test(asset.url) || !/^[a-f0-9]{64}$/u.test(asset.sha256) || !/^[a-zA-Z0-9._-]+$/u.test(asset.executable)) {
    throw new Error("Invalid pinned adapter asset metadata");
  }
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(parent, ".adapter-"));
  try {
    const archive = join(temporary, "adapter.tar.gz");
    const response = await fetch(asset.url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok || response.body === null) throw new Error(`Adapter download failed with HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > 250 * 1024 * 1024) throw new Error("Adapter archive is too large");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > 250 * 1024 * 1024) throw new Error("Adapter archive is too large");
    await writeFile(archive, body, { flag: "wx", mode: 0o600 });
    if (await sha256File(archive) !== asset.sha256) throw new Error("Adapter checksum did not match the release manifest");
    const tar = await runCommand("tar", ["-tzf", archive], { timeoutMs: 10_000, maxOutput: 1_000_000 });
    if (tar.code !== 0) throw new Error("Adapter archive is invalid");
    const unsafe = tar.stdout.split("\n").filter(Boolean).some((name) => name.startsWith("/") || name.split("/").includes(".."));
    if (unsafe) throw new Error("Adapter archive contains an unsafe path");
    const extracted = join(temporary, "extracted");
    await mkdir(extracted, { mode: 0o700 });
    const unpack = await runCommand("tar", ["-xzf", archive, "-C", extracted, "--no-same-owner", "--no-same-permissions"], { timeoutMs: 20_000 });
    if (unpack.code !== 0) throw new Error("Adapter archive could not be extracted");
    await access(join(extracted, "bin", asset.executable));
    await rm(destination, { recursive: true, force: true });
    await rename(extracted, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
