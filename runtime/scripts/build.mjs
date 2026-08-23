import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateThirdPartyLicenses } from "./generate-third-party-licenses.mjs";
import { embeddedNodeExecutable } from "../launcher/embedded-node-launcher.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = await realpath(resolve(runtimeRoot, ".."));
const distRoot = resolve(runtimeRoot, "dist");
const workRoot = await mkdtemp(resolve(tmpdir(), "omapilot-runtime-build-"));
const runtimeBanner = "var __omapilotImportMetaUrl=require('node:url').pathToFileURL(__filename).href;";

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("OmaPilot runtime builds require Linux x86-64");
}

async function embeddedExecutable(payloadPath, outputPath, rootLevels) {
  await mkdir(dirname(outputPath), { recursive: true });
  const payload = await readFile(payloadPath);
  await writeFile(outputPath, embeddedNodeExecutable(payload, rootLevels));
  await chmod(outputPath, 0o755);
}

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  sourcemap: false,
  define: { "import.meta.url": "__omapilotImportMetaUrl" },
  banner: { js: runtimeBanner },
  legalComments: "external",
  absWorkingDir: projectRoot
};

try {
  await mkdir(resolve(distRoot, "adapters"), { recursive: true });

  const licenseBundle = resolve(workRoot, "omapilot-broker-license.js");
  await build({
    entryPoints: ["runtime/src/index.ts"],
    outfile: licenseBundle,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: true,
    legalComments: "external",
    absWorkingDir: projectRoot
  });
  const sourceMap = JSON.parse(await readFile(`${licenseBundle}.map`, "utf8"));
  if (!Array.isArray(sourceMap.sources)) throw new Error("broker source map must contain sources");
  sourceMap.sources = sourceMap.sources.map((source) => {
    if (typeof source !== "string") throw new Error("broker source map source must be a string");
    const nodeModules = source.indexOf("node_modules/");
    return nodeModules < 0 ? source : `../../${source.slice(nodeModules)}`;
  });
  await generateThirdPartyLicenses({
    projectRoot,
    sourceMap,
    lockPath: resolve(projectRoot, "package-lock.json"),
    outputPath: resolve(distRoot, "omapilot-broker.THIRD_PARTY_LICENSES.txt")
  });

  const brokerPayload = resolve(workRoot, "omapilot-broker.cjs");
  await build({ ...common, entryPoints: ["runtime/src/index.ts"], outfile: brokerPayload });
  await embeddedExecutable(brokerPayload, resolve(distRoot, "omapilot-broker"), 3);
  await copyFile(`${brokerPayload}.LEGAL.txt`, resolve(distRoot, "omapilot-broker.LEGAL.txt"));

  const capabilityMcpOutput = resolve(distRoot, "capability-mcp.js");
  await build({
    ...common,
    format: "esm",
    entryPoints: ["runtime/src/capability-mcp.ts"],
    outfile: capabilityMcpOutput,
    banner: { js: "#!/usr/bin/env node" }
  });
  await chmod(capabilityMcpOutput, 0o755);

  const adapterPayload = resolve(workRoot, "codex-acp.cjs");
  await build({
    ...common,
    entryPoints: ["node_modules/@agentclientprotocol/codex-acp/dist/index.js"],
    outfile: adapterPayload
  });
  await embeddedExecutable(adapterPayload, resolve(distRoot, "adapters/codex-acp"), 4);

  await Promise.all([
    resolve(distRoot, "omapilot-broker.js"),
    resolve(distRoot, "omapilot-broker.js.map"),
    resolve(distRoot, "omapilot-broker.js.LEGAL.txt"),
    resolve(distRoot, "capability-mcp.js.map"),
    resolve(distRoot, "adapters/codex-acp.js")
  ].map((path) => rm(path, { force: true })));
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
