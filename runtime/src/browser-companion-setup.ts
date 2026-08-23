import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { resolveExecutable, runCommand } from "./process.js";
import { pluginRoot } from "./runtime-root.js";

export type BrowserFamily = "chromium" | "firefox";

export type BrowserCompanionSetupStatus = {
  relayInstalled: boolean;
  setupAvailable: boolean;
  chromiumExtensionPath: string;
  firefoxExtensionPath: string;
};

function repositoryRoot(): string {
  return pluginRoot(import.meta.url);
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
  return {
    relayInstalled,
    setupAvailable,
    chromiumExtensionPath: resolve(root, "browser-companion/dist/chromium"),
    firefoxExtensionPath: resolve(root, "browser-companion/dist/firefox")
  };
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

export async function uninstallBrowserCompanion(
  env: NodeJS.ProcessEnv,
  root = repositoryRoot()
): Promise<boolean> {
  const installer = resolve(root, "scripts/install-browser-companion.sh");
  if (!await executable(installer)) return false;
  const result = await runCommand(installer, ["uninstall"], {
    env, cwd: root, timeoutMs: 30_000, maxOutput: 64_000
  });
  return result.code === 0;
}

export async function openBrowserCompanionSettings(
  family: BrowserFamily,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  const candidates = family === "firefox"
    ? ["firefox", "zen-browser", "zen", "librewolf"]
    : ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "brave", "brave-browser", "microsoft-edge-stable", "vivaldi-stable", "helium"];
  let executablePath: string | undefined;
  for (const candidate of candidates) {
    executablePath = await resolveExecutable(candidate, env);
    if (executablePath !== undefined) break;
  }
  if (executablePath === undefined) return false;
  const url = family === "firefox" ? "about:debugging#/runtime/this-firefox" : "chrome://extensions";
  return new Promise<boolean>((resolveLaunch) => {
    const child = spawn(executablePath, [url], { env, stdio: "ignore", detached: true });
    child.once("error", () => resolveLaunch(false));
    child.once("spawn", () => {
      child.unref();
      resolveLaunch(true);
    });
  });
}
