import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./process.js";

// Voxtype's floating OSD draws its own waveform at the bottom centre of the
// focused output — exactly where OmaPilot's voice node lives. Two indicators for
// one state is worse than either alone, so the user gets a switch.
//
// Voxtype documents a master switch for it: with `[osd] enabled = false` both
// OSD frontends exit immediately at launch and the daemon renders nothing. Its
// own `voxtype config set` only supports `engine`, so the value has to be edited
// in place here.
//
// This is a deliberate, narrowly scoped exception to OmaPilot's rule about not
// editing another tool's configuration: it happens only on an explicit user
// action from settings, touches exactly one key, preserves the rest of the file
// byte-for-byte, and keeps a `.omapilot.bak` copy of the original.

const MAX_CONFIG_BYTES = 512 * 1024;
const OSD_SECTION = /^[ \t]*\[osd\][ \t]*$/mu;
// A bare `enabled` assignment. Anchored per-line so a key inside a nested table
// or a commented-out line is never matched.
const ENABLED_LINE = /^[ \t]*enabled[ \t]*=[ \t]*(true|false)[ \t]*$/mu;

export type VoxtypeOsdStatus = {
  available: boolean;
  enabled: boolean;
  configPath: string;
  message?: string;
};

export function voxtypeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.startsWith("/") === true
    ? env.XDG_CONFIG_HOME
    : join(env.HOME ?? homedir(), ".config");
  return join(base, "voxtype", "config.toml");
}

function readConfig(path: string): string | undefined {
  try {
    if (statSync(path).size > MAX_CONFIG_BYTES) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Find the `[osd]` table's body. TOML tables run until the next table header, so
 * the section ends at the first following line that opens one.
 */
function osdSectionBounds(text: string): { start: number; end: number } | undefined {
  const header = OSD_SECTION.exec(text);
  if (header === null) return undefined;
  const start = header.index + header[0].length;
  const rest = text.slice(start);
  const next = /^[ \t]*\[[^\]]+\][ \t]*$/mu.exec(rest);
  return { start, end: next === null ? text.length : start + next.index };
}

export function readOsdEnabled(text: string): boolean {
  const bounds = osdSectionBounds(text);
  // Voxtype's default is on, so an absent section or key means the OSD shows.
  if (bounds === undefined) return true;
  const match = ENABLED_LINE.exec(text.slice(bounds.start, bounds.end));
  return match === null ? true : match[1] === "true";
}

/**
 * Return `text` with `[osd] enabled` set, preserving every other byte —
 * comments, ordering, and unrelated keys included.
 */
export function withOsdEnabled(text: string, enabled: boolean): string {
  const value = enabled ? "true" : "false";
  const bounds = osdSectionBounds(text);

  if (bounds === undefined) {
    const separator = text.length === 0 || text.endsWith("\n") ? "" : "\n";
    return `${text}${separator}\n# Added by OmaPilot: its voice node already indicates recording.\n[osd]\nenabled = ${value}\n`;
  }

  const body = text.slice(bounds.start, bounds.end);
  const match = ENABLED_LINE.exec(body);
  if (match !== null) {
    const replaced = `${body.slice(0, match.index)}enabled = ${value}${body.slice(match.index + match[0].length)}`;
    return text.slice(0, bounds.start) + replaced + text.slice(bounds.end);
  }
  // Section exists without the key: insert it as the section's first entry.
  return `${text.slice(0, bounds.start)}\nenabled = ${value}${body}${text.slice(bounds.end)}`;
}

export function voxtypeOsdStatus(env: NodeJS.ProcessEnv = process.env): VoxtypeOsdStatus {
  const configPath = voxtypeConfigPath(env);
  const text = readConfig(configPath);
  if (text === undefined) {
    return { available: false, enabled: true, configPath, message: "Voxtype configuration was not found" };
  }
  return { available: true, enabled: readOsdEnabled(text), configPath };
}

export async function setVoxtypeOsdEnabled(
  enabled: boolean,
  env: NodeJS.ProcessEnv = process.env
): Promise<VoxtypeOsdStatus> {
  const configPath = voxtypeConfigPath(env);
  const text = readConfig(configPath);
  if (text === undefined) {
    return { available: false, enabled: true, configPath, message: "Voxtype configuration was not found" };
  }

  const next = withOsdEnabled(text, enabled);
  if (next !== text) {
    // Keep one copy of whatever was there before this ever ran, so the user can
    // always get their original file back.
    const backup = `${configPath}.omapilot.bak`;
    if (!existsSync(backup)) copyFileSync(configPath, backup);
    const temporary = `${configPath}.${process.pid}.tmp`;
    writeFileSync(temporary, next, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, configPath);
  }

  // The daemon reads the OSD config at startup, so the change is inert until it
  // restarts. A failure here is reported rather than swallowed: the file is
  // already correct and a manual restart still applies it.
  const restart = await runCommand("systemctl", ["--user", "restart", "voxtype.service"],
    { env, timeoutMs: 15_000, maxOutput: 16_384 });
  if (restart.code !== 0) {
    return {
      available: true,
      enabled,
      configPath,
      message: "Saved, but the Voxtype daemon did not restart. Run: systemctl --user restart voxtype.service"
    };
  }
  return { available: true, enabled, configPath };
}
