import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const licenseFilePattern = /^(licen[sc]e|copying|notice)(\..*)?$/iu;
const licenseOverrides = {
  "@earendil-works/pi-agent-core@0.84.2": "runtime/licenses/earendil-works-pi-0.84.2-MIT.txt",
  "@earendil-works/pi-ai@0.84.2": "runtime/licenses/earendil-works-pi-0.84.2-MIT.txt",
  "@earendil-works/pi-coding-agent@0.84.2": "runtime/licenses/earendil-works-pi-0.84.2-MIT.txt",
  "@earendil-works/pi-telemetry@0.84.2": "runtime/licenses/earendil-works-pi-0.84.2-MIT.txt",
  "@earendil-works/pi-tui@0.84.2": "runtime/licenses/earendil-works-pi-0.84.2-MIT.txt",
  "data-uri-to-buffer@4.0.1": "runtime/licenses/data-uri-to-buffer-4.0.1-MIT.txt",
  "ignore@5.3.2": "runtime/licenses/ignore-5.3.2-MIT.txt",
  "ignore@7.0.5": "runtime/licenses/ignore-7.0.5-MIT.txt",
  "ignore@7.0.6": "runtime/licenses/ignore-7.0.6-MIT.txt"
};

export async function generateThirdPartyLicenses({ projectRoot, sourceMap, lockPath, outputPath }) {
  const usedNames = bundledPackageNames(sourceMap);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const entries = [];
  for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!packagePath.includes("node_modules/")) continue;
    const name = metadata.name ?? packageNameFromPath(packagePath);
    if (!usedNames.has(name)) continue;
    entries.push(await licenseEntry(projectRoot, packagePath, name, metadata));
  }
  const represented = new Set(entries.map((entry) => entry.name));
  const missing = [...usedNames].filter((name) => !represented.has(name));
  if (missing.length > 0) throw new Error(`bundled packages are absent from package-lock.json: ${missing.join(", ")}`);

  entries.sort((left, right) => `${left.name}@${left.version}:${left.path}`.localeCompare(`${right.name}@${right.version}:${right.path}`));
  const texts = new Map();
  for (const entry of entries) {
    entry.textId = `license-${createHash("sha256").update(entry.text).digest("hex").slice(0, 16)}`;
    const record = texts.get(entry.textId) ?? { text: entry.text, packages: [] };
    record.packages.push(`${entry.name}@${entry.version}`);
    texts.set(entry.textId, record);
  }

  const lines = [
    "OmaPilot bundled broker third-party licenses",
    "",
    "Generated deterministically from package-lock.json and the broker source map.",
    "Only packages whose source is present in the generated OmaPilot broker runtime are listed.",
    "",
    "PACKAGES",
    ""
  ];
  for (const entry of entries) {
    lines.push(`- ${entry.name}@${entry.version} | ${entry.license} | ${entry.textId}`);
  }
  lines.push("", "LICENSE TEXTS", "");
  for (const [id, record] of [...texts].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`===== ${id} =====`, `Packages: ${[...new Set(record.packages)].sort().join(", ")}`, "", record.text.trim(), "");
  }
  await writeFile(outputPath, `${lines.join("\n")}\n`);
}

function bundledPackageNames(sourceMap) {
  if (!Array.isArray(sourceMap.sources)) throw new Error("broker source map must contain sources");
  const names = new Set();
  for (const source of sourceMap.sources) {
    if (typeof source !== "string") continue;
    const matches = [...source.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/gu)];
    if (matches.length > 0) names.add(matches[matches.length - 1][1]);
  }
  return names;
}

function packageNameFromPath(packagePath) {
  const tail = packagePath.slice(packagePath.lastIndexOf("node_modules/") + "node_modules/".length);
  const parts = tail.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

async function licenseEntry(projectRoot, packagePath, name, metadata) {
  const directory = resolve(projectRoot, packagePath);
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const files = (await readdir(directory)).filter((file) => licenseFilePattern.test(file)).sort();
  const license = String(metadata.license ?? manifest.license ?? "UNKNOWN");
  let text;
  if (files.length > 0) {
    const sections = await Promise.all(files.map(async (file) => `--- ${file} ---\n${await readFile(resolve(directory, file), "utf8")}`));
    text = sections.join("\n\n");
  } else {
    const override = licenseOverrides[`${name}@${metadata.version}`];
    if (override === undefined)
      throw new Error(`${name}@${metadata.version} declares ${license} but ships no license text or reviewed override`);
    text = `--- reviewed upstream license override ---\n${await readFile(resolve(projectRoot, override), "utf8")}`;
  }
  return { name, version: metadata.version, license, path: packagePath, text, textId: "" };
}
