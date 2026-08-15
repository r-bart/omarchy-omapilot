import { afterEach, describe, expect, it } from "vitest";
import { runAcpQuestion } from "../src/acp.js";
import { discoverProviders } from "../src/providers.js";

const live = process.env.QUICKCHAT_LIVE_OPENCODE_BEHAVIOR === "1";
const activeRuns: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(activeRuns.splice(0).map((cancel) => cancel())));

describe("live automatic OpenCode boundary", () => {
  it.runIf(live)("uses web search automatically without a device permission", async () => {
    const provider = (await discoverProviders()).find((candidate) => candidate.id === "opencode");
    expect(provider, "authenticated OpenCode must be discoverable for the opt-in live test").toBeDefined();
    if (provider === undefined) return;
    let permissionCount = 0;
    const run = runAcpQuestion(
      provider,
      "live-opencode-web",
      "You must use web search to find the official Omarchy website. Return only its HTTPS URL.",
      undefined,
      () => undefined,
      90_000,
      undefined,
      () => { permissionCount += 1; return Promise.resolve(undefined); }
    );
    activeRuns.push(run.cancel);
    const result = await run.result;
    activeRuns.pop();
    expect(permissionCount, result.answer).toBe(0);
    expect(result.answer).toMatch(/https:\/\/[^\s]*omarchy/iu);
  }, 120_000);
});
