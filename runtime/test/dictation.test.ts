import { describe, expect, it } from "vitest";
import { dictationStartArgs } from "../src/dictation.js";

describe("Voxtype contract", () => {
  it("uses per-recording file output without simulated typing or configuration writes", () => {
    const transcript = "/run/user/1000/quickchat/dictation.txt";
    const args = dictationStartArgs(transcript);
    expect(args).toContain(`--file=${transcript}`);
    expect(args).not.toContain("--type");
    expect(args.join(" ")).not.toContain("config");
  });
});
