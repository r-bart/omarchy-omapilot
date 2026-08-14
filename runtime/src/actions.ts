import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveExecutable } from "./process.js";

export type LocalLaunchAction = {
  kind: "launch_app";
  appName: string;
  desktopId: string;
  desktopFile: string;
};

export type LocalActionResolution =
  | { kind: "none" }
  | { kind: "unresolved"; appName: string }
  | { kind: "launch"; action: LocalLaunchAction };

export type LocalActionClient = {
  resolve(question: string): Promise<LocalActionResolution>;
  launch(action: LocalLaunchAction, signal?: AbortSignal): Promise<boolean>;
}

type DesktopEntry = LocalLaunchAction & { priority: number };

export class DesktopActionService implements LocalActionClient {
  readonly #env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.#env = env;
  }

  async resolve(question: string): Promise<LocalActionResolution> {
    const requested = requestedApplication(question);
    if (requested === undefined) return { kind: "none" };
    const normalized = normalizeName(requested);
    const entries = await this.#desktopEntries();
    const exact = entries.filter((entry) =>
      normalizeName(entry.appName) === normalized || normalizeName(entry.desktopId.replace(/\.desktop$/i, "")) === normalized
    );
    if (exact.length === 0) return { kind: "unresolved", appName: requested };
    const bestPriority = Math.min(...exact.map((entry) => entry.priority));
    const best = exact.filter((entry) => entry.priority === bestPriority);
    const unique = new Map(best.map((entry) => [entry.desktopFile, entry]));
    if (unique.size !== 1) return { kind: "unresolved", appName: requested };
    const selected = unique.values().next().value;
    if (selected === undefined) return { kind: "unresolved", appName: requested };
    return {
      kind: "launch",
      action: {
        kind: "launch_app",
        appName: selected.appName,
        desktopId: selected.desktopId,
        desktopFile: selected.desktopFile
      }
    };
  }

  async launch(action: LocalLaunchAction, signal?: AbortSignal): Promise<boolean> {
    if (isAborted(signal)) return false;
    const [uwsmApp, gtkLaunch] = await Promise.all([
      resolveExecutable("uwsm-app", this.#env),
      resolveExecutable("gtk-launch", this.#env)
    ]);
    if (isAborted(signal)) return false;
    if (uwsmApp !== undefined && gtkLaunch !== undefined)
      return runDetachedLauncher(uwsmApp, ["--", gtkLaunch, action.desktopId], this.#env, signal);
    const gio = await resolveExecutable("gio", this.#env);
    if (gio === undefined || isAborted(signal)) return false;
    return runDetachedLauncher(gio, ["launch", action.desktopFile], this.#env, signal);
  }

  async #desktopEntries(): Promise<DesktopEntry[]> {
    const entries: DesktopEntry[] = [];
    const directories = desktopDirectories(this.#env);
    for (let priority = 0; priority < directories.length; priority += 1) {
      const directory = directories[priority];
      if (directory === undefined) continue;
      let names: string[];
      try { names = await readdir(directory); }
      catch { continue; }
      for (const name of names.sort()) {
        if (!name.toLowerCase().endsWith(".desktop")) continue;
        if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}\.desktop$/.test(name)) continue;
        const desktopFile = join(directory, name);
        let source: string;
        try { source = await readFile(desktopFile, { encoding: "utf8", flag: "r" }); }
        catch { continue; }
        const parsed = parseDesktopEntry(source);
        if (parsed === undefined) continue;
        entries.push({
          kind: "launch_app",
          appName: parsed.name,
          desktopId: basename(name),
          desktopFile,
          priority
        });
      }
    }
    return entries;
  }
}

function requestedApplication(question: string): string | undefined {
  const match = /^(?:please\s+)?(?:open|launch|start)\s+(.+?)(?:\s+please)?[.!]?$/i.exec(question.trim());
  if (match === null) return undefined;
  const value = String(match[1] ?? "").trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._+'-]{0,79}$/u.test(value)) return undefined;
  if (/\s{2,}/.test(value) || value.includes("..") || /\b(?:and|then)\b/i.test(value)) return undefined;
  return value;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function desktopDirectories(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME;
  const dataHome = env.XDG_DATA_HOME ?? (home === undefined ? undefined : join(home, ".local", "share"));
  const dataDirs = (env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [dataHome, ...dataDirs].filter((value): value is string => value !== undefined).map((value) => join(value, "applications"));
}

function parseDesktopEntry(source: string): { name: string } | undefined {
  let inDesktopEntry = false;
  let type = "";
  let name = "";
  let hidden = false;
  let noDisplay = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inDesktopEntry = trimmed === "[Desktop Entry]";
      continue;
    }
    if (!inDesktopEntry || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).trim();
    if (key === "Type") type = value;
    else if (key === "Name") name = value;
    else if (key === "Hidden") hidden = value.toLowerCase() === "true";
    else if (key === "NoDisplay") noDisplay = value.toLowerCase() === "true";
  }
  if (type !== "Application" || name === "" || name.length > 120 || hasUnsafeText(name) || hidden || noDisplay) return undefined;
  return { name };
}

function hasUnsafeText(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function runDetachedLauncher(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal
): Promise<boolean> {
  return new Promise<boolean>((resolveLaunch) => {
    const child = spawn(executable, args, { env, stdio: "ignore", detached: true });
    child.unref();
    let settled = false;
    const onAbort = (): void => { child.kill("SIGTERM"); finish(false); };
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveLaunch(result);
    };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(false); }, 5_000);
    timer.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}
