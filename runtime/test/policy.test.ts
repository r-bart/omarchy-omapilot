import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { z } from "zod";
import { parseCodexModelCatalog, probeAcpModels, providerPolicyEnvironment, providerSessionRequest } from "../src/acp.js";
import { codexToolLockdownFeatures, discoverProviders, type DiscoveredProvider } from "../src/providers.js";

describe("provider security profiles", () => {
  it("normalizes the Codex app-server model catalog without hidden or invalid rows", () => {
    expect(parseCodexModelCatalog({ data: [
      { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "Frontier", isDefault: true, hidden: false },
      { id: "gpt-5.6-sol", displayName: "Duplicate", description: "Ignore", isDefault: false, hidden: false },
      { id: "hidden", displayName: "Hidden", isDefault: false, hidden: true },
      { id: "bad model", displayName: "Bad", isDefault: false, hidden: false }
    ] })).toEqual({
      models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol", description: "Frontier" }],
      defaultModel: "gpt-5.6-sol"
    });
  });

  it("discovers Codex models from app-server without creating an ACP session", async () => {
    const codex = provider("codex");
    codex.harnessPath = resolve("runtime/test/fixtures/bin/codex-model-catalog");
    await expect(probeAcpModels(codex, 2_000)).resolves.toEqual({
      models: [{ id: "gpt-fixture", name: "Fixture model", description: "Read from model/list" }],
      defaultModel: "gpt-fixture"
    });
  });

  it("keeps every Codex shell and local-tool feature disabled in every profile", () => {
    const answer: unknown = JSON.parse(providerPolicyEnvironment(provider("codex"), "answer").CODEX_CONFIG ?? "{}");
    const web: unknown = JSON.parse(providerPolicyEnvironment(provider("codex"), "web").CODEX_CONFIG ?? "{}");
    const tools: unknown = JSON.parse(providerPolicyEnvironment(provider("codex"), "tools").CODEX_CONFIG ?? "{}");
    expect(answer).toMatchObject({ approval_policy: "on-request", sandbox_mode: "read-only", web_search: "disabled", mcp_servers: {} });
    expect(web).toMatchObject({ approval_policy: "on-request", sandbox_mode: "read-only", web_search: "live", mcp_servers: {} });
    expect(tools).toMatchObject({ approval_policy: "on-request", sandbox_mode: "read-only", web_search: "disabled", mcp_servers: {} });
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
    const toolFeatures = featureRecord(tools);
    for (const feature of provider("codex").lockdownFeatures ?? []) expect(toolFeatures[feature]).toBe(false);
  });

  it("confines Claude Tools to a disposable local scratch space", () => {
    const request = providerSessionRequest({
      id: "claude", name: "Claude", models: [], capabilities: ["answer", "web", "tools"],
      harnessPath: "/test/claude",
      agent: {
        executable: "/test/claude-acp", args: [],
        env: { PATH: "/usr/bin", LANG: "C.UTF-8", HOME: "/home/private", API_TOKEN: "secret", USER: "private-user" }
      }
    }, "/run/user/1000/quickchat/tool-turn", "tools");
    const serialized = JSON.parse(JSON.stringify(request)) as {
      _meta: { claudeCode: { options: {
        tools: string[];
        sandbox: {
          enabled: boolean; failIfUnavailable: boolean; autoAllowBashIfSandboxed: boolean;
          allowUnsandboxedCommands: boolean;
          network: { allowedDomains: string[]; strictAllowlist: boolean; allowLocalBinding: boolean; allowUnixSockets: string[] };
          filesystem: { denyRead: string[]; allowRead: string[]; denyWrite: string[]; allowWrite: string[] };
          credentials: { envVars: Array<{ name: string; mode: string }> };
        }
      } } }
    };
    const options = serialized._meta.claudeCode.options;
    expect(options.tools).toEqual(["Bash"]);
    expect(options.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: false,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowUnixSockets: [] },
      filesystem: {
        allowRead: ["/run/user/1000/quickchat/tool-turn", "/dev/null", "/etc/ld.so.cache"],
        denyWrite: ["/"],
        allowWrite: ["/run/user/1000/quickchat/tool-turn"]
      }
    });
    expect(options.sandbox.filesystem.denyRead).toEqual(expect.arrayContaining([
      "/home", "/root", "/tmp", "/var", "/etc", "/run", "/proc", "/sys", "/dev", "/boot", "/usr/local"
    ]));
    expect(options.sandbox.filesystem.denyRead).not.toContain("/usr");
    expect(options.sandbox.credentials.envVars).toEqual([
      { name: "API_TOKEN", mode: "deny" },
      { name: "HOME", mode: "deny" },
      { name: "USER", mode: "deny" }
    ]);
  });

  it("denies every OpenCode permission except explicit web fetch/search in Web", () => {
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode"), "answer").OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny" });
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode"), "web").OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny", websearch: "allow", webfetch: "allow" });
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode"), "tools").OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny" });
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

  it("advertises Tools only for the confined Claude adapter", async () => {
    const providers = await discoverProviders({
      ...process.env,
      PATH: `${resolve("runtime/test/fixtures/claude-auth")}:${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`,
      QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
      QUICKCHAT_CLAUDE_ACP: resolve("runtime/test/fake-acp-agent.mjs")
    });
    expect(providers.find((provider) => provider.id === "claude")?.capabilities).toEqual(["answer", "web", "tools"]);
    expect(providers.find((provider) => provider.id === "codex")?.capabilities).toEqual(["answer", "web"]);
    expect(providers.find((provider) => provider.id === "opencode")?.capabilities).toEqual(["answer", "web"]);
  });
});

function featureRecord(config: unknown): Record<string, unknown> {
  const parsed = z.object({ features: z.record(z.string(), z.boolean()) }).safeParse(config);
  return parsed.success ? parsed.data.features : {};
}

function provider(id: "codex" | "opencode"): DiscoveredProvider {
  return {
    id, name: id, models: [], capabilities: ["answer", "web", "tools"], harnessPath: `/test/${id}`,
    agent: { executable: "/test/acp", args: [], env: { PATH: "/test" } },
    ...(id === "codex" ? { lockdownFeatures: ["shell_tool", "unified_exec", "code_mode", "code_mode_host", "apps", "plugins", "browser_use", "in_app_browser", "computer_use", "js_repl", "view_image"] } : {})
  };
}
