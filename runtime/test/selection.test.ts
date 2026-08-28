import { describe, expect, it } from "vitest";
import {
  isWindowAddress,
  readPrimarySelection,
  replaceSelection,
  safeSelectionText,
  type SelectionTools
} from "../src/selection.js";

type Call = { executable: string; args: string[] };

type StubOptions = {
  missing?: string[];
  paste?: { code: number; stdout: string } | Error;
  activeAddress?: string;
  focusAfter?: number;
  pasted?: boolean | Error;
  clipboard?: string | undefined;
  clipboardReadFails?: boolean;
  clipboardWriteFails?: boolean;
};

function stubTools(options: StubOptions = {}): SelectionTools & { calls: Call[]; steps: string[]; reports: string[]; clipboard: (string | undefined)[];
  stealClipboardAfterPaste: (value: string) => void } {
  const calls: Call[] = [];
  // Every clipboard and paste step, in the order it happened. The order is
  // the safety property under test.
  const steps: string[] = [];
  const reports: string[] = [];
  const clipboard: (string | undefined)[] = [];
  // What the stub clipboard currently holds, once anything has written to it.
  let held: string | undefined;
  let stolen: string | undefined;
  const missing = new Set(options.missing ?? []);
  let activeQueries = 0;
  return {
    calls,
    steps,
    reports,
    clipboard,
    resolve: (name) => Promise.resolve(missing.has(name) ? undefined : `/usr/bin/${name}`),
    run: (executable, args) => {
      calls.push({ executable, args });
      if (executable.endsWith("wl-paste")) {
        if (options.paste instanceof Error) return Promise.reject(options.paste);
        return Promise.resolve(options.paste ?? { code: 0, stdout: "" });
      }
      if (args[0] === "-j" && args[1] === "activewindow") {
        activeQueries++;
        const settled = activeQueries >= (options.focusAfter ?? 1);
        const address = settled ? (options.activeAddress ?? "0xdeadbeef") : "0xother";
        return Promise.resolve({ code: 0, stdout: JSON.stringify({ address }) });
      }
      return Promise.resolve({ code: 0, stdout: "" });
    },
    clipboardRead: () => {
      steps.push("read");
      if (options.clipboardReadFails === true) return Promise.resolve(undefined);
      // A real clipboard returns what was last written to it, and the code
      // under test depends on that to know whether it still owns it.
      if (held !== undefined) return Promise.resolve(held);
      return Promise.resolve(options.clipboard ?? "what the user had");
    },
    clipboardWrite: (_executable, text) => {
      steps.push(`write:${text ?? "(cleared)"}`);
      clipboard.push(text);
      if (options.clipboardWriteFails === true) return Promise.resolve(false);
      held = text ?? "";
      return Promise.resolve(true);
    },
    paste: () => {
      steps.push("paste");
      if (stolen !== undefined) held = stolen;
      if (options.pasted instanceof Error) return Promise.reject(options.pasted);
      return Promise.resolve(options.pasted ?? true);
    },
    stealClipboardAfterPaste: (value: string) => { stolen = value; },
    wait: () => Promise.resolve(),
    report: (outcome, characters) => { reports.push(`${outcome}:${characters}`); }
  };
}

describe("selection text safety", () => {
  it("keeps the line structure a selection actually has", () => {
    expect(safeSelectionText("first line\nsecond line")).toBe("first line\nsecond line");
    expect(safeSelectionText("a\tb")).toBe("a\tb");
    expect(safeSelectionText("windows\r\nlines")).toBe("windows\nlines");
  });

  it("replaces control and bidirectional-display characters", () => {
    expect(safeSelectionText("before\u000bafter")).toBe("before after");
    expect(safeSelectionText("safe\u202etxet")).toBe("safe txet");
    expect(safeSelectionText("null\u0000byte")).toBe("null byte");
  });

  it("bounds the text so an enormous selection cannot reach a provider whole", () => {
    expect(safeSelectionText("x".repeat(20_000)).length).toBe(8_000);
    expect(safeSelectionText("abcdef", 3)).toBe("abc");
  });

  it("accepts only exact compositor window addresses", () => {
    expect(isWindowAddress("0x55d1a2b3c4")).toBe(true);
    expect(isWindowAddress("0X55D1")).toBe(true);
    expect(isWindowAddress("55d1a2b3c4")).toBe(false);
    expect(isWindowAddress("0x")).toBe(false);
    expect(isWindowAddress("address:0x55d1")).toBe(false);
    expect(isWindowAddress("0x55d1; rm -rf /")).toBe(false);
  });
});

describe("reading the primary selection", () => {
  it("reads the primary selection without touching the regular clipboard", async () => {
    const tools = stubTools({ paste: { code: 0, stdout: "teh quick brown fox" } });
    expect(await readPrimarySelection(tools)).toEqual({ available: true, text: "teh quick brown fox" });
    expect(tools.calls[0]?.args).toEqual(["--primary", "--no-newline"]);
  });

  it("reports an empty selection as empty, not as a failure", async () => {
    // wl-paste exits non-zero when nothing is selected, which is the ordinary
    // case for a hotkey pressed with no selection.
    expect(await readPrimarySelection(stubTools({ paste: { code: 1, stdout: "" } })))
      .toEqual({ available: false, text: "", reason: "empty" });
    expect(await readPrimarySelection(stubTools({ paste: { code: 0, stdout: "   \n  " } })))
      .toEqual({ available: false, text: "", reason: "empty" });
  });

  it("reports a missing wl-paste as unsupported", async () => {
    expect(await readPrimarySelection(stubTools({ missing: ["wl-paste"] })))
      .toEqual({ available: false, text: "", reason: "unsupported" });
  });

  it("survives a wl-paste that cannot be spawned", async () => {
    expect(await readPrimarySelection(stubTools({ paste: new Error("spawn failed") })))
      .toEqual({ available: false, text: "", reason: "failed" });
  });
});

describe("replacing the selection", () => {
  it("focuses the exact target window before pasting anything", async () => {
    const tools = stubTools({ activeAddress: "0xdeadbeef" });
    expect(await replaceSelection("the quick brown fox", "0xdeadbeef", tools)).toEqual({ replaced: true });

    const focusIndex = tools.calls.findIndex((call) => call.args[0] === "dispatch");
    expect(focusIndex).toBeGreaterThanOrEqual(0);
    expect(tools.calls[focusIndex]?.args[1]).toBe('hl.dsp.focus({ window = "address:0xdeadbeef" })');
    expect(tools.clipboard[0]).toBe("the quick brown fox");
  });

  it("puts the clipboard back only after the paste, never before", async () => {
    // The property that matters. Ctrl+V does not copy: it makes the
    // application ask the clipboard owner for the content. Restoring inside
    // that window hands it the user's previous clipboard, which lands in their
    // document as text they never asked to insert.
    const tools = stubTools({ activeAddress: "0xdeadbeef", clipboard: "a private note" });
    await replaceSelection("corrected", "0xdeadbeef", tools);
    // The second read is the ownership check: the clipboard is only written
    // while it still holds exactly what was put there.
    expect(tools.steps).toEqual(["read", "write:corrected", "paste", "read", "write:a private note"]);
  });

  it("puts the clipboard back when the replacement fails at any step", async () => {
    const focusFailed = stubTools({ activeAddress: "0xsomewhereelse", clipboard: "a private note" });
    expect(await replaceSelection("corrected", "0xdeadbeef", focusFailed))
      .toEqual({ replaced: false, reason: "focus_failed" });
    expect(focusFailed.steps.at(-1)).toBe("write:a private note");

    const pasteFailed = stubTools({ activeAddress: "0xdeadbeef", clipboard: "a private note", pasted: false });
    expect(await replaceSelection("corrected", "0xdeadbeef", pasteFailed))
      .toEqual({ replaced: false, reason: "failed" });
    expect(pasteFailed.steps.at(-1)).toBe("write:a private note");

    const threw = stubTools({ activeAddress: "0xdeadbeef", clipboard: "a private note", pasted: new Error("no keyboard") });
    expect(await replaceSelection("corrected", "0xdeadbeef", threw))
      .toEqual({ replaced: false, reason: "failed" });
    expect(threw.steps.at(-1)).toBe("write:a private note");
  });

  it("leaves the clipboard alone when it is no longer ours", async () => {
    // Copying something while a replacement is in flight used to lose it: the
    // hand-back wrote over it. The clipboard is only overwritten while it
    // still holds exactly what was put there.
    const tools = stubTools({ activeAddress: "0xdeadbeef", clipboard: "a private note" });
    tools.stealClipboardAfterPaste("something the user just copied");
    await replaceSelection("corrected", "0xdeadbeef", tools);
    expect(tools.steps).toEqual(["read", "write:corrected", "paste", "read"]);
  });

  it("writes nothing when it cannot read the clipboard to check whose it is", async () => {
    // A clipboard that cannot be read cannot be shown to still be ours, and
    // writing to one we cannot inspect risks destroying something the user
    // copied. The replacement stays rather than a blind write happening.
    const tools = stubTools({ activeAddress: "0xdeadbeef", clipboardReadFails: true });
    await replaceSelection("corrected", "0xdeadbeef", tools);
    expect(tools.steps).toEqual(["read", "write:corrected", "paste", "read"]);
  });

  it("restores an empty clipboard as empty rather than leaving the replacement behind", async () => {
    const tools = stubTools({ activeAddress: "0xdeadbeef", clipboard: "" });
    await replaceSelection("corrected", "0xdeadbeef", tools);
    expect(tools.steps.at(-1)).toBe("write:(cleared)");
  });

  it("pastes nothing when focus never lands on the target", async () => {
    const tools = stubTools({ activeAddress: "0xsomewhereelse" });
    expect(await replaceSelection("corrected", "0xdeadbeef", tools))
      .toEqual({ replaced: false, reason: "focus_failed" });
    expect(tools.steps).not.toContain("paste");
  });

  it("refuses a target that is not an exact window address", async () => {
    const tools = stubTools();
    expect(await replaceSelection("corrected", 'address:0x1" }); os.execute("rm -rf /', tools))
      .toEqual({ replaced: false, reason: "invalid_target" });
    expect(tools.steps).toEqual([]);
  });

  it("refuses to paste an empty replacement", async () => {
    const tools = stubTools();
    expect(await replaceSelection("   ", "0xdeadbeef", tools)).toEqual({ replaced: false, reason: "empty" });
    expect(tools.steps).toEqual([]);
  });

  it("reports a missing tool as unsupported before touching the clipboard", async () => {
    for (const missing of ["wl-copy", "wl-paste", "wtype"]) {
      const tools = stubTools({ missing: [missing] });
      expect(await replaceSelection("corrected", "0xdeadbeef", tools))
        .toEqual({ replaced: false, reason: "unsupported" });
      expect(tools.steps).toEqual([]);
    }
  });

  it("bounds the paste so a wtype that never returns cannot hang the UI", async () => {
    const tools = stubTools({ activeAddress: "0xdeadbeef" });
    await replaceSelection("corrected", "0xdeadbeef", tools);
    expect(tools.steps).toContain("paste");
  });

  it("records the outcome without ever recording the text", async () => {
    const good = stubTools({ activeAddress: "0xdeadbeef" });
    await replaceSelection("the secret sentence", "0xdeadbeef", good);
    expect(good.reports).toEqual(["replaced:19"]);

    const bad = stubTools();
    await replaceSelection("the secret sentence", "not-an-address", bad);
    expect(bad.reports).toEqual(["invalid_target:19"]);

    for (const line of [...good.reports, ...bad.reports]) {
      expect(line).not.toContain("secret");
    }
  });
});
