import { describe, expect, it } from "vitest";
import { nativeResumeArgs, transcriptPrompt } from "../src/herdr.js";
import type { ChatRecord } from "../src/types.js";

describe("Herdr handoff", () => {
  it("constructs native resume arguments for all harnesses", () => {
    expect(nativeResumeArgs("codex", "abc")).toEqual(["resume", "abc", "-s", "read-only", "-a", "never"]);
    expect(nativeResumeArgs("claude", "abc")).toEqual(["--resume", "abc"]);
    expect(nativeResumeArgs("opencode", "abc")).toEqual(["--pure", "--session", "abc"]);
  });

  it("labels transcript fallback honestly", () => {
    expect(transcriptPrompt(chat)).toContain("could not be attached natively");
    expect(transcriptPrompt(chat)).toContain("## Question\nQuestion");
    expect(transcriptPrompt(chat)).toContain("## Answer\nAnswer");
  });
});

const chat: ChatRecord = {
  schemaVersion: 1, id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-08-11T00:00:00.000Z", title: "Test",
  provider: "claude", capability: "answer", question: "Question", answer: "Answer", images: [],
  session: { resumable: false, resumeKind: "transcript" }
};
