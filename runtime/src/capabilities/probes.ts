import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveExecutable, runCommand } from "../process.js";
import { CapabilityConfigError, readCapabilityConfig } from "./config.js";
import type {
  CapabilityConfig,
  CapabilityId,
  CapabilityOperationView,
  CapabilityState,
  CapabilityView
} from "./types.js";

export type CapabilitySnapshot = {
  config: CapabilityConfig;
  views: CapabilityView[];
  heyPath?: string;
  basecampPath?: string;
  signalEndpoint?: string;
  signalNumber?: string;
  filesRoot?: string;
  omarchyPath?: string;
};

type ConnectorProbe = { state: CapabilityState; status: string; path?: string; setupHint?: string };

const operation = (id: string, label: string, risk: CapabilityOperationView["risk"]): CapabilityOperationView => ({
  id, label, risk, available: true
});

const operations = {
  email: [
    operation("search", "Search mail", "inspect"),
    operation("read", "Read a thread", "inspect"),
    operation("send", "Send or reply", "external_write")
  ],
  calendar: [
    operation("calendars", "List calendars", "inspect"),
    operation("events", "Read events", "inspect"),
    operation("todo_list", "Read to-dos", "inspect"),
    operation("todo_create", "Create a to-do", "external_write")
  ],
  files: [
    operation("list", "List files", "inspect"),
    operation("search", "Search files", "inspect"),
    operation("read", "Read text files", "inspect"),
    operation("open", "Open a file", "local_action")
  ],
  projects: [
    operation("list", "List projects", "inspect"),
    operation("search", "Search projects", "inspect"),
    operation("todo_list", "Read project to-dos", "inspect"),
    operation("todo_create", "Create a project to-do", "external_write"),
    operation("comment", "Post comments", "external_write")
  ],
  messages: [
    operation("send", "Send messages", "external_write")
  ],
  meetings: [operation("join", "Join a Zoom meeting", "local_action")]
} satisfies Record<CapabilityId, CapabilityOperationView[]>;

function parsedObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function heyProbe(env: NodeJS.ProcessEnv): Promise<ConnectorProbe> {
  const path = await resolveExecutable("hey", env);
  if (path === undefined) return {
    state: "missing_connector",
    status: "HEY CLI is not installed",
    setupHint: "Install hey-cli, then sign in from Settings or a terminal."
  };
  const result = await runCommand(path, ["auth", "status", "--json"], { env, timeoutMs: 8_000, maxOutput: 64_000 });
  const payload = parsedObject(result.stdout);
  const data = payload?.data;
  const authenticated = typeof data === "object" && data !== null && !Array.isArray(data)
    && (data as Record<string, unknown>).authenticated === true;
  return authenticated && result.code === 0
    ? { state: "ready", status: "Authenticated with HEY", path }
    : { state: "needs_setup", status: "HEY CLI needs authentication", path, setupHint: "Run hey auth login to connect HEY." };
}

async function basecampProbe(env: NodeJS.ProcessEnv): Promise<ConnectorProbe> {
  const path = await resolveExecutable("basecamp", env);
  if (path === undefined) return {
    state: "missing_connector",
    status: "Basecamp CLI is not installed",
    setupHint: "Install the official basecamp-cli package, then run basecamp auth login."
  };
  const result = await runCommand(path, ["doctor", "--json"], { env, timeoutMs: 8_000, maxOutput: 64_000 });
  return result.code === 0
    ? { state: "ready", status: "Basecamp CLI is authenticated", path }
    : { state: "needs_setup", status: "Basecamp CLI needs authentication", path, setupHint: "Run basecamp auth login to connect Basecamp." };
}

async function signalProbe(env: NodeJS.ProcessEnv): Promise<ConnectorProbe> {
  const endpoint = env.OMAPILOT_SIGNAL_API_URL?.trim();
  const number = env.OMAPILOT_SIGNAL_NUMBER?.trim();
  if (endpoint === undefined || endpoint === "") return {
    state: "needs_setup",
    status: "Signal Desktop is not an automation connector",
    setupHint: "Pair a private signal-cli-rest-api service as a linked device."
  };
  try {
    const url = new URL(endpoint);
    const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    if (!loopback || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== ""
      || (url.pathname !== "" && url.pathname !== "/")) throw new Error("unsafe endpoint");
    if (number === undefined || !/^\+[1-9][0-9]{6,14}$/u.test(number)) return {
      state: "needs_setup",
      status: "Signal bridge needs its linked sender number",
      setupHint: "Set OMAPILOT_SIGNAL_NUMBER to the linked Signal number in E.164 format."
    };
    const about = new URL("/v1/about", url);
    const response = await fetch(about, { signal: AbortSignal.timeout(3_000), headers: { accept: "application/json" } });
    await response.body?.cancel();
    return response.ok
      ? { state: "ready", status: "Private Signal bridge is connected", path: url.origin }
      : { state: "degraded", status: "Signal bridge did not pass its health check" };
  } catch {
    return { state: "degraded", status: "Signal endpoint must be a healthy loopback HTTP service" };
  }
}

function filesProbe(config: CapabilityConfig): ConnectorProbe {
  const root = config.files.root;
  if (root === undefined) return {
    state: "needs_configuration",
    status: "Choose a specific local or synced folder",
    setupHint: "Select a Dropbox folder or another bounded files root."
  };
  try {
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
    return { state: "ready", status: "Scoped to one configured folder", path: root };
  } catch {
    return { state: "degraded", status: "The configured files folder is unavailable", path: root };
  }
}

async function meetingsProbe(env: NodeJS.ProcessEnv): Promise<ConnectorProbe> {
  const omarchyPath = await resolveExecutable("omarchy", env);
  const home = env.HOME ?? "";
  const zoomEntry = home !== "" && existsSync(join(home, ".local/share/applications/Zoom.desktop"));
  if (omarchyPath === undefined) return { state: "missing_connector", status: "Omarchy browser launcher is unavailable" };
  return {
    state: "ready",
    status: zoomEntry ? "Zoom links use the configured Omarchy Zoom handler" : "Zoom links open in the default browser",
    path: omarchyPath
  };
}

function view(
  id: CapabilityId,
  label: string,
  description: string,
  connector: string,
  probe: ConnectorProbe,
  config: CapabilityConfig
): CapabilityView {
  const enabled = config.enabled[id] !== false;
  const active = enabled ? probe.state : "disabled";
  return {
    id,
    label,
    description,
    connector,
    state: active,
    status: enabled ? probe.status : "Disabled by the user",
    enabled,
    operations: operations[id].map((item) => ({ ...item, available: enabled && probe.state === "ready" })),
    ...(id === "files" ? { configuration: { ...(config.files.root === undefined ? {} : { filesRoot: config.files.root }) } } : {}),
    ...(probe.setupHint === undefined ? {} : { setupHint: probe.setupHint })
  };
}

export async function discoverCapabilitySnapshot(env: NodeJS.ProcessEnv = process.env): Promise<CapabilitySnapshot> {
  let config: CapabilityConfig;
  try {
    config = readCapabilityConfig(env);
  } catch (error) {
    if (!(error instanceof CapabilityConfigError)) throw error;
    const fallback: CapabilityConfig = { version: 1, enabled: {}, files: {} };
    return {
      config: fallback,
      views: [
        view("email", "Email", "Read, search, and send email.", "HEY", { state: "degraded", status: error.message }, fallback),
        view("calendar", "Calendar", "Review events and manage personal to-dos.", "HEY", { state: "degraded", status: error.message }, fallback),
        view("files", "Files", "Work inside one explicitly selected folder.", "Local folder", { state: "degraded", status: error.message }, fallback),
        view("projects", "Projects", "Search and update Basecamp work.", "Basecamp", { state: "degraded", status: error.message }, fallback),
        view("messages", "Messages", "Send Signal messages through a private bridge.", "Signal", { state: "degraded", status: error.message }, fallback),
        view("meetings", "Meetings", "Find and join Zoom meetings.", "Zoom", { state: "degraded", status: error.message }, fallback)
      ]
    };
  }
  const [hey, basecamp, meetings] = await Promise.all([
    heyProbe(env).catch(() => ({ state: "degraded" as const, status: "HEY CLI could not be checked" })),
    basecampProbe(env).catch(() => ({ state: "degraded" as const, status: "Basecamp CLI could not be checked" })),
    meetingsProbe(env).catch(() => ({ state: "degraded" as const, status: "Meeting integration could not be checked" }))
  ]);
  const files = filesProbe(config);
  const signal = await signalProbe(env);
  const views = [
    view("email", "Email", "Read, search, and send email.", "HEY", hey, config),
    view("calendar", "Calendar", "Review events and manage personal to-dos.", "HEY", hey, config),
    view("files", "Files", "Work inside one explicitly selected folder.", "Local folder", files, config),
    view("projects", "Projects", "Search and update Basecamp work.", "Basecamp", basecamp, config),
    view("messages", "Messages", "Send Signal messages through a private bridge.", "Signal", signal, config),
    view("meetings", "Meetings", "Find and join Zoom meetings.", "Zoom", meetings, config)
  ];
  const signalNumber = env.OMAPILOT_SIGNAL_NUMBER?.trim();
  return {
    config,
    views,
    ...(hey.state === "ready" ? { heyPath: hey.path } : {}),
    ...(basecamp.state === "ready" ? { basecampPath: basecamp.path } : {}),
    ...(signal.state === "ready" && signal.path !== undefined && signalNumber !== undefined
      ? { signalEndpoint: signal.path, signalNumber } : {}),
    ...(files.state === "ready" ? { filesRoot: files.path } : {}),
    ...(meetings.state === "ready" ? { omarchyPath: meetings.path } : {})
  };
}
