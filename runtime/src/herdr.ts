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

export function nativeResumeArgs(provider: ProviderId, sessionId: string, cwd = process.cwd()): string[] | undefined {
  // Continue in Herdr deliberately hands authority back to the native harness.
  // Keep Codex interactive so any command outside its read-only sandbox still
  // requires the user's approval in Herdr.
  if (provider === "codex") return ["resume", sessionId, "-C", cwd, "-s", "read-only", "-a", "on-request"];
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
  const launcher = await resolveExecutable("omarchy-launch-or-focus-tui", env);
  if (launcher === undefined) throw new Error("The Omarchy Herdr launcher is not installed");
  const focusedWindow = await run(launcher, ["--app-id=org.omarchy.herdr", herdr]);
  if (focusedWindow.code !== 0) throw new Error("Herdr could not be opened or focused");
  let listed = await run(herdr, ["workspace", "list"]);
  for (let attempt = 0; listed.code !== 0 && attempt < 19; attempt += 1) {
    await delay(250);
    listed = await run(herdr, ["workspace", "list"]);
  }
  if (listed.code !== 0) throw new Error("Herdr is not available");
  const listResult = parseResult(listed.stdout);
  let workspaceId = findQuickchatWorkspace(listResult);
  let tabId: string | undefined;
  let paneId: string | undefined;
  if (workspaceId === undefined) {
    const created = await run(herdr, ["workspace", "create", "--cwd", process.cwd(), "--label", "Quickchat", "--no-focus"]);
    if (created.code !== 0) throw new Error("Herdr could not create the Quickchat workspace");
    const createdResult = parseResult(created.stdout);
    paneId = objectString(nestedObject(createdResult, "root_pane"), "pane_id");
    tabId = objectString(nestedObject(createdResult, "tab"), "tab_id") ?? objectString(createdResult, "tab_id");
    workspaceId = objectString(nestedObject(createdResult, "workspace"), "workspace_id")
      ?? objectString(createdResult, "workspace_id")
      ?? workspaceFromTab(tabId);
    if (tabId !== undefined) await run(herdr, ["tab", "rename", tabId, chat.title.slice(0, 60)]);
  } else {
    const created = await run(herdr, ["tab", "create", "--workspace", workspaceId, "--cwd", process.cwd(), "--label", chat.title.slice(0, 60), "--no-focus"]);
    if (created.code !== 0) throw new Error("Herdr could not create a Quickchat tab");
    const createdResult = parseResult(created.stdout);
    paneId = objectString(nestedObject(createdResult, "root_pane"), "pane_id");
    tabId = objectString(nestedObject(createdResult, "tab"), "tab_id") ?? objectString(createdResult, "tab_id");
  }
  if (workspaceId === undefined || tabId === undefined || paneId === undefined)
    throw new Error("Herdr did not return a complete workspace target");
  const agentName = `quickchat-${chat.id.slice(0, 8)}`;
  // A just-created Herdr pane can precede its interactive shell by a fraction
  // of a second. Give it one bounded readiness beat before agent detection.
  await delay(250);
  const resume = !chat.session.resumable || chat.session.acpId === undefined
    ? undefined
    : nativeResumeArgs(chat.provider, chat.session.acpId, process.cwd());
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
  for (const command of herdrSessionFocusCommands(herdr, workspaceId, tabId, agentName)) {
    const focused = await run(command.executable, command.args);
    if (focused.code !== 0) throw new Error("Herdr could not focus the continued session");
  }
  return { mode };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function workspaceFromTab(tabId: string | undefined): string | undefined {
  if (tabId === undefined) return undefined;
  const separator = tabId.indexOf(":");
  return separator > 0 ? tabId.slice(0, separator) : undefined;
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

export function herdrFocusCommands(
  herdr: string,
  launcher: string,
  workspaceId: string,
  tabId: string,
  agentName: string
): HerdrCommand[] {
  return [
    herdrLauncherCommand(herdr, launcher),
    ...herdrSessionFocusCommands(herdr, workspaceId, tabId, agentName)
  ];
}

function herdrSessionFocusCommands(
  herdr: string,
  workspaceId: string,
  tabId: string,
  agentName: string
): HerdrCommand[] {
  return [
    { executable: herdr, args: ["workspace", "focus", workspaceId] },
    { executable: herdr, args: ["tab", "focus", tabId] },
    { executable: herdr, args: ["agent", "focus", agentName] }
  ];
}
