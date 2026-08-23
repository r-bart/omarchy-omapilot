import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DictationCancelledError, DictationService, dictationStartArgs } from "../src/dictation.js";
import { omapilotPaths } from "../src/paths.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Voxtype contract", () => {
  it("uses per-recording file output without simulated typing or configuration writes", () => {
    const transcript = "/run/user/1000/omapilot/dictation.txt";
    const args = dictationStartArgs(transcript);
    expect(args).toContain(`--file=${transcript}`);
    expect(args).not.toContain("--type");
    expect(args.join(" ")).not.toContain("config");
  });

  it("serializes cancel and restart so a late first start cannot cancel the second", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-dictation-race-")); roots.push(root);
    const audit = join(root, "voxtype-audit.txt");
    const env = {
      ...process.env,
      PATH: `${resolve("runtime/test/fixtures/dictation-bin")}:${process.env.PATH ?? ""}`,
      VOXTYPE_AUDIT: audit
    };
    const service = new DictationService(omapilotPaths({ ...env, XDG_RUNTIME_DIR: join(root, "run") }), env);
    const first = service.start();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    const cancel = service.cancel();
    const second = service.start();
    await expect(first).rejects.toBeInstanceOf(DictationCancelledError);
    await cancel;
    await expect(second).resolves.toBeUndefined();
    const commands = (await readFile(audit, "utf8")).trim().split("\n");
    expect(commands.at(-1)).toMatch(/^record start /u);
    expect(commands).toContain("record cancel");
    expect(commands.findLastIndex((command) => command === "record cancel")).toBeLessThan(commands.length - 1);
  });
});
