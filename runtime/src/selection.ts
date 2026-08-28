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

// The replacement is pasted, not typed.
//
// Synthesizing one key event per character loses characters. Measured on a
// 166-character replacement: four lost with capitals, one without, the same
// index every run, and unchanged at 6, 14 and 30 milliseconds between strokes.
// It is not the length (240 characters typed clean), not the number of
// distinct characters (62 typed clean), and not the letters themselves. The
// cause is inside wtype; the fix is not to depend on it.
//
// A paste is a single key event and the application reads the whole string at
// once. Measured on the same replacement: 163 characters sent, 163 received.
//
// Wayland does have a way to insert text without keys at all — input_method_v2
// — but using it means becoming the system input method, and that seat is
// already taken by the user's own (fcitx5 here). A plugin must not evict it.
const pasteChord = ["-M", "ctrl", "-k", "v", "-m", "ctrl"];

// How long to leave the replacement on the clipboard before putting back what
// was there. Ctrl+V does not copy: it makes the application ask the clipboard
// owner for the content, and restoring inside that window would hand it the
// user's old clipboard instead — pasting something they never asked for into
// their document. Ordering closes that; this is the margin on top.
const pasteSettleMs = 600;

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
  clipboardRead: (executable: string) => Promise<string | undefined>;
  clipboardWrite: (executable: string, text: string | undefined) => Promise<boolean>;
  paste: (executable: string, timeoutMs: number) => Promise<boolean>;
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
    clipboardRead: async (executable) => {
      try {
        const result = await runCommand(executable, ["--no-newline"], { env, timeoutMs: 3_000, maxOutput: 1_000_000 });
        // A non-zero exit means an empty clipboard, which is a real state to
        // restore to, not a failure.
        return result.code === 0 ? result.stdout : "";
      } catch {
        // Unknown rather than empty: the caller must not "restore" a clipboard
        // it never managed to read.
        return undefined;
      }
    },
    // The text goes on stdin, which keeps arbitrary selections out of argv.
    clipboardWrite: (executable, text) => new Promise<boolean>((resolve) => {
      const child = text === undefined
        ? spawn(executable, ["--clear"], { env, stdio: "ignore" })
        : spawn(executable, [], { env, stdio: ["pipe", "ignore", "ignore"] });
      child.once("error", () => resolve(false));
      child.once("close", (code) => resolve(code === 0));
      if (text !== undefined) child.stdin?.end(text);
    }),
    paste: (executable, timeoutMs) => new Promise<boolean>((resolve) => {
      const child = spawn(executable, pasteChord, {
        env,
        stdio: "ignore",
        detached: process.platform !== "win32"
      });
      let settled = false;
      const finish = (pasted: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(pasted);
      };
      const timer = setTimeout(() => {
        terminateProcessGroup(child.pid);
        finish(false);
      }, timeoutMs);
      timer.unref();
      child.once("error", () => finish(false));
      child.once("close", (code) => finish(code === 0));
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

  const [copy, paste, typer] = await Promise.all([
    tools.resolve("wl-copy"),
    tools.resolve("wl-paste"),
    tools.resolve("wtype")
  ]);
  if (copy === undefined || paste === undefined || typer === undefined)
    return settle({ replaced: false, reason: "unsupported" });

  // Read what the user had before anything is disturbed. `undefined` means the
  // read failed, and a clipboard that could not be read must not be "restored"
  // to a guess.
  const previous = await tools.clipboardRead(paste);

  // Put it back exactly once, however this ends. Never before the paste has
  // been read: Ctrl+V makes the application ask the clipboard owner for the
  // content, and restoring inside that window hands it the previous clipboard
  // instead — the user's own text, pasted into their document, from a command
  // they thought would insert a correction.
  let restored = false;
  const restore = async (): Promise<void> => {
    if (restored || previous === undefined) return;
    restored = true;
    await tools.clipboardWrite(copy, previous === "" ? undefined : previous);
  };

  if (!await tools.clipboardWrite(copy, replacement)) {
    await restore();
    return settle({ replaced: false, reason: "failed" });
  }

  if (!await focusWindow(address, tools)) {
    await restore();
    return settle({ replaced: false, reason: "focus_failed" });
  }

  // The window has focus but its input handling may not have settled, and a
  // keystroke sent too early lands nowhere.
  await tools.wait(80);

  let pasted = false;
  try {
    pasted = await tools.paste(typer, 5_000);
  } catch {
    pasted = false;
  }

  // Only now. The application has had the chord; give it the moment it needs
  // to pull the content before the clipboard becomes the user's again.
  await tools.wait(pasteSettleMs);
  await restore();

  return settle(pasted ? { replaced: true } : { replaced: false, reason: "failed" });
}
