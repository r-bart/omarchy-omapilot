import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(runtimeRoot, "dist/quickchat-broker.js");

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
  legalComments: "external"
});
await chmod(output, 0o755);

for (const adapter of [
  { name: "codex-acp", entry: "@agentclientprotocol/codex-acp/dist/index.js" },
  { name: "claude-agent-acp", entry: "@agentclientprotocol/claude-agent-acp/dist/index.js" }
]) {
  const adapterOutput = resolve(runtimeRoot, `dist/adapters/${adapter.name}.js`);
  await mkdir(dirname(adapterOutput), { recursive: true });
  await build({
    entryPoints: [resolve(runtimeRoot, "../node_modules", adapter.entry)],
    outfile: adapterOutput,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
    legalComments: "external"
  });
  await chmod(adapterOutput, 0o755);
}
