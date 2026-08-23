import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { omapilotPaths } from "../paths.js";
import { CAPABILITY_IDS, type CapabilityConfig, type CapabilityId } from "./types.js";

const MAX_CONFIG_BYTES = 128 * 1024;
const ids = new Set<string>(CAPABILITY_IDS);

export class CapabilityConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CapabilityConfigError";
    this.code = code;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaults(): CapabilityConfig {
  return { version: 1, enabled: {}, files: {} };
}

export function capabilityConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(omapilotPaths(env).config, "capabilities.json");
}

export function readCapabilityConfig(env: NodeJS.ProcessEnv = process.env): CapabilityConfig {
  const path = capabilityConfigPath(env);
  let raw: unknown;
  try {
    if (statSync(path).size > MAX_CONFIG_BYTES) {
      throw new CapabilityConfigError("capability_config_too_large", "The capability configuration is unexpectedly large");
    }
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return defaults();
    if (error instanceof CapabilityConfigError) throw error;
    throw new CapabilityConfigError("capability_config_invalid", "The capability configuration could not be read");
  }
  if (!isObject(raw) || raw.version !== 1) {
    throw new CapabilityConfigError("capability_config_invalid", "The capability configuration must use schema version 1");
  }
  const enabled: CapabilityConfig["enabled"] = {};
  if (isObject(raw.enabled)) {
    for (const [id, value] of Object.entries(raw.enabled)) {
      if (ids.has(id) && typeof value === "boolean") enabled[id as CapabilityId] = value;
    }
  }
  const files: CapabilityConfig["files"] = {};
  if (isObject(raw.files) && typeof raw.files.root === "string" && raw.files.root !== "") {
    const root = normalizeFilesRoot(raw.files.root, env);
    if (root !== undefined) files.root = root;
  }
  return { version: 1, enabled, files };
}

function writeCapabilityConfig(config: CapabilityConfig, env: NodeJS.ProcessEnv): void {
  const path = capabilityConfigPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function setCapabilityEnabled(
  id: CapabilityId,
  enabled: boolean,
  env: NodeJS.ProcessEnv = process.env
): CapabilityConfig {
  const config = readCapabilityConfig(env);
  config.enabled[id] = enabled;
  writeCapabilityConfig(config, env);
  return config;
}

export function normalizeFilesRoot(raw: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = raw.trim();
  if (value === "") return undefined;
  if (!isAbsolute(value) || value.length > 4096) {
    throw new CapabilityConfigError("invalid_files_root", "Choose an existing absolute folder");
  }
  let root: string;
  try {
    root = realpathSync(resolve(value));
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new CapabilityConfigError("invalid_files_root", "Choose an existing readable folder");
  }
  const home = realpathSync(env.HOME ?? homedir());
  if (root === "/" || root === home) {
    throw new CapabilityConfigError("files_root_too_broad", "Choose a folder inside your home directory or a specific mounted drive");
  }
  return root;
}

export function setFilesRoot(raw: string, env: NodeJS.ProcessEnv = process.env): CapabilityConfig {
  const config = readCapabilityConfig(env);
  const root = normalizeFilesRoot(raw, env);
  config.files = root === undefined ? {} : { root };
  writeCapabilityConfig(config, env);
  return config;
}
