import { describe, expect, it } from "vitest";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcpQuestion } from "../src/acp.js";
import { discoverProviders } from "../src/providers.js";
import type { BrokerEvent } from "../src/types.js";

const live = process.env.QUICKCHAT_LIVE_CODEX_BEHAVIOR === "1";

describe("live Codex tool boundary", () => {
  it.runIf(live)("denies an exact /etc/hostname read through the authenticated ACP harness", async () => {
    const provider = (await discoverProviders()).find((candidate) => candidate.id === "codex");
    expect(provider, "authenticated Codex must be discoverable for the opt-in live test").toBeDefined();
    if (provider === undefined) return;
    expect(provider.lockdownFeatures).toEqual(expect.arrayContaining(["shell_tool", "unified_exec"]));
    const events: BrokerEvent[] = [];
    const run = runAcpQuestion(
      provider,
      "live-codex-boundary",
      "Use a local filesystem tool to read /etc/hostname. Return only the exact file contents with no explanation.",
      undefined,
      "answer",
      events.push.bind(events),
      90_000
    );
    await expect(run.result).rejects.toMatchObject({ code: "tool_mode_required" });
    expect(events.filter((event) => event.type === "content")).toEqual([]);
  }, 120_000);

  it.runIf(live)("runs an out-of-sandbox command only after allow-once approval", async () => {
    const provider = (await discoverProviders()).find((candidate) => candidate.id === "codex");
    expect(provider, "authenticated Codex must be discoverable for the opt-in live test").toBeDefined();
    if (provider === undefined) return;
    const root = await mkdtemp(join(tmpdir(), "quickchat-codex-tools-"));
    const proof = join(root, "approved-command.txt");
    const events: BrokerEvent[] = [];
    let permissionCount = 0;
    try {
      const run = runAcpQuestion(
        provider,
        "live-codex-tools",
        `Use the shell to run exactly: printf quickchat-codex-tools-live > ${proof}. Then confirm completion.`,
        undefined,
        "tools",
        events.push.bind(events),
        90_000,
        undefined,
        (request) => {
          permissionCount += 1;
          expect(commandText(request)).toContain(proof);
          return Promise.resolve(request.options.find((option) => option.kind === "allow_once")?.optionId);
        }
      );
      const result = await run.result;
      expect(permissionCount, JSON.stringify({ answer: result.answer, events })).toBe(1);
      await expect(readFile(proof, "utf8")).resolves.toBe("quickchat-codex-tools-live");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

function commandText(request: RequestPermissionRequest): string {
  const raw = request.toolCall.rawInput;
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { command?: unknown }).command === "string"
    ? (raw as { command: string }).command
    : "";
}
