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
  typed?: boolean | Error;
};

function stubTools(options: StubOptions = {}): SelectionTools & { calls: Call[]; typedText: string[]; typeTimeouts: number[]; reports: string[] } {
  const calls: Call[] = [];
  const typedText: string[] = [];
  const typeTimeouts: number[] = [];
  const reports: string[] = [];
  const missing = new Set(options.missing ?? []);
  let activeQueries = 0;
  return {
    calls,
    typedText,
    typeTimeouts,
    reports,
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
    type: (_executable, text, timeoutMs) => {
      typeTimeouts.push(timeoutMs);
      if (options.typed instanceof Error) return Promise.reject(options.typed);
      typedText.push(text);
      return Promise.resolve(options.typed ?? true);
    },
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
  it("focuses the exact target window before typing anything", async () => {
    const tools = stubTools({ activeAddress: "0xdeadbeef" });
    expect(await replaceSelection("the quick brown fox", "0xdeadbeef", tools)).toEqual({ replaced: true });

    const focusIndex = tools.calls.findIndex((call) => call.args[0] === "dispatch");
    expect(focusIndex).toBeGreaterThanOrEqual(0);
    expect(tools.calls[focusIndex]?.args[1]).toBe('hl.dsp.focus({ window = "address:0xdeadbeef" })');
    expect(tools.typedText).toEqual(["the quick brown fox"]);
  });

  it("waits for the compositor to confirm focus rather than trusting the dispatch", async () => {
    const tools = stubTools({ activeAddress: "0xdeadbeef", focusAfter: 4 });
    expect(await replaceSelection("corrected", "0xdeadbeef", tools)).toEqual({ replaced: true });
    expect(tools.typedText).toEqual(["corrected"]);
  });

  it("types nothing when focus never lands on the target", async () => {
    // Typing into whatever happens to be focused is the worst failure this
    // feature has, so an unconfirmed focus must abort instead of guessing.
    const tools = stubTools({ activeAddress: "0xsomewhereelse" });
    expect(await replaceSelection("corrected", "0xdeadbeef", tools))
      .toEqual({ replaced: false, reason: "focus_failed" });
    expect(tools.typedText).toEqual([]);
  });

  it("refuses a target that is not an exact window address", async () => {
    const tools = stubTools();
    expect(await replaceSelection("corrected", 'address:0x1" }); os.execute("rm -rf /', tools))
      .toEqual({ replaced: false, reason: "invalid_target" });
    expect(tools.calls).toEqual([]);
  });

  it("refuses to type an empty replacement", async () => {
    const tools = stubTools();
    expect(await replaceSelection("   ", "0xdeadbeef", tools)).toEqual({ replaced: false, reason: "empty" });
    expect(tools.calls).toEqual([]);
  });

  it("reports a missing wtype as unsupported before moving focus", async () => {
    const tools = stubTools({ missing: ["wtype"] });
    expect(await replaceSelection("corrected", "0xdeadbeef", tools))
      .toEqual({ replaced: false, reason: "unsupported" });
    expect(tools.calls).toEqual([]);
  });

  it("bounds the typing so a wtype that never returns cannot hang the UI", async () => {
    // Every other runner in this runtime has a timeout; this one did not, and
    // the panel waits on its answer before re-enabling Replace.
    const tools = stubTools({ activeAddress: "0xdeadbeef" });
    await replaceSelection("corrected", "0xdeadbeef", tools);
    expect(tools.typeTimeouts).toHaveLength(1);
    expect(tools.typeTimeouts[0]).toBeGreaterThan(0);
    expect(tools.typeTimeouts[0]).toBeLessThanOrEqual(60_000);
  });

  it("records the outcome without ever recording the text", async () => {
    const good = stubTools({ activeAddress: "0xdeadbeef" });
    await replaceSelection("the secret sentence", "0xdeadbeef", good);
    expect(good.reports).toEqual(["replaced:19"]);

    const bad = stubTools();
    await replaceSelection("the secret sentence", "not-an-address", bad);
    expect(bad.reports).toEqual(["invalid_target:19"]);

    // The outcome and a length are the whole trace; the text never belongs in it.
    for (const line of [...good.reports, ...bad.reports]) {
      expect(line).not.toContain("secret");
    }
  });

  it("reports a wtype that fails", async () => {
    expect(await replaceSelection("corrected", "0xdeadbeef", stubTools({ typed: false })))
      .toEqual({ replaced: false, reason: "failed" });
    expect(await replaceSelection("corrected", "0xdeadbeef", stubTools({ typed: new Error("no virtual keyboard") })))
      .toEqual({ replaced: false, reason: "failed" });
  });
});
