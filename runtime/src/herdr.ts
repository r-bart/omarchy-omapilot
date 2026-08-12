import type { ChatRecord, ProviderId } from "./types.js";
import { resolveExecutable, runCommand } from "./process.js";

type HerdrCommand = { executable: string; args: string[] };
type CommandRunner = (executable: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

function parseResult(output: string): unknown {
  try {
    const envelope: unknown = JSON.parse(output);
    return typeof envelope === "object" && envelope !== null && "result" in envelope ? envelope.result : undefined;
  } catch {
    return undefined;
  }
}

function objectString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
  return typeof entry === "string" ? entry : undefined;
}

function nestedObject(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
}

export function nativeResumeArgs(provider: ProviderId, sessionId: string): string[] | undefined {
  if (provider === "codex") return ["resume", sessionId, "-s", "read-only", "-a", "never"];
  if (provider === "claude") return ["--resume", sessionId];
  return ["--pure", "--session", sessionId];
}

export function transcriptPrompt(chat: ChatRecord): string {
  return [
    "Continue this Quickchat conversation. The prior session could not be attached natively, so this is a transcript handoff.",
    "",
    "## Question",
    chat.question,
    "",
    "## Answer",
    chat.answer,
    "",
    "Continue from this context and wait for my next instruction."
  ].join("\n");
}

export async function continueInHerdr(
  chat: ChatRecord,
  env: NodeJS.ProcessEnv = process.env,
  runner?: CommandRunner
): Promise<{ mode: "native" | "transcript" }> {
  const herdr = await resolveExecutable("herdr", env);
  if (herdr === undefined) throw new Error("Herdr is not installed");
  const run = runner ?? (async (executable, args) => runCommand(executable, args, { env, timeoutMs: 35_000, maxOutput: 256_000 }));
  const listed = await run(herdr, ["workspace", "list"]);
  if (listed.code !== 0) throw new Error("Herdr is not available");
  const listResult = parseResult(listed.stdout);
  const workspaceId = findQuickchatWorkspace(listResult);
  let paneId: string | undefined;
  if (workspaceId === undefined) {
    const created = await run(herdr, ["workspace", "create", "--cwd", process.cwd(), "--label", "Quickchat", "--no-focus"]);
    if (created.code !== 0) throw new Error("Herdr could not create the Quickchat workspace");
    const createdResult = parseResult(created.stdout);
    paneId = objectString(nestedObject(createdResult, "root_pane"), "pane_id");
    const createdTab = objectString(nestedObject(createdResult, "tab"), "tab_id");
    if (createdTab !== undefined) await run(herdr, ["tab", "rename", createdTab, chat.title.slice(0, 60)]);
  } else {
    const created = await run(herdr, ["tab", "create", "--workspace", workspaceId, "--cwd", process.cwd(), "--label", chat.title.slice(0, 60), "--no-focus"]);
    if (created.code !== 0) throw new Error("Herdr could not create a Quickchat tab");
    paneId = objectString(nestedObject(parseResult(created.stdout), "root_pane"), "pane_id");
  }
  if (paneId === undefined) throw new Error("Herdr did not return a target pane");
  const agentName = `quickchat-${chat.id.slice(0, 8)}`;
  const resume = !chat.session.resumable || chat.session.acpId === undefined ? undefined : nativeResumeArgs(chat.provider, chat.session.acpId);
  const startArgs = ["agent", "start", agentName, "--kind", chat.provider, "--pane", paneId, "--timeout", "30000"];
  if (resume !== undefined) startArgs.push("--", ...resume);
  let started = await run(herdr, startArgs);
  let mode: "native" | "transcript" = resume === undefined ? "transcript" : "native";
  if (started.code !== 0 && resume !== undefined) {
    mode = "transcript";
    started = await run(herdr, ["agent", "start", agentName, "--kind", chat.provider, "--pane", paneId, "--timeout", "30000"]);
  }
  if (started.code !== 0) throw new Error("Herdr could not start the selected harness");
  if (mode === "transcript") {
    const prompted = await run(herdr, ["agent", "prompt", agentName, transcriptPrompt(chat), "--wait", "--until", "idle", "--until", "done", "--timeout", "30000"]);
    if (prompted.code !== 0) throw new Error("Herdr started, but the transcript handoff failed");
  }
  await run(herdr, ["agent", "focus", agentName]);
  const launcher = await resolveExecutable("omarchy-launch-or-focus-tui", env);
  if (launcher !== undefined) await run(launcher, ["--app-id=org.omarchy.herdr", herdr]);
  return { mode };
}

function findQuickchatWorkspace(result: unknown): string | undefined {
  const workspaces = nestedObject(result, "workspaces");
  if (!Array.isArray(workspaces)) return undefined;
  for (const workspace of workspaces) {
    if (objectString(workspace, "label")?.toLowerCase() === "quickchat") return objectString(workspace, "workspace_id");
  }
  return undefined;
}

export function herdrLauncherCommand(herdr: string, launcher: string): HerdrCommand {
  return { executable: launcher, args: ["--app-id=org.omarchy.herdr", herdr] };
}
