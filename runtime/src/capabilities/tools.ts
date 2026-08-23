import { execFile } from "node:child_process";
import { closeSync, constants, lstatSync, openSync, opendirSync, readSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { Type, type Static } from "typebox";
import type { ToolDefinition } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.js";
import type { CapabilitySnapshot } from "./probes.js";
import type { CapabilityCommandRunner, CapabilityRisk } from "./types.js";

const MAX_COMMAND_OUTPUT = 96 * 1024;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_FILE_RESULTS = 100;
const MAX_DIRECTORY_ENTRIES = 2_000;
const MAX_SEARCH_DEPTH = 8;

const optionalAccount = Type.Optional(Type.String({ minLength: 1, maxLength: 160 }));
const threadId = Type.String({ minLength: 1, maxLength: 160, description: "Exact HEY thread ID returned by email_search" });
const date = Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", description: "Date in YYYY-MM-DD format" });

const noParameters = Type.Object({});
const emailSearchParameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 1_000 }),
  account: optionalAccount,
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
});
const emailThreadParameters = Type.Object({ threadId, account: optionalAccount });
const emailSendParameters = Type.Object({
  to: Type.String({ minLength: 3, maxLength: 1_000 }),
  subject: Type.String({ minLength: 1, maxLength: 500 }),
  message: Type.String({ minLength: 1, maxLength: 20_000 }),
  cc: Type.Optional(Type.String({ minLength: 3, maxLength: 1_000 })),
  bcc: Type.Optional(Type.String({ minLength: 3, maxLength: 1_000 })),
  account: optionalAccount
});
const emailReplyParameters = Type.Object({
  threadId,
  message: Type.String({ minLength: 1, maxLength: 20_000 }),
  account: optionalAccount
});
const calendarListParameters = Type.Object({ account: optionalAccount });
const calendarEventsParameters = Type.Object({
  calendarId: Type.String({ minLength: 1, maxLength: 160 }),
  startsOn: Type.Optional(date),
  endsOn: Type.Optional(date),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  account: optionalAccount
});
const calendarTodoListParameters = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  account: optionalAccount
});
const calendarTodoCreateParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 500 }),
  dueOn: Type.Optional(date),
  account: optionalAccount
});
const projectListParameters = Type.Object({});
const projectSearchParameters = Type.Object({ query: Type.String({ minLength: 1, maxLength: 1_000 }) });
const projectTodosParameters = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 160 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
});
const projectTodoCreateParameters = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 160 }),
  title: Type.String({ minLength: 1, maxLength: 1_000 })
});
const projectCommentParameters = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 160 }),
  recordingId: Type.String({ minLength: 1, maxLength: 160 }),
  message: Type.String({ minLength: 1, maxLength: 20_000 })
});
const relativePath = Type.Optional(Type.String({ maxLength: 4_096, description: "Path relative to the configured files root" }));
const filesListParameters = Type.Object({ path: relativePath });
const filesSearchParameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200 }),
  path: relativePath,
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_FILE_RESULTS }))
});
const filesPathParameters = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 4_096, description: "Path relative to the configured files root" })
});
const meetingJoinParameters = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 2_048, description: "Exact HTTPS Zoom meeting URL" })
});
const signalSendParameters = Type.Object({
  recipients: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { minItems: 1, maxItems: 10 }),
  message: Type.String({ minLength: 1, maxLength: 20_000 })
});

const RISKS: Readonly<Record<string, CapabilityRisk>> = {
  email_send: "external_write",
  email_reply: "external_write",
  calendar_todo_create: "external_write",
  project_todo_create: "external_write",
  project_comment: "external_write",
  signal_send: "external_write",
  files_open: "local_action",
  meeting_join: "local_action"
};
const ACP_READ_ONLY_TOOLS = new Set([
  "capabilities",
  "email_search", "email_thread",
  "calendar_list", "calendar_events", "calendar_todo_list",
  "files_list", "files_search", "files_read",
  "project_list", "project_search", "project_todos"
]);

export function capabilityToolRisk(name: string): CapabilityRisk | undefined {
  return RISKS[name];
}

export function capabilityToolAcpReadOnly(name: string): boolean {
  return ACP_READ_ONLY_TOOLS.has(name);
}

export function capabilityToolTitle(name: string, input: Record<string, unknown>): string | undefined {
  switch (name) {
    case "email_send": return `Send email: ${text(input.subject, "new message")}`;
    case "email_reply": return `Reply to HEY thread ${text(input.threadId, "unknown")}`;
    case "calendar_todo_create": return `Create calendar to-do: ${text(input.title, "untitled")}`;
    case "project_todo_create": return `Create Basecamp to-do: ${text(input.title, "untitled")}`;
    case "project_comment": return `Post Basecamp comment to ${text(input.recordingId, "unknown")}`;
    case "signal_send": return "Send Signal message";
    case "files_open": return `Open file: ${text(input.path, "unknown")}`;
    case "meeting_join": return "Open Zoom meeting";
    default: return undefined;
  }
}

export function capabilityReviewableInput(
  name: string,
  input: Record<string, unknown>
): Record<string, unknown> | undefined {
  const risk = capabilityToolRisk(name);
  if (risk === undefined) return undefined;
  switch (name) {
    case "email_send": return {
      command: `hey compose --to ${text(input.to, "unknown")} --subject ${text(input.subject, "unknown")}`,
      risk,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      message: input.message,
      account: input.account
    };
    case "email_reply": return {
      command: `hey reply ${text(input.threadId, "unknown")}`,
      risk,
      threadId: input.threadId,
      message: input.message,
      account: input.account
    };
    case "calendar_todo_create": return {
      command: `hey todo add ${text(input.title, "untitled")}`,
      risk,
      title: input.title,
      dueOn: input.dueOn,
      account: input.account
    };
    case "project_todo_create": return {
      command: `basecamp todos create ${text(input.title, "untitled")} --in ${text(input.projectId, "unknown")}`,
      risk,
      projectId: input.projectId,
      title: input.title
    };
    case "project_comment": return {
      command: `basecamp comments create ${text(input.recordingId, "unknown")} --in ${text(input.projectId, "unknown")}`,
      risk,
      projectId: input.projectId,
      recordingId: input.recordingId,
      message: input.message
    };
    case "signal_send": return {
      command: "POST signal-cli-rest-api /v2/send",
      risk,
      recipients: input.recipients,
      message: input.message
    };
    case "files_open": return { command: `xdg-open ${text(input.path, "unknown")}`, risk, path: input.path };
    case "meeting_join": return { command: `omarchy launch browser ${text(input.url, "invalid")}`, risk, url: input.url };
    default: return undefined;
  }
}

export const runCapabilityCommand: CapabilityCommandRunner = (file, args, signal) => new Promise((resolveRun, reject) => {
  execFile(file, args, { encoding: "utf8", maxBuffer: MAX_COMMAND_OUTPUT, timeout: 15_000, signal },
    (error, stdout, stderr) => error === null ? resolveRun({ stdout, stderr }) : reject(error));
});

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function available(snapshot: CapabilitySnapshot, id: string): boolean {
  return snapshot.views.some((view) => view.id === id && view.enabled && view.state === "ready");
}

function accountArgs(account: string | undefined): string[] {
  return account === undefined ? [] : ["--account", account];
}

function externalResult(connector: string, stdout: string): { content: Array<{ type: "text"; text: string }>; details: unknown } {
  let data: unknown;
  try { data = JSON.parse(stdout); }
  catch { data = { output: stdout.slice(0, MAX_COMMAND_OUTPUT) }; }
  const result = { source: { kind: "external", connector, untrusted: true }, data };
  return { content: [{ type: "text", text: JSON.stringify(result, undefined, 2) }], details: result };
}

function success(message: string, details: Record<string, unknown>): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  return { content: [{ type: "text", text: message }], details };
}

function failure(action: string): { content: Array<{ type: "text"; text: string }>; details: undefined; isError: true } {
  return { content: [{ type: "text", text: `${action} failed. Check the connector in Settings and try again.` }], details: undefined, isError: true };
}

function heyTool<T extends ReturnType<typeof Type.Object>>(
  definition: Omit<ToolDefinition<T>, "execute">,
  heyPath: string,
  args: (input: Static<T>) => string[],
  run: CapabilityCommandRunner
): ToolDefinition<T> {
  return {
    ...definition,
    async execute(_toolCallId, input, signal) {
      try { return externalResult("HEY", (await run(heyPath, args(input), signal)).stdout); }
      catch { return failure(definition.label); }
    }
  };
}

function basecampTool<T extends ReturnType<typeof Type.Object>>(
  definition: Omit<ToolDefinition<T>, "execute">,
  basecampPath: string,
  args: (input: Static<T>) => string[],
  run: CapabilityCommandRunner
): ToolDefinition<T> {
  return {
    ...definition,
    async execute(_toolCallId, input, signal) {
      try { return externalResult("Basecamp", (await run(basecampPath, args(input), signal)).stdout); }
      catch { return failure(definition.label); }
    }
  };
}

function assertInsideRoot(root: string, rawPath = ""): string {
  if (rawPath.includes("\0")) throw new Error("invalid path");
  const candidate = resolve(root, rawPath === "" ? "." : rawPath);
  const lexical = relative(root, candidate);
  if (lexical === ".." || lexical.startsWith(`..${sep}`) || lexical.startsWith(sep)) throw new Error("path escaped root");
  const canonical = realpathSync(candidate);
  const actual = relative(root, canonical);
  if (actual === ".." || actual.startsWith(`..${sep}`) || actual.startsWith(sep)) throw new Error("symlink escaped root");
  return canonical;
}

function relativeDisplay(root: string, absolute: string): string {
  const value = relative(root, absolute);
  return value === "" ? "." : value;
}

function listFiles(root: string, rawPath: string | undefined): Array<Record<string, unknown>> {
  const directory = assertInsideRoot(root, rawPath);
  if (!statSync(directory).isDirectory()) throw new Error("not a directory");
  const results: Array<Record<string, unknown>> = [];
  const handle = opendirSync(directory);
  try {
    while (results.length < MAX_DIRECTORY_ENTRIES) {
      const entry = handle.readSync();
      if (entry === null) break;
      const absolute = resolve(directory, entry.name);
      const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other";
      results.push({ name: entry.name.slice(0, 500), path: relativeDisplay(root, absolute), kind });
    }
  } finally {
    handle.closeSync();
  }
  return results;
}

function searchFiles(root: string, rawPath: string | undefined, query: string, limit: number): Array<Record<string, unknown>> {
  const start = assertInsideRoot(root, rawPath);
  if (!statSync(start).isDirectory()) throw new Error("not a directory");
  const needle = query.toLocaleLowerCase();
  const results: Array<Record<string, unknown>> = [];
  const pending: Array<{ path: string; depth: number }> = [{ path: start, depth: 0 }];
  let inspected = 0;
  while (pending.length > 0 && results.length < limit && inspected < MAX_DIRECTORY_ENTRIES) {
    const current = pending.shift();
    if (current === undefined) break;
    const handle = opendirSync(current.path);
    try {
      while (inspected < MAX_DIRECTORY_ENTRIES && results.length < limit) {
        const entry = handle.readSync();
        if (entry === null) break;
        inspected += 1;
        const absolute = resolve(current.path, entry.name);
        if (entry.name.toLocaleLowerCase().includes(needle)) {
          results.push({ path: relativeDisplay(root, absolute), kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" });
        }
        if (entry.isDirectory() && !entry.isSymbolicLink() && current.depth < MAX_SEARCH_DEPTH) {
          pending.push({ path: absolute, depth: current.depth + 1 });
        }
      }
    } finally {
      handle.closeSync();
    }
  }
  return results;
}

function readTextFile(root: string, rawPath: string): { path: string; text: string; truncated: boolean } {
  const absolute = assertInsideRoot(root, rawPath);
  const stat = lstatSync(absolute);
  if (!stat.isFile()) throw new Error("not a file");
  const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
  const file = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  let count: number;
  try { count = readSync(file, buffer, 0, buffer.length, 0); }
  finally { closeSync(file); }
  const bytes = buffer.subarray(0, count);
  if (bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0)) throw new Error("binary file");
  const truncated = stat.size > MAX_FILE_BYTES || count > MAX_FILE_BYTES;
  return { path: relativeDisplay(root, absolute), text: bytes.subarray(0, MAX_FILE_BYTES).toString("utf8"), truncated };
}

export type SignalSender = (endpoint: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<boolean>;

export const postSignalMessage: SignalSender = async (endpoint, body, signal) => {
  const response = await fetch(new URL("/v2/send", endpoint), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal === undefined ? AbortSignal.timeout(20_000) : AbortSignal.any([signal, AbortSignal.timeout(20_000)])
  });
  await response.body?.cancel();
  return response.ok;
};

export function createCapabilityTools(
  snapshot: CapabilitySnapshot,
  run: CapabilityCommandRunner = runCapabilityCommand,
  sendSignal: SignalSender = postSignalMessage
): ToolDefinition[] {
  const tools: ToolDefinition[] = [{
    name: "capabilities",
    label: "Inspect personal capabilities",
    description: "List configured personal capability packs, connector readiness, and available operations before choosing a tool.",
    promptSnippet: "Inspect the user's configured personal capability packs",
    parameters: noParameters,
    execute() {
      return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(snapshot.views, undefined, 2) }], details: snapshot.views });
    }
  }];

  if (snapshot.heyPath !== undefined && available(snapshot, "email")) {
    tools.push(
      heyTool({ name: "email_search", label: "Search HEY email", description: "Search HEY email and return bounded untrusted connector data.", promptSnippet: "Search the user's HEY email", parameters: emailSearchParameters }, snapshot.heyPath,
        (input) => ["search", text(input.query, ""), "--page", String(input.page ?? 1), ...accountArgs(input.account), "--json"], run),
      heyTool({ name: "email_thread", label: "Read HEY thread", description: "Read one exact HEY thread returned by email_search.", promptSnippet: "Read one HEY email thread", parameters: emailThreadParameters }, snapshot.heyPath,
        (input) => ["threads", text(input.threadId, ""), ...accountArgs(input.account), "--json"], run),
      heyTool({ name: "email_send", label: "Send HEY email", description: "Send a new HEY email after the user reviews the exact recipients, subject, and message.", promptSnippet: "Send a reviewed HEY email", parameters: emailSendParameters }, snapshot.heyPath,
        (input) => ["compose", "--to", text(input.to, ""), "--subject", text(input.subject, ""), "--message", text(input.message, ""),
          ...(input.cc === undefined ? [] : ["--cc", String(input.cc)]), ...(input.bcc === undefined ? [] : ["--bcc", String(input.bcc)]),
          ...accountArgs(input.account), "--json"], run),
      heyTool({ name: "email_reply", label: "Reply in HEY", description: "Reply to one exact HEY thread after the user reviews the message.", promptSnippet: "Send a reviewed reply in HEY", parameters: emailReplyParameters }, snapshot.heyPath,
        (input) => ["reply", text(input.threadId, ""), "--message", text(input.message, ""), ...accountArgs(input.account), "--json"], run)
    );
  }

  if (snapshot.heyPath !== undefined && available(snapshot, "calendar")) {
    tools.push(
      heyTool({ name: "calendar_list", label: "List HEY calendars", description: "List calendars available through HEY.", promptSnippet: "List the user's HEY calendars", parameters: calendarListParameters }, snapshot.heyPath,
        (input) => ["calendars", ...accountArgs(input.account), "--json"], run),
      heyTool({ name: "calendar_events", label: "Read HEY calendar", description: "Read bounded events and to-dos from one exact HEY calendar.", promptSnippet: "Read a HEY calendar", parameters: calendarEventsParameters }, snapshot.heyPath,
        (input) => ["recordings", text(input.calendarId, ""), "--limit", String(input.limit ?? 25),
          ...(input.startsOn === undefined ? [] : ["--starts-on", String(input.startsOn)]),
          ...(input.endsOn === undefined ? [] : ["--ends-on", String(input.endsOn)]),
          ...accountArgs(input.account), "--json"], run),
      heyTool({ name: "calendar_todo_list", label: "List HEY to-dos", description: "List bounded personal to-dos from HEY.", promptSnippet: "List the user's HEY to-dos", parameters: calendarTodoListParameters }, snapshot.heyPath,
        (input) => ["todo", "list", "--limit", String(input.limit ?? 25), ...accountArgs(input.account), "--json"], run),
      heyTool({ name: "calendar_todo_create", label: "Create HEY to-do", description: "Create one HEY to-do after the user reviews its title and due date.", promptSnippet: "Create a reviewed HEY to-do", parameters: calendarTodoCreateParameters }, snapshot.heyPath,
        (input) => ["todo", "add", text(input.title, ""), ...(input.dueOn === undefined ? [] : ["--date", String(input.dueOn)]),
          ...accountArgs(input.account), "--json"], run)
    );
  }

  if (snapshot.filesRoot !== undefined && available(snapshot, "files")) {
    const root = snapshot.filesRoot;
    const filesList: ToolDefinition<typeof filesListParameters> = {
        name: "files_list", label: "List scoped files", description: "List one directory inside the explicitly configured files root.",
        promptSnippet: "List files inside the configured files root", parameters: filesListParameters,
        execute(_id, input) {
          try { return Promise.resolve(externalResult("files", JSON.stringify(listFiles(root, input.path)))); }
          catch { return Promise.resolve(failure("Listing files")); }
        }
      };
    const filesSearch: ToolDefinition<typeof filesSearchParameters> = {
        name: "files_search", label: "Search scoped files", description: "Search names within the configured files root without following symlinks.",
        promptSnippet: "Search file names inside the configured files root", parameters: filesSearchParameters,
        execute(_id, input) {
          try { return Promise.resolve(externalResult("files", JSON.stringify(searchFiles(root, input.path, input.query, input.limit ?? 25)))); }
          catch { return Promise.resolve(failure("Searching files")); }
        }
      };
    const filesRead: ToolDefinition<typeof filesPathParameters> = {
        name: "files_read", label: "Read scoped text file", description: "Read at most 128 KiB from one text file inside the configured files root.",
        promptSnippet: "Read a text file inside the configured files root", parameters: filesPathParameters,
        execute(_id, input) {
          try { return Promise.resolve(externalResult("files", JSON.stringify(readTextFile(root, input.path)))); }
          catch { return Promise.resolve(failure("Reading the file")); }
        }
      };
    const filesOpen: ToolDefinition<typeof filesPathParameters> = {
        name: "files_open", label: "Open scoped file", description: "Open one exact file from the configured files root in its default installed application.",
        promptSnippet: "Open a reviewed file in its default application", parameters: filesPathParameters,
        async execute(_id, input, signal) {
          try {
            const absolute = assertInsideRoot(root, input.path);
            await run("xdg-open", [absolute], signal);
            return success("Opened the file in its default application.", { path: relativeDisplay(root, absolute) });
          } catch { return failure("Opening the file"); }
        }
      };
    tools.push(filesList, filesSearch, filesRead, filesOpen);
  }

  if (snapshot.basecampPath !== undefined && available(snapshot, "projects")) {
    tools.push(
      basecampTool({ name: "project_list", label: "List Basecamp projects", description: "List projects from the authenticated Basecamp account.", promptSnippet: "List the user's Basecamp projects", parameters: projectListParameters }, snapshot.basecampPath,
        () => ["projects", "list", "--agent"], run),
      basecampTool({ name: "project_search", label: "Search Basecamp", description: "Search Basecamp projects and return bounded untrusted connector data.", promptSnippet: "Search the user's Basecamp projects", parameters: projectSearchParameters }, snapshot.basecampPath,
        (input) => ["search", text(input.query, ""), "--agent"], run),
      basecampTool({ name: "project_todos", label: "List Basecamp to-dos", description: "List bounded to-dos in one exact Basecamp project.", promptSnippet: "List Basecamp project to-dos", parameters: projectTodosParameters }, snapshot.basecampPath,
        (input) => ["todos", "list", "--in", text(input.projectId, ""), "--limit", String(input.limit ?? 25), "--agent"], run),
      basecampTool({ name: "project_todo_create", label: "Create Basecamp to-do", description: "Create one Basecamp to-do after the user reviews the exact project and title.", promptSnippet: "Create a reviewed Basecamp to-do", parameters: projectTodoCreateParameters }, snapshot.basecampPath,
        (input) => ["todos", "create", text(input.title, ""), "--in", text(input.projectId, ""), "--agent"], run),
      basecampTool({ name: "project_comment", label: "Post Basecamp comment", description: "Post one comment after the user reviews the exact project, recording, and message.", promptSnippet: "Post a reviewed Basecamp comment", parameters: projectCommentParameters }, snapshot.basecampPath,
        (input) => ["comments", "create", text(input.recordingId, ""), text(input.message, ""), "--in", text(input.projectId, ""), "--agent"], run)
    );
  }

  if (snapshot.signalEndpoint !== undefined && snapshot.signalNumber !== undefined && available(snapshot, "messages")) {
    const endpoint = snapshot.signalEndpoint;
    const number = snapshot.signalNumber;
    const signalSend: ToolDefinition<typeof signalSendParameters> = {
      name: "signal_send",
      label: "Send Signal message",
      description: "Send one text message through the private loopback Signal bridge after the user reviews every recipient and the message.",
      promptSnippet: "Send a reviewed Signal message",
      parameters: signalSendParameters,
      async execute(_id, input, signal) {
        try {
          const sent = await sendSignal(endpoint, {
            number,
            recipients: input.recipients,
            message: input.message
          }, signal);
          return sent
            ? success("The private Signal bridge accepted the message request.", { recipients: input.recipients })
            : failure("Sending the Signal message");
        } catch { return failure("Sending the Signal message"); }
      }
    };
    tools.push(signalSend);
  }

  if (snapshot.omarchyPath !== undefined && available(snapshot, "meetings")) {
    const omarchyPath = snapshot.omarchyPath;
    const meetingJoin: ToolDefinition<typeof meetingJoinParameters> = {
      name: "meeting_join",
      label: "Join Zoom meeting",
      description: "Open one exact HTTPS Zoom meeting URL through the configured Omarchy browser handler.",
      promptSnippet: "Open a reviewed Zoom meeting URL",
      parameters: meetingJoinParameters,
      async execute(_id, input, signal) {
        try {
          const url = new URL(input.url);
          if (url.protocol !== "https:" || (url.hostname !== "zoom.us" && !url.hostname.endsWith(".zoom.us"))
            || url.username !== "" || url.password !== "") throw new Error("not a Zoom URL");
          await run(omarchyPath, ["launch", "browser", url.href], signal);
          return success("Opened the Zoom meeting through Omarchy.", { url: url.href });
        } catch { return failure("Opening the Zoom meeting"); }
      }
    };
    tools.push(meetingJoin);
  }

  return tools;
}
