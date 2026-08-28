import { spawn } from "node:child_process";
import { resolveExecutable, runCommand, terminateProcessGroup } from "./process.js";

// Reading the user's selection and writing a replacement back into the window
// they came from. Both halves are single-shot and explicitly requested: the
// selection is read when a hotkey fires, never watched, and the replacement is
// typed only after the user chooses it. Nothing here polls, and nothing here
// touches the regular clipboard, so a text action leaves no trace in the
// user's copy history.
//
// The selection is the detection. Wayland exposes no way to ask whether the
// focused widget is a text input, so a non-empty primary selection is what
// tells OmaPilot there is text to work on and which window owns it.

export const maximumSelectionLength = 8_000;

const windowAddressPattern = /^0x[0-9a-f]{1,30}$/iu;

// Selections are multi-line by nature, so newlines and tabs survive while the
// remaining control and bidirectional-display characters are replaced. This is
// the desktop-context sanitizer with whitespace collapsing removed.
const unsafeTextPattern =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

export type SelectionReadResult = {
  available: boolean;
  text: string;
  reason?: "unsupported" | "empty" | "failed";
};

export type SelectionReplaceResult = {
  replaced: boolean;
  reason?: "unsupported" | "invalid_target" | "focus_failed" | "empty" | "failed";
};

export type SelectionTools = {
  resolve: (name: string) => Promise<string | undefined>;
  run: (executable: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>;
  type: (executable: string, text: string, timeoutMs: number) => Promise<boolean>;
  wait: (milliseconds: number) => Promise<void>;
  // The outcome of a replacement, and only the outcome. Injected like every
  // other dependency here so a test never has to patch a global stream.
  report: (outcome: string, characters: number) => void;
};

export function safeSelectionText(value: string, limit: number = maximumSelectionLength): string {
  return value
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(unsafeTextPattern, " ")
    .trim()
    .slice(0, limit);
}

export function isWindowAddress(value: string): boolean {
  return windowAddressPattern.test(value);
}

export function defaultSelectionTools(env: NodeJS.ProcessEnv = process.env): SelectionTools {
  return {
    resolve: (name) => resolveExecutable(name, env),
    run: async (executable, args, timeoutMs) => {
      const result = await runCommand(executable, args, { env, timeoutMs, maxOutput: 262_144 });
      return { code: result.code, stdout: result.stdout };
    },
    // wtype reads the text to type from stdin when given `-`, which keeps
    // arbitrary selections out of argv and out of any shell quoting.
    type: (executable, text, timeoutMs) => new Promise<boolean>((resolve) => {
      const child = spawn(executable, ["-"], {
        env,
        stdio: ["pipe", "ignore", "ignore"],
        detached: process.platform !== "win32"
      });
      let settled = false;
      const finish = (typed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(typed);
      };
      const timer = setTimeout(() => {
        terminateProcessGroup(child.pid);
        finish(false);
      }, timeoutMs);
      timer.unref();
      child.once("error", () => finish(false));
      child.once("close", (code) => finish(code === 0));
      child.stdin.end(text);
    }),
    wait: (milliseconds) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds).unref(); }),
    report: (outcome, characters) => {
      process.stderr.write(`OmaPilot text action: ${outcome} (${characters} characters)\n`);
    }
  };
}

// wl-paste exits non-zero when nothing is selected. That is the ordinary case
// for a hotkey pressed with no selection, not a failure worth reporting as one.
export async function readPrimarySelection(tools: SelectionTools): Promise<SelectionReadResult> {
  const paste = await tools.resolve("wl-paste");
  if (paste === undefined) return { available: false, text: "", reason: "unsupported" };

  let stdout: string;
  try {
    const result = await tools.run(paste, ["--primary", "--no-newline"], 3_000);
    if (result.code !== 0) return { available: false, text: "", reason: "empty" };
    stdout = result.stdout;
  } catch {
    return { available: false, text: "", reason: "failed" };
  }

  const text = safeSelectionText(stdout);
  if (text === "") return { available: false, text: "", reason: "empty" };
  return { available: true, text };
}

// Focus has to land before a keystroke is synthesized, or the replacement is
// typed into whatever happens to be focused instead. Verify against the
// compositor rather than trusting the dispatch, the way the desktop tools do.
async function focusWindow(address: string, tools: SelectionTools): Promise<boolean> {
  const hyprctl = await tools.resolve("hyprctl");
  if (hyprctl === undefined) return false;
  try {
    await tools.run(hyprctl, ["dispatch", `hl.dsp.focus({ window = "address:${address}" })`], 5_000);
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    await tools.wait(30);
    try {
      const result = await tools.run(hyprctl, ["-j", "activewindow"], 5_000);
      if (result.code !== 0) continue;
      const active = JSON.parse(result.stdout) as { address?: unknown };
      if (typeof active.address === "string" && active.address.toLowerCase() === address.toLowerCase()) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function replaceSelection(
  text: string,
  address: string,
  tools: SelectionTools
): Promise<SelectionReplaceResult> {
  const replacement = safeSelectionText(text);
  const settle = (result: SelectionReplaceResult): SelectionReplaceResult => {
    tools.report(result.reason ?? "replaced", replacement.length);
    return result;
  };

  if (replacement === "") return settle({ replaced: false, reason: "empty" });
  if (!isWindowAddress(address)) return settle({ replaced: false, reason: "invalid_target" });

  const wtype = await tools.resolve("wtype");
  if (wtype === undefined) return settle({ replaced: false, reason: "unsupported" });

  if (!await focusWindow(address, tools)) return settle({ replaced: false, reason: "focus_failed" });

  // The window has focus but its input handling may not have settled, and a
  // keystroke sent too early lands nowhere.
  await tools.wait(80);

  try {
    // Generous, because typing is per-character, but bounded: a wtype that
    // never returns must not leave the UI waiting on an answer that is not
    // coming.
    return settle(await tools.type(wtype, replacement, 30_000)
      ? { replaced: true }
      : { replaced: false, reason: "failed" });
  } catch {
    return settle({ replaced: false, reason: "failed" });
  }
}
