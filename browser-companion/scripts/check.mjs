import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromium = JSON.parse(await readFile(resolve(root, "extension/manifest.chromium.json"), "utf8"));
const firefox = JSON.parse(await readFile(resolve(root, "extension/manifest.firefox.json"), "utf8"));
const host = await readFile(resolve(root, "native-host/host.mjs"), "utf8");
const installer = await readFile(resolve(root, "../scripts/install-browser-companion.sh"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [family, manifest] of [["Chromium", chromium], ["Firefox", firefox]]) {
  assert(manifest.manifest_version === 3, `${family} companion must use Manifest V3`);
  assert(manifest.version === "0.1.0", `${family} companion version drifted`);
  assert(Array.isArray(manifest.permissions), `${family} permissions are missing`);
  for (const forbidden of ["tabs", "history", "debugger", "cookies", "webRequest"])
    assert(!manifest.permissions.includes(forbidden), `${family} companion requests forbidden ${forbidden} permission`);
  assert(manifest.permissions.includes("nativeMessaging"), `${family} companion requires native messaging`);
  assert(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(["http://*/*", "https://*/*"]), `${family} optional site permissions drifted`);
}

const digest = createHash("sha256").update(Buffer.from(chromium.key, "base64")).digest("hex").slice(0, 32);
const chromiumId = [...digest].map((value) => String.fromCharCode(97 + Number.parseInt(value, 16))).join("");
const firefoxId = firefox.browser_specific_settings?.gecko?.id;
assert(chromiumId === "fhphgomajpimcnpfjjgfgamnlnopahmd", "Chromium companion identity drifted");
assert(firefoxId === "omapilot-browser-companion@spencerbull.dev", "Firefox companion identity drifted");
for (const [label, source] of [["native host", host], ["installer", installer]]) {
  assert(source.includes(chromiumId), `${label} does not allow the Chromium companion ID`);
  assert(source.includes(firefoxId), `${label} does not allow the Firefox companion ID`);
}

process.stdout.write("Browser companion contract: ok\n");
