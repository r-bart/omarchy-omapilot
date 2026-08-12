import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(runtimeRoot, "dist/quickchat-broker.js");
const projectRoot = await realpath(resolve(runtimeRoot, ".."));

await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(runtimeRoot, "src/index.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "external",
  absWorkingDir: projectRoot
});
await chmod(output, 0o755);

for (const adapter of [
  { name: "codex-acp", entry: "@agentclientprotocol/codex-acp/dist/index.js" },
  { name: "claude-agent-acp", entry: "@agentclientprotocol/claude-agent-acp/dist/index.js" }
]) {
  const adapterOutput = resolve(runtimeRoot, `dist/adapters/${adapter.name}.js`);
  await mkdir(dirname(adapterOutput), { recursive: true });
  await build({
    entryPoints: [`node_modules/${adapter.entry}`],
    outfile: adapterOutput,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: false,
    legalComments: "external",
    absWorkingDir: projectRoot
  });
  const generatedAdapter = await readFile(adapterOutput, "utf8");
  const adapterSource = generatedAdapter.replaceAll(/^\/\/ .*\/node_modules\//gm, "// node_modules/");
  if (adapterSource !== generatedAdapter) await writeFile(adapterOutput, adapterSource);
  if (!adapterSource.startsWith("#!/usr/bin/env node\n") || adapterSource.startsWith("#!/usr/bin/env node\n#!")) {
    throw new Error(`${adapter.name} must contain exactly one leading Node.js shebang`);
  }
  await chmod(adapterOutput, 0o755);
}
