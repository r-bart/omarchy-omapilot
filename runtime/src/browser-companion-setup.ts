import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./process.js";

export type BrowserCompanionSetupStatus = {
  relayInstalled: boolean;
  setupAvailable: boolean;
};

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function relayPath(env: NodeJS.ProcessEnv): string {
  const dataRoot = env.XDG_DATA_HOME?.startsWith("/")
    ? env.XDG_DATA_HOME
    : join(env.HOME ?? "/tmp", ".local/share");
  return join(dataRoot, "omapilot/browser-companion/omapilot-browser-companion-host");
}

export async function browserCompanionSetupStatus(
  env: NodeJS.ProcessEnv,
  root = repositoryRoot()
): Promise<BrowserCompanionSetupStatus> {
  const installer = resolve(root, "scripts/install-browser-companion.sh");
  const [relayInstalled, setupAvailable] = await Promise.all([
    executable(relayPath(env)), executable(installer)
  ]);
  return { relayInstalled, setupAvailable };
}

export async function installBrowserCompanion(
  env: NodeJS.ProcessEnv,
  root = repositoryRoot()
): Promise<boolean> {
  const installer = resolve(root, "scripts/install-browser-companion.sh");
  if (!await executable(installer)) return false;
  const result = await runCommand(installer, ["install", "--development", "--no-build"], {
    env, cwd: root, timeoutMs: 30_000, maxOutput: 64_000
  });
  return result.code === 0;
}
