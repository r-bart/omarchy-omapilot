import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersonalAssistantTools,
  discoverInstalledApps,
  readDesktopState,
  reviewDesktopToolInput,
  windowActionCommand,
  workspaceActionCommand,
  type DesktopCommandRunner
} from "../src/tools/desktop.js";
import { normalizeToolPermission } from "../src/permissions.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type MutableDesktop = {
  activeAddress: string | undefined;
  window: {
    address: string;
    class: string;
    initialClass: string;
    workspace: number;
    monitor: number;
    size: [number, number];
    floating: boolean;
  } | undefined;
  workspaceMonitor: string;
  launched?: boolean;
};

function desktopRunner(state: MutableDesktop, calls: Array<{ file: string; args: string[] }>): DesktopCommandRunner {
  return (file, args) => {
    calls.push({ file, args });
    if (file === "uwsm-app") {
      state.launched = true;
      state.window = {
        address: "0xbbb", class: "ExampleEditor", initialClass: "ExampleEditor",
        workspace: 1, monitor: 0, size: [900, 700], floating: false
      };
      state.activeAddress = "0xbbb";
      return Promise.resolve({ stdout: "", stderr: "" });
    }
    if (file === "omarchy") {
      const appId = args.find((argument) => argument.startsWith("--app-id="))?.slice("--app-id=".length);
      state.launched = true;
      state.window = {
        address: "0xccc", class: appId ?? "kitty", initialClass: appId ?? "kitty",
        workspace: 1, monitor: 0, size: [900, 700], floating: false
      };
      state.activeAddress = "0xccc";
      return Promise.resolve({ stdout: "", stderr: "" });
    }
    if (file !== "hyprctl") return Promise.reject(new Error(`unexpected command: ${file}`));
    if (args[0] === "dispatch") {
      const dispatcher = args[1] ?? "";
      const address = /address:(0x[0-9a-f]+)/u.exec(dispatcher)?.[1];
      if (dispatcher.startsWith("hl.dsp.focus({ window")) state.activeAddress = address;
      if (dispatcher.startsWith("hl.dsp.window.move")) {
        const workspace = /workspace = (\d+)/u.exec(dispatcher)?.[1];
        if (state.window !== undefined && workspace !== undefined) state.window.workspace = Number(workspace);
      }
      if (dispatcher.startsWith("hl.dsp.window.resize")) {
        const match = /x = (\d+), y = (\d+)/u.exec(dispatcher);
        if (match !== null && state.window !== undefined) {
          state.window.size = [Number(match[1]), Number(match[2])];
        }
      }
      if (dispatcher.startsWith("hl.dsp.window.float") && state.window !== undefined) state.window.floating = !state.window.floating;
      if (dispatcher.startsWith("hl.dsp.window.close")) state.window = undefined;
      if (dispatcher.startsWith("hl.dsp.focus({ workspace")) state.activeAddress = undefined;
      if (dispatcher.startsWith("hl.dsp.workspace.move")) {
        state.workspaceMonitor = /monitor = "([A-Za-z0-9_.:-]+)"/u.exec(dispatcher)?.[1] ?? state.workspaceMonitor;
      }
      return Promise.resolve({ stdout: "ok\n", stderr: "" });
    }
    const client = state.window === undefined ? undefined : {
      address: state.window.address,
      class: state.window.class,
      initialClass: state.window.initialClass,
      title: "Private document title",
      pid: 42,
      workspace: { id: state.window.workspace, name: String(state.window.workspace) },
      monitor: state.window.monitor,
      at: [10, 20],
      size: state.window.size,
      floating: state.window.floating,
      fullscreen: 0,
      pseudo: false,
      pinned: false,
      grouped: [],
      mapped: true,
      hidden: false
    };
    const key = args.join(" ");
    if (key === "-j activewindow") {
      return Promise.resolve({ stdout: JSON.stringify(client !== undefined && client.address === state.activeAddress ? client : {}), stderr: "" });
    }
    if (key === "-j activeworkspace") {
      return Promise.resolve({ stdout: JSON.stringify({ id: 1, name: "1", monitor: state.workspaceMonitor }), stderr: "" });
    }
    if (key === "-j monitors all") {
      return Promise.resolve({ stdout: JSON.stringify([
        { id: 0, name: "eDP-1", description: "Internal", focused: true, activeWorkspace: { id: 1 }, x: 0, y: 0, width: 1920, height: 1200, scale: 1 },
        { id: 1, name: "DP-1", description: "External", focused: false, activeWorkspace: { id: 2 }, x: 1920, y: 0, width: 2560, height: 1440, scale: 1 }
      ]), stderr: "" });
    }
    if (key === "-j workspaces") {
      return Promise.resolve({ stdout: JSON.stringify([
        { id: 1, name: "1", monitor: state.workspaceMonitor, monitorID: state.workspaceMonitor === "eDP-1" ? 0 : 1, windows: client === undefined ? 0 : 1, hasfullscreen: false },
        { id: 2, name: "2", monitor: "DP-1", monitorID: 1, windows: 0, hasfullscreen: false }
      ]), stderr: "" });
    }
    if (key === "-j clients") return Promise.resolve({ stdout: JSON.stringify(client === undefined ? [] : [client]), stderr: "" });
    return Promise.reject(new Error(`unexpected hyprctl call: ${key}`));
  };
}

async function appFixture(): Promise<{ root: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(join(tmpdir(), "omapilot-desktop-tools-"));
  roots.push(root);
  const applications = join(root, "share/applications");
  const bin = join(root, "bin");
  await Promise.all([mkdir(applications, { recursive: true }), mkdir(bin, { recursive: true })]);
  await writeFile(join(applications, "org.example.Editor.desktop"), [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Example Editor",
    "Comment=Edit documents",
    "StartupWMClass=ExampleEditor"
  ].join("\n"));
  await writeFile(join(bin, "example-cli"), "#!/bin/sh\n");
  await chmod(join(bin, "example-cli"), 0o755);
  return { root, env: { HOME: root, XDG_DATA_HOME: join(root, "share"), XDG_DATA_DIRS: "", PATH: bin } };
}

describe("structured desktop tools", () => {
  it("discovers exact desktop and CLI entries from bounded host catalogs", async () => {
    const fixture = await appFixture();
    expect(discoverInstalledApps("Example", "all", 20, fixture.env)).toEqual([
      expect.objectContaining({ kind: "desktop", id: "org.example.Editor", startupWmClass: "ExampleEditor" }),
      expect.objectContaining({ kind: "cli", id: "example-cli" })
    ]);
    expect(discoverInstalledApps("example-cli", "cli", 20, fixture.env)[0]).toMatchObject({ id: "example-cli" });
  });

  it("maps only exact, bounded Hyprland argv", () => {
    expect(windowActionCommand({ action: "focus", address: "0xABC", pid: 42 })).toEqual({
      file: "hyprctl", args: ["dispatch", 'hl.dsp.focus({ window = "address:0xabc" })']
    });
    expect(windowActionCommand({ action: "move_to_workspace", address: "0xabc", pid: 42, workspace: 7, follow: false })).toEqual({
      file: "hyprctl", args: ["dispatch", 'hl.dsp.window.move({ window = "address:0xabc", workspace = 7, follow = false })']
    });
    expect(windowActionCommand({ action: "resize", address: "0xabc", pid: 42, width: 1200, height: 800 })).toEqual({
      file: "hyprctl", args: ["dispatch", 'hl.dsp.window.resize({ window = "address:0xabc", x = 1200, y = 800 })']
    });
    expect(workspaceActionCommand({ action: "move_to_monitor", workspace: 3, monitor: "DP-1" })).toEqual({
      file: "hyprctl", args: ["dispatch", 'hl.dsp.workspace.move({ workspace = 3, monitor = "DP-1" })']
    });
    expect(() => windowActionCommand({ action: "focus", address: "title:Terminal", pid: 42 })).toThrow(/exact window address/u);
    expect(() => windowActionCommand({ action: "focus", address: "0xabc", pid: 0 })).toThrow(/exact window PID/u);
    expect(() => workspaceActionCommand({ action: "move_to_monitor", workspace: 3, monitor: "DP-1; reboot" })).toThrow(/exact monitor/u);
  });

  it("renders app actions as reviewable normalized approvals", () => {
    const rawInput = reviewDesktopToolInput("app_open", {
      kind: "desktop", id: "org.example.Editor", mode: "focus_or_launch"
    });
    expect(rawInput).toMatchObject({
      command: "app_open --kind desktop --id org.example.Editor --mode focus_or_launch",
      operation: "app_open",
      kind: "desktop",
      id: "org.example.Editor",
      mode: "focus_or_launch"
    });
    const permission = normalizeToolPermission("request", "permission", "builtin", {
      sessionId: "request",
      toolCall: { toolCallId: "call", kind: "execute", title: "Open app", rawInput },
      options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }]
    });
    expect(permission?.view.options).toEqual([{ id: "option-0", decision: "allow_once", label: "Allow once" }]);
    expect(permission?.view.detail).toContain("org.example.Editor");
  });

  it("returns exact geometry and hides window titles unless requested", async () => {
    const state: MutableDesktop = {
      activeAddress: "0xaaa",
      window: { address: "0xaaa", class: "kitty", initialClass: "kitty", workspace: 1, monitor: 0, size: [800, 600], floating: false },
      workspaceMonitor: "eDP-1"
    };
    const run = desktopRunner(state, []);
    const privateState = await readDesktopState(run, false);
    expect(privateState.windows[0]).toMatchObject({ address: "0xaaa", position: [10, 20], size: [800, 600], workspace: 1, monitor: 0 });
    expect(privateState.windows[0]).not.toHaveProperty("title");
    expect((await readDesktopState(run, true)).windows[0]).toHaveProperty("title", "Private document title");
  });

  it("re-reads and verifies exact window resize, move, and desired floating state", async () => {
    const state: MutableDesktop = {
      activeAddress: "0xaaa",
      window: { address: "0xaaa", class: "kitty", initialClass: "kitty", workspace: 1, monitor: 0, size: [800, 600], floating: false },
      workspaceMonitor: "eDP-1"
    };
    const calls: Array<{ file: string; args: string[] }> = [];
    const tools = createPersonalAssistantTools(desktopRunner(state, calls), {});
    const windowTool = tools[3];
    const resized = await windowTool.execute("resize", {
      action: "resize", address: "0xaaa", pid: 42, width: 1200, height: 800
    }, undefined, undefined, {} as never);
    expect(resized).toMatchObject({ details: { action: "resize", changed: true, verified: true, after: { size: [1200, 800] } } });
    const moved = await windowTool.execute("move", {
      action: "move_to_workspace", address: "0xaaa", pid: 42, workspace: 2, follow: false
    }, undefined, undefined, {} as never);
    expect(moved).toMatchObject({ details: { action: "move_to_workspace", verified: true, after: { workspace: 2 } } });
    const dispatchesBefore = calls.filter((call) => call.args[0] === "dispatch").length;
    const unchanged = await windowTool.execute("floating", {
      action: "set_floating", address: "0xaaa", pid: 42, enabled: false
    }, undefined, undefined, {} as never);
    expect(unchanged).toMatchObject({ details: { action: "set_floating", changed: false, verified: true } });
    expect(calls.filter((call) => call.args[0] === "dispatch")).toHaveLength(dispatchesBefore);
  });

  it("focuses an unambiguous app without launching a duplicate and verifies new launches", async () => {
    const fixture = await appFixture();
    const state: MutableDesktop = {
      activeAddress: undefined,
      window: { address: "0xaaa", class: "ExampleEditor", initialClass: "ExampleEditor", workspace: 1, monitor: 0, size: [800, 600], floating: false },
      workspaceMonitor: "eDP-1"
    };
    const calls: Array<{ file: string; args: string[] }> = [];
    const appTool = createPersonalAssistantTools(desktopRunner(state, calls), fixture.env)[1];
    const focused = await appTool.execute("focus", {
      kind: "desktop", id: "org.example.Editor", mode: "focus_or_launch"
    }, undefined, undefined, {} as never);
    expect(focused).toMatchObject({ details: { action: "focus_existing_app", verified: true } });
    expect(calls.some((call) => call.file === "uwsm-app")).toBe(false);

    state.window = undefined;
    state.activeAddress = undefined;
    const launched = await appTool.execute("launch", {
      kind: "desktop", id: "org.example.Editor", mode: "new_window"
    }, undefined, undefined, {} as never);
    expect(launched).toMatchObject({ details: { action: "open_app", changed: true, verified: true } });
    expect(calls).toContainEqual({ file: "uwsm-app", args: ["--", "gtk-launch", "org.example.Editor.desktop"] });

    state.window = undefined;
    state.activeAddress = undefined;
    const cli = await appTool.execute("launch-cli", {
      kind: "cli", id: "example-cli", mode: "new_window"
    }, undefined, undefined, {} as never);
    expect(cli).toMatchObject({ details: { action: "open_app", target: { kind: "cli", id: "example-cli" }, verified: true } });
    expect(calls).toContainEqual({
      file: "omarchy", args: ["launch", "tui", "--app-id=org.omarchy.example-cli", "example-cli"]
    });
  });

  it("moves an exact workspace to an existing monitor and verifies ownership", async () => {
    const state: MutableDesktop = { activeAddress: undefined, window: undefined, workspaceMonitor: "eDP-1" };
    const calls: Array<{ file: string; args: string[] }> = [];
    const workspaceTool = createPersonalAssistantTools(desktopRunner(state, calls), {})[4];
    const moved = await workspaceTool.execute("move-workspace", {
      action: "move_to_monitor", workspace: 1, monitor: "DP-1"
    }, undefined, undefined, {} as never);
    expect(moved).toMatchObject({
      details: { action: "move_to_monitor", changed: true, verified: true, before: { monitor: "eDP-1" }, after: { monitor: "DP-1" } }
    });
    expect(calls).toContainEqual({
      file: "hyprctl", args: ["dispatch", 'hl.dsp.workspace.move({ workspace = 1, monitor = "DP-1" })']
    });
  });
});
