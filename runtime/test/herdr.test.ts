import { describe, expect, it } from "vitest";
import { herdrFocusCommands, nativeResumeArgs, transcriptPrompt } from "../src/herdr.js";
import type { ChatRecord } from "../src/types.js";

describe("Herdr handoff", () => {
  it("constructs native resume arguments for all harnesses", () => {
    expect(nativeResumeArgs("codex", "abc", "/work")).toEqual(["resume", "abc", "-C", "/work", "-s", "read-only", "-a", "on-request"]);
    expect(nativeResumeArgs("claude", "abc")).toEqual(["--resume", "abc"]);
    expect(nativeResumeArgs("opencode", "abc")).toEqual(["--pure", "--session", "abc"]);
  });

  it("labels transcript fallback honestly", () => {
    expect(transcriptPrompt(chat)).toContain("could not be attached natively");
    expect(transcriptPrompt(chat)).toContain("## Question\nQuestion");
    expect(transcriptPrompt(chat)).toContain("## Answer\nAnswer");
  });

  it("focuses the Herdr window, workspace, tab, and agent in that order", () => {
    expect(herdrFocusCommands("/usr/bin/herdr", "/usr/bin/omarchy-launch-or-focus-tui", "w11", "w11:t2", "quickchat-1234"))
      .toEqual([
        { executable: "/usr/bin/omarchy-launch-or-focus-tui", args: ["--app-id=org.omarchy.herdr", "/usr/bin/herdr"] },
        { executable: "/usr/bin/herdr", args: ["workspace", "focus", "w11"] },
        { executable: "/usr/bin/herdr", args: ["tab", "focus", "w11:t2"] },
        { executable: "/usr/bin/herdr", args: ["agent", "focus", "quickchat-1234"] }
      ]);
  });
});

const chat: ChatRecord = {
  schemaVersion: 1, id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-08-11T00:00:00.000Z", title: "Test",
  provider: "claude", capability: "answer", question: "Question", answer: "Answer", images: [],
  session: { resumable: false, resumeKind: "transcript" }
};
