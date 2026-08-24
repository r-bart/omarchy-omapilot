import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { agentDirectory, bundledSkillPaths, configDirectory, createDesktopTools, discoverAgentProfiles, discoverPiAuthMethods, discoverPiProviders, existingSkillPaths, loginPiProvider, normalizeOpenUrl, omarchyMediaMethod, PiApprovalState, requiresPiPermission, runNestedAgentPrompt, runPiQuestion } from "../src/pi-harness.js";
import type { BrokerEvent } from "../src/types.js";
import { createWebHandoffTool, normalizeWebHandoffQuery, webHandoffApproval, webHandoffTarget } from "../src/tools/web-handoff.js";
import { DefaultResourceLoader } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("native Pi harness", () => {
  it("maps bounded Omarchy desktop actions without shell interpolation", () => {
    expect(normalizeOpenUrl(" https://example.com/search?q=omarchy ")).toBe("https://example.com/search?q=omarchy");
    expect(() => normalizeOpenUrl("file:///etc/passwd")).toThrow(/http and https/u);
    expect(() => normalizeOpenUrl("https://user:secret@example.com/")).toThrow(/credential-free/u);
    expect(omarchyMediaMethod("play_pause")).toBe("playPause");
    expect(omarchyMediaMethod("source_previous")).toBe("sourcePrevious");
    expect(() => omarchyMediaMethod("delete")).toThrow(/unavailable/u);
  });

  it("executes desktop actions as exact argv and fails closed on unexpected media output", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const [openUrl, media] = createDesktopTools((file, args) => {
      calls.push({ file, args });
      return Promise.resolve({ stdout: file === "omarchy-shell" ? "unexpected\n" : "", stderr: "" });
    });
    const opened = await openUrl.execute("open", { url: "https://example.com/" }, undefined, undefined, {} as never);
    const mediaResult = await media.execute("media", { action: "next" }, undefined, undefined, {} as never);
    expect(calls).toEqual([
      { file: "omarchy", args: ["launch", "browser", "https://example.com/"] },
      { file: "omarchy-shell", args: ["media", "next"] }
    ]);
    expect((opened as { isError?: boolean }).isError).not.toBe(true);
    expect((opened as { content: Array<{ text: string }> }).content[0]?.text).not.toContain("https://example.com/");
    expect((mediaResult as { isError?: boolean }).isError).toBe(true);
  });

  it("builds bounded provider-specific browser handoffs without claiming an answer", () => {
    expect(normalizeWebHandoffQuery("  current\n  Omarchy release  ")).toBe("current Omarchy release");
    expect(() => normalizeWebHandoffQuery("\u202eevil")).toThrow(/unsafe/u);
    expect(() => normalizeWebHandoffQuery("bad\u0000query")).toThrow(/unsafe/u);
    const search = webHandoffTarget("duckduckgo", "current Omarchy release");
    expect(new URL(search.url).searchParams.get("q")).toBe("current Omarchy release");
    expect(search.clipboardFallback).toBe(false);

    const ai = webHandoffTarget("chatgpt", "current Omarchy release");
    expect(new URL(ai.url).origin).toBe("https://chatgpt.com");
    expect(new URL(ai.url).searchParams.get("q")).toBe(ai.prompt);
    expect(ai.prompt).toContain("answer with cited sources");
    expect(ai.clipboardFallback).toBe(true);
    expect(webHandoffApproval("grok", "\u202einvalid")).toMatchObject({
      command: "web_handoff (invalid question; no browser will be opened)",
      provider: "grok",
      query: "Invalid question"
    });
  });

  it("opens the configured AI site as exact argv and copies a resilient fallback prompt", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const copied: string[] = [];
    const tool = createWebHandoffTool("claude", (file, args) => {
      calls.push({ file, args });
      return Promise.resolve({ stdout: "", stderr: "" });
    }, (text) => { copied.push(text); return Promise.resolve(true); });
    const result = await tool.execute(
      "handoff", { query: "What changed in Omarchy today?" }, undefined, undefined, {} as never
    ) as { content: Array<{ text: string }>; details?: Record<string, unknown>; isError?: boolean };
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("omarchy");
    expect(calls[0]?.args.slice(0, 2)).toEqual(["launch", "browser"]);
    expect(new URL(calls[0]?.args[2] ?? "").origin).toBe("https://claude.ai");
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("What changed in Omarchy today?");
    expect(result.content[0]?.text).toContain("OmaPilot has not read an answer");
    expect(result.details).toMatchObject({ provider: "claude", clipboardCopied: true, answerAvailable: false });
    expect(result.isError).not.toBe(true);
  });

  it("separates OmaPilot config from the standard shared agents root", () => {
    const env = { HOME: "/home/test", XDG_CONFIG_HOME: "/config" };
    expect(configDirectory(env)).toBe("/config/omapilot");
    expect(agentDirectory(env)).toBe("/home/test/.agents");
    expect(configDirectory({ ...env, OMAPILOT_CONFIG_DIR: "/custom/config" })).toBe("/custom/config");
    expect(agentDirectory({ ...env, OMAPILOT_AGENTS_DIR: "/custom/agents" })).toBe("/custom/agents");
  });

  it("offers native subscription and API-key login methods without launching Pi", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-auth-methods-"));
    roots.push(root);
    const agentDir = join(root, ".config/omapilot");
    const methods = await discoverPiAuthMethods({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
    expect(methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "openai-codex::oauth", authType: "oauth" }),
      expect.objectContaining({ id: "openai::api_key", authType: "api_key" }),
      expect.objectContaining({ id: "xai::oauth", authType: "oauth" }),
      expect.objectContaining({ id: "xai::api_key", authType: "api_key" })
    ]));
    // Claude was removed as a provider. The anthropic OAuth flow stays
    // registered because Pi's loader type requires it, so assert the product
    // decision directly: no anthropic method may be offered.
    expect(methods.some((method) => method.providerId === "anthropic")).toBe(false);
  });

  it("persists an API key through Pi's typed background login interaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-auth-login-"));
    roots.push(root);
    const agentDir = join(root, ".config/omapilot");
    const prompts: Array<{ type: string; message: string }> = [];
    await loginPiProvider({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir }, "openai::api_key", {
      signal: new AbortController().signal,
      prompt: (prompt) => { prompts.push({ type: prompt.type, message: prompt.message }); return Promise.resolve("test-secret-key"); },
      notify: () => undefined
    });
    expect(prompts).toEqual([expect.objectContaining({ type: "secret" })]);
    const stored: unknown = JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8"));
    expect(stored).toMatchObject({ openai: { type: "api_key", key: "test-secret-key" } });
    const providers = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
    expect(providers[0]?.models.some((model) => model.id.startsWith("openai::"))).toBe(true);
  });

  it("keeps session grants ephemeral and durable grants as command-free fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-approvals-"));
    roots.push(root);
    const path = join(root, "config/approvals.json");
    const first = new PiApprovalState(path, "/workspace");
    const sessionKey = first.key("bash", { command: "echo session" });
    const durableKey = first.key("write", { command: "write /tmp/a", path: "/tmp/a", content: "secret" });
    first.allowSession(sessionKey);
    first.allowAlways(durableKey);
    expect(first.allowed(sessionKey)).toBe(true);

    const restarted = new PiApprovalState(path, "/workspace");
    expect(restarted.allowed(sessionKey)).toBe(false);
    expect(restarted.allowed(durableKey)).toBe(true);
    expect(await readFile(path, "utf8")).not.toMatch(/echo session|write \/tmp|secret/u);
    restarted.denyAlways(durableKey);
    const denied = new PiApprovalState(path, "/workspace");
    expect(denied.allowed(durableKey)).toBe(false);
    expect(denied.denied(durableKey)).toBe(true);
  });

  it("discovers OpenAI API auth and groups OpenAI-compatible models", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-"));
    roots.push(root);
    const agentDir = join(root, ".config/omapilot");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "models.json"), JSON.stringify({
      providers: {
        local: {
          baseUrl: "http://127.0.0.1:11434/v1",
          api: "openai-completions",
          omapilotManaged: true,
          omapilotAuthRequired: false,
          models: [{ id: "coder", name: "Local Coder", contextWindow: 32_000 }]
        }
      }
    }));

    const providers = await discoverPiProviders({
      HOME: root,
      OMAPILOT_CONFIG_DIR: agentDir,
      OPENAI_API_KEY: "test-openai-key"
    });

    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("builtin");
    expect(providers[0]?.models).toContainEqual(
      expect.objectContaining({ id: expect.stringMatching(/^openai::/u) })
    );
    expect(providers[0]?.models).toContainEqual(
      expect.objectContaining({ id: "local::coder", name: "Local Coder (local)" })
    );
    expect(providers.every((provider) => provider.kind === "pi" && provider.agentDir === agentDir)).toBe(true);
  });

  it("loads bounded named agents and all supported shared skill roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-resources-"));
    roots.push(root);
    const agentDir = join(root, ".agents");
    const project = join(root, "project");
    const userSkills = join(agentDir, "skills");
    const projectSkills = join(project, ".agents/skills");
    const piProjectSkills = join(project, ".pi/skills");
    const globalPiSkills = join(root, ".pi/agent/skills");
    await Promise.all([
      mkdir(join(agentDir, "agents"), { recursive: true }),
      mkdir(userSkills, { recursive: true }),
      mkdir(join(globalPiSkills, "omarchy"), { recursive: true }),
      mkdir(projectSkills, { recursive: true }),
      mkdir(piProjectSkills, { recursive: true })
    ]);
    await writeFile(join(agentDir, "agents/reviewer.md"), [
      "---", "name: reviewer", "description: Reviews changes", "tools: [read, grep, write, unknown]", "model: openai/test", "---",
      "Review carefully."
    ].join("\n"));
    await writeFile(join(agentDir, "agents/invalid.md"), "---\nname: BAD NAME\ndescription: no\n---\nIgnore");
    await writeFile(join(globalPiSkills, "omarchy/SKILL.md"), [
      "---", "name: omarchy", "description: Use the official Omarchy system skill.", "---", "Follow Omarchy."
    ].join("\n"));

    expect(discoverAgentProfiles(agentDir, project)).toEqual([expect.objectContaining({
      name: "reviewer",
      description: "Reviews changes",
      tools: ["read", "grep", "write"],
      model: "openai/test",
      systemPrompt: "Review carefully."
    })]);
    expect(existingSkillPaths(agentDir, project, root)).toEqual([userSkills, globalPiSkills, projectSkills, piProjectSkills]);
    expect(bundledSkillPaths()).toEqual([resolve("skills")]);
    expect(requiresPiPermission("desktop_state")).toBe(false);
    expect(requiresPiPermission("omarchy_commands")).toBe(false);
    expect(requiresPiPermission("web_handoff")).toBe(true);
    expect(requiresPiPermission("app_open")).toBe(true);
    expect(requiresPiPermission("window_action")).toBe(true);
    expect(requiresPiPermission("workspace_action")).toBe(true);
    const loader = new DefaultResourceLoader({
      cwd: project,
      agentDir: join(root, ".config/omapilot"),
      noExtensions: true,
      noSkills: true,
      additionalSkillPaths: [...existingSkillPaths(agentDir, project, root), ...bundledSkillPaths()]
    });
    await loader.reload();
    expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(["omarchy", "omapilot-desktop"]));
    expect(loader.getSkills().diagnostics).toEqual([]);
  });

  it("aborts and disposes a delegated Pi session when its parent is cancelled", async () => {
    const controller = new AbortController();
    let releasePrompt: (() => void) | undefined;
    let aborts = 0;
    let disposals = 0;
    const promptStarted = new Promise<void>((resolveStarted) => {
      releasePrompt = resolveStarted;
    });
    const session = {
      state: { messages: [] },
      prompt: () => promptStarted,
      abort: () => {
        aborts += 1;
        releasePrompt?.();
        return Promise.resolve();
      },
      dispose: () => { disposals += 1; }
    };

    const nested = runNestedAgentPrompt(session, "Wait", [controller.signal]);
    controller.abort();

    await expect(nested).rejects.toMatchObject({ code: "cancelled", retryable: false });
    expect(aborts).toBe(1);
    expect(disposals).toBe(1);
  });

  it("rejects a truncated nested-agent answer instead of presenting partial text as complete", async () => {
    let disposals = 0;
    const session = {
      state: { messages: [] as unknown[] },
      prompt: () => {
        session.state.messages.push({
          role: "assistant", content: [{ type: "text", text: "Partial answer" }], stopReason: "length"
        });
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
      dispose: () => { disposals += 1; }
    };
    await expect(runNestedAgentPrompt(session, "Answer", [])).rejects.toMatchObject({
      code: "incomplete_response", retryable: true
    });
    expect(disposals).toBe(1);
  });

  it("runs and streams a complete turn through an OpenAI-compatible endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-run-"));
    roots.push(root);
    const requests: unknown[] = [];
    const authorizationHeaders: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push(JSON.parse(body));
        authorizationHeaders.push(request.headers.authorization);
        response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "coder",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hello " }, finish_reason: null }]
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "coder",
        choices: [{ index: 0, delta: { content: "from Pi." }, finish_reason: null }]
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "coder",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
      })}\n\ndata: [DONE]\n\n`);
        response.end();
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions",
        omapilotManaged: true, omapilotAuthRequired: false,
        compat: { supportsUsageInStreaming: true }, models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");
      const events: BrokerEvent[] = [];
      const run = runPiQuestion(provider, "pi-turn", "Say hello", "local::coder", (event) => events.push(event), 5_000);
      const first = await run.result;
      expect(first).toMatchObject({ answer: "Hello from Pi.", resumable: true });
      const resumed = runPiQuestion(
        provider, "pi-follow-up", "What did I ask?", "local::coder", (event) => events.push(event), 5_000,
        undefined, undefined, first.sessionId
      );
      await expect(resumed.result).resolves.toMatchObject({ sessionId: first.sessionId, resumable: true });
      expect(events.filter((event) => event.type === "content")).toEqual([
        { type: "content", id: "pi-turn", delta: "Hello " },
        { type: "content", id: "pi-turn", delta: "from Pi." },
        { type: "content", id: "pi-follow-up", delta: "Hello " },
        { type: "content", id: "pi-follow-up", delta: "from Pi." }
      ]);
      expect(JSON.stringify(requests[1])).toContain("Say hello");
      expect(JSON.stringify(requests[1])).toContain("Hello from Pi.");
      expect(JSON.stringify(requests[1])).toContain("What did I ask?");
      expect(JSON.stringify(requests[0])).toContain('"open_url"');
      expect(JSON.stringify(requests[0])).toContain('"web_handoff"');
      expect(JSON.stringify(requests[0])).toContain('"media_control"');
      expect(JSON.stringify(requests[0])).toContain('"app_catalog"');
      expect(JSON.stringify(requests[0])).toContain('"app_open"');
      expect(JSON.stringify(requests[0])).toContain('"desktop_state"');
      expect(JSON.stringify(requests[0])).toContain('"window_action"');
      expect(JSON.stringify(requests[0])).toContain('"workspace_action"');
      expect(JSON.stringify(requests[0])).toContain('"omarchy_commands"');
      expect(authorizationHeaders).toEqual([undefined, undefined]);
      const sessionDir = join(root, ".local/state/omapilot/pi-sessions");
      const sessionFiles = await readdir(sessionDir);
      expect(sessionFiles).toHaveLength(1);
      expect(await readFile(join(sessionDir, sessionFiles[0] ?? "missing"), "utf8")).toContain("What did I ask?");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("rejects and rolls back a failed resumed tool turn instead of replaying prior or partial text", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-failed-turn-"));
    roots.push(root);
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      requests += 1;
      if (requests === 3) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: {
          message: "Provider returned error: 12 validation errors for ChatCompletionRequest: input_value='output_text'"
        } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = requests === 1
        ? {
            id: "chatcmpl-prior", object: "chat.completion.chunk", created: 1, model: "coder",
            choices: [{ index: 0, delta: { role: "assistant", content: "Previous success." }, finish_reason: "stop" }]
          }
        : {
            id: "chatcmpl-partial-tool", object: "chat.completion.chunk", created: 1, model: "coder",
            choices: [{ index: 0, delta: {
              role: "assistant", content: "Checking now. ",
              tool_calls: [{ index: 0, id: "call-read", type: "function", function: {
                name: "read", arguments: JSON.stringify({ path: resolve("package.json") })
              } }]
            }, finish_reason: "tool_calls" }]
          };
      response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions",
        omapilotManaged: true, omapilotAuthRequired: false,
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");
      const first = await runPiQuestion(provider, "prior", "First", "local::coder", () => undefined, 5_000).result;
      const sessionDir = join(root, ".local/state/omapilot/pi-sessions");
      const [sessionName] = await readdir(sessionDir);
      if (sessionName === undefined) throw new Error("Pi session was not persisted");
      const sessionPath = join(sessionDir, sessionName);
      const beforeFailure = await readFile(sessionPath, "utf8");
      const events: BrokerEvent[] = [];
      const failed = runPiQuestion(
        provider, "failed", "Use a tool", "local::coder", (event) => events.push(event), 5_000,
        undefined, undefined, first.sessionId
      );
      await expect(failed.result).rejects.toMatchObject({ code: "provider_incompatible", retryable: false });
      expect(events).toContainEqual({ type: "content", id: "failed", delta: "Checking now. " });
      expect(await readFile(sessionPath, "utf8")).toBe(beforeFailure);
      expect(requests).toBe(3);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("retries one transient provider failure without retrying the completed turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-provider-retry-"));
    roots.push(root);
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      requests += 1;
      if (requests === 1) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "temporarily unavailable" } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({
        id: "chatcmpl-recovered", object: "chat.completion.chunk", created: 1, model: "coder",
        choices: [{ index: 0, delta: { role: "assistant", content: "Recovered." }, finish_reason: "stop" }]
      })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions",
        omapilotManaged: true, omapilotAuthRequired: false,
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");
      await expect(runPiQuestion(provider, "retry", "Recover", "local::coder", () => undefined, 5_000).result)
        .resolves.toMatchObject({ answer: "Recovered." });
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("blocks a Pi write until the broker permission handler allows it", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-permission-"));
    roots.push(root);
    const target = join(root, "should-not-exist.txt");
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      requests += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = requests === 1
        ? {
            id: "chatcmpl-tool", object: "chat.completion.chunk", created: 1, model: "coder",
            choices: [{ index: 0, delta: {
              role: "assistant", content: "I will try that. ",
              tool_calls: [{ index: 0, id: "call-write", type: "function", function: {
                name: "write", arguments: JSON.stringify({ path: target, content: "blocked" })
              } }]
            }, finish_reason: "tool_calls" }]
          }
        : {
            id: "chatcmpl-tool", object: "chat.completion.chunk", created: 1, model: "coder",
            choices: [{ index: 0, delta: { role: "assistant", content: "Denied safely." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 }
          };
      response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions", apiKey: "test",
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");
      const permissions: Array<{ command?: unknown; path?: unknown; content?: unknown }> = [];
      const events: BrokerEvent[] = [];
      const run = runPiQuestion(provider, "pi-tool-turn", "Write a file", "local::coder", (event) => events.push(event), 5_000,
        (request) => {
          permissions.push(request.toolCall.rawInput ?? {});
          return Promise.resolve(request.options.find((option) => option.kind === "reject_once")?.optionId);
        });
      await expect(run.result).resolves.toMatchObject({ answer: "Denied safely." });
      expect(events).toContainEqual({ type: "content", id: "pi-tool-turn", delta: "I will try that. " });
      expect(permissions).toEqual([{ command: `write ${target}`, path: target, content: "blocked" }]);
      expect(existsSync(target)).toBe(false);
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("binds the selected web handoff provider into the exact Pi approval request", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-web-handoff-"));
    roots.push(root);
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      requests += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = requests === 1
        ? {
            id: "chatcmpl-web-handoff", object: "chat.completion.chunk", created: 1, model: "coder",
            choices: [{ index: 0, delta: {
              role: "assistant",
              tool_calls: [{ index: 0, id: "call-web-handoff", type: "function", function: {
                name: "web_handoff", arguments: JSON.stringify({ query: "What changed in Omarchy today?" })
              } }]
            }, finish_reason: "tool_calls" }]
          }
        : {
            id: "chatcmpl-web-handoff", object: "chat.completion.chunk", created: 1, model: "coder",
            choices: [{ index: 0, delta: { role: "assistant", content: "The browser handoff was denied." }, finish_reason: "stop" }]
          };
      response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions", apiKey: "test",
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");
      const permissions: Array<Record<string, unknown>> = [];
      const run = runPiQuestion(
        provider, "pi-web-handoff", "Find current information", "local::coder", () => undefined, 5_000,
        (request) => {
          permissions.push((request.toolCall.rawInput ?? {}) as Record<string, unknown>);
          return Promise.resolve(request.options.find((option) => option.kind === "reject_once")?.optionId);
        }, undefined, undefined, "grok"
      );
      await expect(run.result).resolves.toMatchObject({ answer: "The browser handoff was denied." });
      expect(permissions).toHaveLength(1);
      expect(permissions[0]).toMatchObject({
        provider: "grok", providerLabel: "Grok", query: "What changed in Omarchy today?", clipboardFallback: true
      });
      const reviewedUrl = permissions[0]?.url;
      if (typeof reviewedUrl !== "string") throw new Error("reviewed web handoff URL missing");
      expect(new URL(reviewedUrl).origin).toBe("https://grok.com");
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("ships the Pi harness in the self-contained broker bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-bundle-"));
    roots.push(root);
    const requests: unknown[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({
          id: "chatcmpl-bundle", object: "chat.completion.chunk", created: 1, model: "coder",
          choices: [{ index: 0, delta: { role: "assistant", content: "Bundled Pi works." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
        })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions", apiKey: "test",
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const running = spawn(resolve("runtime/bin/omapilot-broker"), [], {
        env: {
          ...process.env,
          HOME: root,
          OMAPILOT_CONFIG_DIR: agentDir,
          OMAPILOT_DEBUG_PI: "1",
          XDG_STATE_HOME: join(root, "state"),
          XDG_CACHE_HOME: join(root, "cache"),
          XDG_RUNTIME_DIR: join(root, "run")
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
      child = running;
      const events: Array<Record<string, unknown>> = [];
      let stderr = "";
      running.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      createInterface({ input: running.stdout }).on("line", (line) => {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null) events.push(parsed as Record<string, unknown>);
      });
      running.stdin.write('{"type":"initialize","protocolVersion":2,"harness":"builtin"}\n');
      await until(() => events.some((event) => event.type === "ready"), 10_000);
      const ready = events.find((event) => event.type === "ready");
      expect(JSON.stringify(ready), stderr).toContain('"id":"builtin"');
      running.stdin.write('{"type":"submit","id":"bundle-turn","question":"hello","provider":"builtin","model":"local::coder"}\n');
      await until(() => events.some((event) => event.type === "complete"), 10_000);
      expect(events).toContainEqual({ type: "content", id: "bundle-turn", delta: "Bundled Pi works." });
      const firstComplete = events.find((event) => event.type === "complete");
      const firstChat = firstComplete?.chat as Record<string, unknown> | undefined;
      const firstSession = firstChat?.session as Record<string, unknown> | undefined;
      if (typeof firstChat?.id !== "string" || typeof firstSession?.acpId !== "string")
        throw new Error("persisted Pi chat session missing");
      running.stdin.write(`${JSON.stringify({
        type: "submit", id: "bundle-follow-up", question: "what did I say?", provider: "builtin",
        model: "local::coder", resumeChatId: firstChat.id
      })}\n`);
      await until(() => events.filter((event) => event.type === "complete").length === 2, 10_000);
      const secondComplete = events.filter((event) => event.type === "complete")[1];
      const secondSession = (secondComplete?.chat as Record<string, unknown> | undefined)?.session as Record<string, unknown> | undefined;
      expect(secondSession?.acpId).toBe(firstSession.acpId);
      expect(JSON.stringify(requests[1])).toContain("hello");
      expect(JSON.stringify(requests[1])).toContain("Bundled Pi works.");
      expect(JSON.stringify(requests[1])).toContain("what did I say?");
      running.stdin.end('{"type":"shutdown"}\n');
      await new Promise<void>((resolveExit) => running.once("close", () => resolveExit()));
      child = undefined;
    } finally {
      child?.kill("SIGTERM");
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 25_000);
});

async function until(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for broker event");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}
