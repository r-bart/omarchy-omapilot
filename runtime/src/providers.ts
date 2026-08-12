import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Capability, ProviderId, ProviderInfo } from "./types.js";
import { quickchatPaths } from "./paths.js";
import { resolveExecutable, runCommand, stripAnsi } from "./process.js";

export type AgentCommand = { executable: string; args: string[]; env: NodeJS.ProcessEnv };
export type DiscoveredProvider = ProviderInfo & { harnessPath: string; agent: AgentCommand };

const providerNames: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode"
};

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

async function adapterExecutable(provider: "codex" | "claude", env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const explicit = env[provider === "codex" ? "QUICKCHAT_CODEX_ACP" : "QUICKCHAT_CLAUDE_ACP"];
  const binary = provider === "codex" ? "codex-acp" : "claude-agent-acp";
  const paths = quickchatPaths(env);
  const candidates = [
    explicit,
    resolve(repoRoot(), `runtime/bin/${binary}`),
    resolve(repoRoot(), `node_modules/.bin/${binary}`),
    resolve(paths.adapters, `${provider}/current/bin/${binary}`)
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

async function authenticated(provider: ProviderId, path: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (provider === "codex") {
    return (await runCommand(path, ["login", "status"], { env, timeoutMs: 8_000, maxOutput: 64_000 })).code === 0;
  }
  if (provider === "claude") {
    const result = await runCommand(path, ["auth", "status"], { env, timeoutMs: 8_000, maxOutput: 64_000 });
    if (result.code !== 0) return false;
    try {
      const value: unknown = JSON.parse(result.stdout);
      return typeof value === "object" && value !== null && "loggedIn" in value && value.loggedIn === true;
    } catch {
      return false;
    }
  }
  const result = await runCommand(path, ["--pure", "auth", "list"], { env, timeoutMs: 8_000, maxOutput: 64_000 });
  const output = stripAnsi(result.stdout + result.stderr);
  return result.code === 0 && /Credentials/u.test(output) && /(?:●|oauth|api)/iu.test(output);
}

async function version(path: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const result = await runCommand(path, ["--version"], { env, timeoutMs: 5_000, maxOutput: 4_096 });
  if (result.code !== 0) return undefined;
  const safe = stripAnsi(result.stdout).trim().split("\n")[0]?.replaceAll(/[^a-zA-Z0-9._+ -]/g, "").slice(0, 80);
  return safe === "" ? undefined : safe;
}

function agentEnvironment(provider: ProviderId, harnessPath: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (provider === "codex") {
    return { ...env, CODEX_PATH: harnessPath, INITIAL_AGENT_MODE: "read-only", NO_BROWSER: "1" };
  }
  if (provider === "claude") return { ...env, CLAUDE_CODE_EXECUTABLE: harnessPath };
  return { ...env, OPENCODE_PERMISSION: JSON.stringify({ "*": "deny" }) };
}

export async function discoverProviders(env: NodeJS.ProcessEnv = process.env): Promise<DiscoveredProvider[]> {
  const found: DiscoveredProvider[] = [];
  for (const id of ["codex", "claude", "opencode"] satisfies ProviderId[]) {
    const harnessPath = await resolveExecutable(id, env);
    if (harnessPath === undefined || !await authenticated(id, harnessPath, env)) continue;
    let executable: string | undefined;
    let args: string[];
    if (id === "opencode") {
      executable = harnessPath;
      args = ["--pure", "acp"];
    } else {
      executable = await adapterExecutable(id, env);
      args = [];
    }
    if (executable === undefined) continue;
    const capabilities: Capability[] = ["answer", "web"];
    const providerVersion = await version(harnessPath, env);
    found.push({
      id,
      name: providerNames[id],
      ...(providerVersion === undefined ? {} : { version: providerVersion }),
      models: [],
      capabilities,
      harnessPath,
      agent: { executable, args, env: agentEnvironment(id, harnessPath, env) }
    });
  }
  return found;
}

export async function fallbackModels(provider: DiscoveredProvider): Promise<Array<{ id: string; name: string }>> {
  if (provider.id !== "opencode") return [];
  const result = await runCommand(provider.harnessPath, ["--pure", "models"], {
    env: provider.agent.env,
    timeoutMs: 15_000,
    maxOutput: 2_000_000
  });
  if (result.code !== 0) return [];
  return [...new Set(stripAnsi(result.stdout).split("\n").map((line) => line.trim()).filter((line) => /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/+-]+$/u.test(line)))]
    .map((id) => ({ id, name: id }));
}
