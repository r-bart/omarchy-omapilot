import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { z } from "zod";
import { providerPolicyEnvironment } from "../src/acp.js";
import { codexToolLockdownFeatures, discoverProviders, type DiscoveredProvider } from "../src/providers.js";

describe("provider security profiles", () => {
  it("keeps Codex read-only and tool-free in both modes while gating web", () => {
    const answer: unknown = JSON.parse(providerPolicyEnvironment(provider("codex"), "answer").CODEX_CONFIG ?? "{}");
    const web: unknown = JSON.parse(providerPolicyEnvironment(provider("codex"), "web").CODEX_CONFIG ?? "{}");
    expect(answer).toMatchObject({ approval_policy: "never", sandbox_mode: "read-only", web_search: "disabled", mcp_servers: {} });
    expect(web).toMatchObject({ approval_policy: "never", sandbox_mode: "read-only", web_search: "live", mcp_servers: {} });
    const answerFeatures = featureRecord(answer);
    const webFeatures = featureRecord(web);
    for (const feature of provider("codex").lockdownFeatures ?? []) {
      expect(answerFeatures[feature]).toBe(false);
      expect(webFeatures[feature]).toBe(false);
    }
    expect(answerFeatures).toMatchObject({
      shell_tool: false, unified_exec: false, code_mode: false, code_mode_host: false,
      apps: false, plugins: false, browser_use: false, in_app_browser: false,
      computer_use: false, js_repl: false, view_image: false
    });
  });

  it("denies every OpenCode permission except explicit web fetch/search in Web", () => {
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode"), "answer").OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny" });
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode"), "web").OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny", websearch: "allow", webfetch: "allow" });
  });

  it("advertises Codex capabilities only when every lockdown feature validates", async () => {
    const features = await codexToolLockdownFeatures(resolve("runtime/test/fixtures/bin/codex"), process.env);
    expect(features).toContain("future_tool_feature");
    expect(await codexToolLockdownFeatures("/bin/false", process.env)).toBeUndefined();
    const providers = await discoverProviders({
      ...process.env,
      PATH: `${resolve("runtime/test/fixtures/bin-unsafe")}:${process.env.PATH ?? ""}`,
      QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs")
    });
    expect(providers.some((provider) => provider.id === "codex")).toBe(false);
  });
});

function featureRecord(config: unknown): Record<string, unknown> {
  const parsed = z.object({ features: z.record(z.string(), z.boolean()) }).safeParse(config);
  return parsed.success ? parsed.data.features : {};
}

function provider(id: "codex" | "opencode"): DiscoveredProvider {
  return {
    id, name: id, models: [], capabilities: ["answer", "web"], harnessPath: `/test/${id}`,
    agent: { executable: "/test/acp", args: [], env: { PATH: "/test" } },
    ...(id === "codex" ? { lockdownFeatures: ["shell_tool", "unified_exec", "code_mode", "code_mode_host", "apps", "plugins", "browser_use", "in_app_browser", "computer_use", "js_repl", "view_image"] } : {})
  };
}
