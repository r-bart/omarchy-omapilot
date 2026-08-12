import { describe, expect, it } from "vitest";
import { providerPolicyEnvironment, redactAgentError } from "../src/acp.js";
import type { DiscoveredProvider } from "../src/providers.js";

describe("provider security profiles", () => {
  it("keeps Codex read-only and tool-free in both modes while gating web", () => {
    const answer: unknown = JSON.parse(providerPolicyEnvironment(provider("codex"), "answer").CODEX_CONFIG ?? "{}");
    const web: unknown = JSON.parse(providerPolicyEnvironment(provider("codex"), "web").CODEX_CONFIG ?? "{}");
    expect(answer).toEqual({ approval_policy: "never", sandbox_mode: "read-only", web_search: "disabled", mcp_servers: {} });
    expect(web).toEqual({ approval_policy: "never", sandbox_mode: "read-only", web_search: "live", mcp_servers: {} });
  });

  it("denies every OpenCode permission except explicit web fetch/search in Web", () => {
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode"), "answer").OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny" });
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode"), "web").OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny", websearch: "allow", webfetch: "allow" });
  });

  it("redacts credential-like values and account emails from agent failures", () => {
    const error = redactAgentError("auth failed for person@example.com token=secret-value sk-123456789");
    expect(error).not.toContain("person@example.com");
    expect(error).not.toContain("secret-value");
    expect(error).not.toContain("sk-123456789");
    expect(error).toContain("[redacted]");
  });
});

function provider(id: "codex" | "opencode"): DiscoveredProvider {
  return {
    id, name: id, models: [], capabilities: ["answer", "web"], harnessPath: `/test/${id}`,
    agent: { executable: "/test/acp", args: [], env: { PATH: "/test" } }
  };
}
