import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  capabilityReviewableInput,
  capabilityToolRisk,
  createCapabilityTools,
  type SignalSender
} from "../src/capabilities/tools.js";
import type { CapabilitySnapshot } from "../src/capabilities/probes.js";
import type { CapabilityCommandRunner, CapabilityId, CapabilityView } from "../src/capabilities/types.js";
import { normalizeToolPermission } from "../src/permissions.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const definitions: Record<CapabilityId, [string, string]> = {
  email: ["Email", "HEY"], calendar: ["Calendar", "HEY"], files: ["Files", "Local folder"],
  projects: ["Projects", "Basecamp"], messages: ["Messages", "Signal"], meetings: ["Meetings", "Zoom"]
};

function view(id: CapabilityId, state: CapabilityView["state"] = "ready"): CapabilityView {
  return {
    id, label: definitions[id][0], description: id, connector: definitions[id][1], state,
    status: state, enabled: state !== "disabled", operations: []
  };
}

function tool(tools: ReturnType<typeof createCapabilityTools>, name: string) {
  const match = tools.find((candidate) => candidate.name === name);
  if (match === undefined) throw new Error(`missing tool ${name}`);
  return match;
}

describe("capability tools", () => {
  it("registers ready packs and maps connector calls to fixed argv", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const run: CapabilityCommandRunner = (file, args) => {
      calls.push({ file, args });
      return Promise.resolve({ stdout: '{"ok":true,"data":[]}', stderr: "" });
    };
    const signals: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    const sendSignal: SignalSender = (endpoint, body) => {
      signals.push({ endpoint, body });
      return Promise.resolve(true);
    };
    const snapshot: CapabilitySnapshot = {
      config: { version: 1, enabled: {}, files: {} },
      views: [view("email"), view("calendar"), view("projects"), view("messages"), view("meetings"), view("files", "needs_configuration")],
      heyPath: "/connectors/hey",
      basecampPath: "/connectors/basecamp",
      signalEndpoint: "http://127.0.0.1:9922",
      signalNumber: "+15551234567",
      omarchyPath: "/usr/bin/omarchy"
    };
    const tools = createCapabilityTools(snapshot, run, sendSignal);
    expect(tools.map((item) => item.name)).toEqual(expect.arrayContaining([
      "capabilities", "email_search", "email_send", "calendar_events", "calendar_todo_create",
      "project_list", "project_search", "project_todos", "project_todo_create", "project_comment",
      "signal_send", "meeting_join"
    ]));
    expect(tools.map((item) => item.name)).not.toContain("files_read");

    await tool(tools, "email_search").execute("email", { query: "launch plan", page: 2, account: "work" }, undefined, undefined, {} as never);
    await tool(tools, "project_todos").execute("todos", { projectId: "123", limit: 10 }, undefined, undefined, {} as never);
    await tool(tools, "meeting_join").execute("meeting", { url: "https://us02web.zoom.us/j/123" }, undefined, undefined, {} as never);
    await tool(tools, "signal_send").execute("signal", { recipients: ["+15557654321"], message: "Hello" }, undefined, undefined, {} as never);
    expect(calls).toEqual([
      { file: "/connectors/hey", args: ["search", "launch plan", "--page", "2", "--account", "work", "--json"] },
      { file: "/connectors/basecamp", args: ["todos", "list", "--in", "123", "--limit", "10", "--agent"] },
      { file: "/usr/bin/omarchy", args: ["launch", "browser", "https://us02web.zoom.us/j/123"] }
    ]);
    expect(signals).toEqual([{ endpoint: "http://127.0.0.1:9922", body: {
      number: "+15551234567", recipients: ["+15557654321"], message: "Hello"
    } }]);
  });

  it("keeps external writes one-shot and fully reviewable", () => {
    const rawInput = capabilityReviewableInput("email_send", {
      to: "person@example.com", subject: "Decision", message: "The complete message"
    });
    expect(capabilityToolRisk("email_send")).toBe("external_write");
    const permission = normalizeToolPermission("turn", "11111111-1111-4111-8111-111111111111", "builtin", {
      sessionId: "turn",
      toolCall: { toolCallId: "send", kind: "execute", title: "Send email", rawInput },
      options: [
        { optionId: "once", name: "Allow once", kind: "allow_once" },
        { optionId: "session", name: "Allow for session", kind: "allow_always" },
        { optionId: "always", name: "Always allow", kind: "allow_always" },
        { optionId: "deny", name: "Deny", kind: "reject_once" }
      ]
    });
    expect(permission?.view).toMatchObject({ risk: "external_write", detail: expect.stringContaining("The complete message") });
    expect(permission?.view.options).toEqual([
      { id: "option-0", decision: "allow_once", label: "Allow once" },
      { id: "option-3", decision: "reject_once", label: "Deny" }
    ]);
  });

  it("contains file reads and opens inside the configured canonical root", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-files-tool-"));
    roots.push(root);
    const outside = await mkdtemp(join(tmpdir(), "omapilot-files-outside-"));
    roots.push(outside);
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes/plan.txt"), "launch plan");
    await writeFile(join(root, "notes/large.txt"), `${"x".repeat(128 * 1024)}outside-bound`);
    await writeFile(join(outside, "secret.txt"), "outside");
    await symlink(join(outside, "secret.txt"), join(root, "notes/escape.txt"));
    const calls: Array<{ file: string; args: string[] }> = [];
    const run: CapabilityCommandRunner = (file, args) => {
      calls.push({ file, args });
      return Promise.resolve({ stdout: "", stderr: "" });
    };
    const tools = createCapabilityTools({
      config: { version: 1, enabled: {}, files: { root } },
      views: [view("files")], filesRoot: root
    }, run);
    const read = await tool(tools, "files_read").execute("read", { path: "notes/plan.txt" }, undefined, undefined, {} as never);
    expect(JSON.stringify(read)).toContain("launch plan");
    const escaped = await tool(tools, "files_read").execute("escape", { path: "notes/escape.txt" }, undefined, undefined, {} as never);
    expect(escaped).toMatchObject({ isError: true });
    const large = await tool(tools, "files_read").execute("large", { path: "notes/large.txt" }, undefined, undefined, {} as never);
    expect(large).toMatchObject({ details: { data: { truncated: true } } });
    expect(JSON.stringify(large)).not.toContain("outside-bound");
    await tool(tools, "files_open").execute("open", { path: "notes/plan.txt" }, undefined, undefined, {} as never);
    expect(calls).toEqual([{ file: "xdg-open", args: [join(root, "notes/plan.txt")] }]);
  });
});
