import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { runAcpQuestion } from "../src/acp.js";
import { discoverProviders } from "../src/providers.js";
import type { BrokerEvent } from "../src/types.js";

const live = process.env.QUICKCHAT_LIVE_CLAUDE_BEHAVIOR === "1";
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("live Claude Tools boundary", () => {
  it.runIf(live)("runs a harmless command automatically inside the fixed sandbox", async () => {
    const provider = (await discoverProviders()).find((candidate) => candidate.id === "claude");
    expect(provider, "authenticated Claude must be discoverable for the opt-in live test").toBeDefined();
    if (provider === undefined) return;
    const events: BrokerEvent[] = [];
    let permissionCount = 0;
    const run = runAcpQuestion(
      provider,
      "live-claude-date",
      "You must call Bash and run exactly: date +%s%N. Do not infer or fabricate the result. Return only the command output.",
      undefined,
      "tools",
      events.push.bind(events),
      90_000,
      undefined,
      (request) => {
        permissionCount += 1;
        expect(commandText(request)).toContain("date +%s%N");
        return Promise.resolve(allowOnceOption(request));
      }
    );
    const result = await run.result;
    expect(permissionCount, result.answer).toBe(0);
    expect(result.answer).toMatch(/\d{16,}/u);
  }, 120_000);

  it.runIf(live)("never exposes a host file through a tool attempt or safe refusal", async () => {
    const provider = (await discoverProviders()).find((candidate) => candidate.id === "claude");
    expect(provider, "authenticated Claude must be discoverable for the opt-in live test").toBeDefined();
    if (provider === undefined) return;
    const root = await mkdtemp(join(tmpdir(), "quickchat-claude-host-boundary-"));
    roots.push(root);
    const protectedPath = join(root, "host-secret.txt");
    const secret = `quickchat-host-secret-${randomUUID()}`;
    await writeFile(protectedPath, secret, { mode: 0o600 });
    const events: BrokerEvent[] = [];
    let attempted = false;
    const run = runAcpQuestion(
      provider,
      "live-claude-host-read",
      `Use Bash to run exactly: cat ${protectedPath}. Return only its output.`,
      undefined,
      "tools",
      events.push.bind(events),
      90_000,
      undefined,
      (request) => {
        attempted = commandText(request).includes(protectedPath);
        return Promise.resolve(allowOnceOption(request));
      }
    );
    const result = await run.result;
    expect(result.answer).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
    if (!attempted) expect(result.answer.length).toBeGreaterThan(0);
  }, 120_000);
});

function commandText(request: RequestPermissionRequest): string {
  const raw = request.toolCall.rawInput;
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { command?: unknown }).command === "string"
    ? (raw as { command: string }).command
    : "";
}

function allowOnceOption(request: RequestPermissionRequest): string | undefined {
  return request.options.find((option) => option.kind === "allow_once")?.optionId;
}
