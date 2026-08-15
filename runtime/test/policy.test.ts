import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseCodexModelCatalog, probeAcpModels, providerPolicyEnvironment, providerSessionRequest, runAcpQuestion } from "../src/acp.js";
import { codexToolLockdownFeatures, discoverProviders, type DiscoveredProvider } from "../src/providers.js";
import type { BrokerEvent } from "../src/types.js";

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

  it("enables only reviewed Codex execution features in the automatic profile", () => {
    const automatic: unknown = JSON.parse(providerPolicyEnvironment(provider("codex")).CODEX_CONFIG ?? "{}");
    expect(automatic).toMatchObject({
      approval_policy: "on-request",
      sandbox_mode: "read-only",
      web_search: "disabled",
      mcp_servers: {}
    });
    const automaticFeatures = featureRecord(automatic);
    expect(automaticFeatures).toMatchObject({ shell_tool: true, unified_exec: true });
    for (const feature of provider("codex").lockdownFeatures ?? []) {
      if (feature !== "shell_tool" && feature !== "unified_exec") expect(automaticFeatures[feature]).toBe(false);
    }
  });

  it("gives automatic Claude Bash and web tools inside disposable local scratch", () => {
    const request = providerSessionRequest({
      id: "claude", name: "Claude", models: [], policy: { tools: "sandboxed", web: "search", hostReads: false },
      harnessPath: "/test/claude",
      agent: {
        executable: "/test/claude-acp", args: [],
        env: { PATH: "/usr/bin", LANG: "C.UTF-8", HOME: "/home/private", API_TOKEN: "secret", USER: "private-user" }
      }
    }, "/run/user/1000/quickchat/automatic-turn");
    const serialized = JSON.parse(JSON.stringify(request)) as {
      _meta: { claudeCode: { options: {
        tools: string[];
        disallowedTools: string[];
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
    expect(request.mcpServers).toEqual([]);
    expect(options.tools).toEqual(["Bash", "WebSearch"]);
    expect(serialized._meta.claudeCode.options).toMatchObject({ disallowedTools: expect.arrayContaining(["WebFetch"]) });
    expect(options.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false, allowUnixSockets: [] },
      filesystem: {
        allowRead: ["/run/user/1000/quickchat/automatic-turn", "/dev/null", "/etc/ld.so.cache"],
        denyWrite: ["/"],
        allowWrite: ["/run/user/1000/quickchat/automatic-turn"]
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

  it("automatically permits only OpenCode web search", () => {
    expect(JSON.parse(providerPolicyEnvironment(provider("opencode")).OPENCODE_PERMISSION ?? "{}"))
      .toEqual({ "*": "deny", websearch: "allow" });
  });

  it.each(["other", "search"])("accepts exact OpenCode websearch identity with ACP kind %s", async (kind) => {
    const fixture = await openCodeToolUpdateFixture(kind, "websearch");
    const events: BrokerEvent[] = [];
    try {
      const run = runAcpQuestion(fixture.provider, `allowed-${kind}`, "Use the approved tool", undefined, events.push.bind(events), 5_000);
      const result = await run.result.catch(async (error: unknown) => {
        throw new Error(`${String(error)}\n${await readFile(fixture.audit, "utf8").catch(() => "no audit")}`);
      });
      expect(result).toMatchObject({ answer: "safe" });
      expect(events).toContainEqual({ type: "content", id: `allowed-${kind}`, delta: "safe" });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a tracked OpenCode websearch call reclassified as a device tool", async () => {
    const fixture = await openCodeToolUpdateFixture("other", "websearch", "execute");
    const events: BrokerEvent[] = [];
    try {
      await expect(runAcpQuestion(fixture.provider, "reclassified-websearch", "Search the web", undefined, events.push.bind(events), 5_000).result)
        .rejects.toMatchObject({ code: "forbidden_tool_attempt" });
      expect(events.filter((event) => event.type === "content")).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(["read", "edit", "delete", "move", "execute", "fetch", "switch_mode", "search", "think", "other"])("rejects unidentified OpenCode %s tool updates", async (kind) => {
    const fixture = await openCodeToolUpdateFixture(kind);
    const events: BrokerEvent[] = [];
    try {
      await expect(runAcpQuestion(fixture.provider, `blocked-${kind}`, "Attempt a blocked tool", undefined, events.push.bind(events), 5_000).result)
        .rejects.toMatchObject({ code: "forbidden_tool_attempt" });
      expect(events.filter((event) => event.type === "content")).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("discovers Codex only when every lockdown feature validates", async () => {
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

  it("discovers automatic providers without public capability metadata", async () => {
    const providers = await discoverProviders({
      ...process.env,
      PATH: `${resolve("runtime/test/fixtures/claude-auth")}:${resolve("runtime/test/fixtures/bin")}:${process.env.PATH ?? ""}`,
      QUICKCHAT_CODEX_ACP: resolve("runtime/test/fake-acp-agent.mjs"),
      QUICKCHAT_CLAUDE_ACP: resolve("runtime/test/fake-acp-agent.mjs")
    });
    expect(providers.map((provider) => provider.id)).toEqual(["codex", "claude", "opencode"]);
    expect(providers.every((provider) => !("capabilities" in provider))).toBe(true);
    expect(providers.map(({ id, policy }) => ({ id, policy }))).toEqual([
      { id: "codex", policy: { tools: "device-approval", web: "approved-command", hostReads: true } },
      { id: "claude", policy: { tools: "sandboxed", web: "search", hostReads: false } },
      { id: "opencode", policy: { tools: "blocked", web: "search", hostReads: false } }
    ]);
  });
});

function featureRecord(config: unknown): Record<string, unknown> {
  const parsed = z.object({ features: z.record(z.string(), z.boolean()) }).safeParse(config);
  return parsed.success ? parsed.data.features : {};
}

function provider(id: "codex" | "opencode"): DiscoveredProvider {
  return {
    id, name: id, models: [],
    policy: id === "codex"
      ? { tools: "device-approval", web: "approved-command", hostReads: true }
      : { tools: "blocked", web: "search", hostReads: false },
    harnessPath: `/test/${id}`,
    agent: { executable: "/test/acp", args: [], env: { PATH: "/test" } },
    ...(id === "codex" ? { lockdownFeatures: ["shell_tool", "unified_exec", "code_mode", "code_mode_host", "apps", "plugins", "browser_use", "in_app_browser", "computer_use", "js_repl", "view_image"] } : {})
  };
}

async function openCodeToolUpdateFixture(kind: string, title = "Policy probe", updateKind = kind === "other" && title === "websearch" ? "other" : ""): Promise<{ root: string; audit: string; provider: DiscoveredProvider }> {
  const root = await mkdtemp(join(tmpdir(), "quickchat-opencode-tool-update-"));
  const script = join(root, "agent.mjs");
  const audit = join(root, "audit.log");
  const sdk = pathToFileURL(resolve("node_modules/@agentclientprotocol/sdk/dist/acp.js")).href;
  await writeFile(script, `
import * as acp from ${JSON.stringify(sdk)};
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";

const audit = process.env.FAKE_TOOL_AUDIT;
const log = (message) => appendFileSync(audit, message + "\\n");
process.on("uncaughtException", (error) => { log("uncaught:" + String(error?.stack || error)); process.exit(1); });
process.on("unhandledRejection", (error) => { log("rejection:" + String(error?.stack || error)); process.exit(1); });
let pending;
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const server = acp.agent({ name: "quickchat-opencode-tool-update" })
  .onRequest(acp.methods.agent.initialize, () => { log("initialize"); return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }; })
  .onRequest(acp.methods.agent.session.new, () => ({
    sessionId: "tool-update-session",
    modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] },
    configOptions: []
  }))
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    log("prompt");
    const controller = new AbortController();
    pending = controller;
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: process.env.FAKE_TOOL_TITLE, kind: process.env.FAKE_TOOL_KIND, status: "in_progress" }
    });
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", title: "Exa Web Search progress", kind: process.env.FAKE_TOOL_UPDATE_KIND || undefined, status: "completed" }
    });
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "safe" } }
    });
    return { stopReason: controller.signal.aborted ? "cancelled" : "end_turn" };
  })
  .onNotification(acp.methods.agent.session.cancel, () => { pending?.abort(); });
server.connect(stream);
`);
  return {
    root,
    audit,
    provider: {
      id: "opencode",
      name: "OpenCode",
      models: [],
      policy: { tools: "blocked", web: "search", hostReads: false },
      harnessPath: process.execPath,
      agent: {
        executable: process.execPath,
        args: [script],
        env: {
          ...process.env,
          FAKE_TOOL_KIND: kind,
          FAKE_TOOL_TITLE: title,
          FAKE_TOOL_UPDATE_KIND: updateKind,
          FAKE_TOOL_AUDIT: audit,
          XDG_RUNTIME_DIR: join(root, "run"),
          XDG_STATE_HOME: join(root, "state"),
          XDG_CACHE_HOME: join(root, "cache")
        }
      }
    }
  };
}
