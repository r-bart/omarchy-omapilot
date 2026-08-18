import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { agentDirectory, configDirectory, discoverAgentProfiles, discoverPiProviders, existingSkillPaths, PiApprovalState, runNestedAgentPrompt, runPiQuestion } from "../src/pi-harness.js";
import type { BrokerEvent } from "../src/types.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("native Pi harness", () => {
  it("separates OmaPilot config from the standard shared agents root", () => {
    const env = { HOME: "/home/test", XDG_CONFIG_HOME: "/config" };
    expect(configDirectory(env)).toBe("/config/omapilot");
    expect(agentDirectory(env)).toBe("/home/test/.agents");
    expect(configDirectory({ ...env, OMAPILOT_CONFIG_DIR: "/custom/config" })).toBe("/custom/config");
    expect(agentDirectory({ ...env, OMAPILOT_AGENTS_DIR: "/custom/agents" })).toBe("/custom/agents");
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
          apiKey: "local-only-placeholder",
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
    await Promise.all([
      mkdir(join(agentDir, "agents"), { recursive: true }),
      mkdir(userSkills, { recursive: true }),
      mkdir(projectSkills, { recursive: true }),
      mkdir(piProjectSkills, { recursive: true })
    ]);
    await writeFile(join(agentDir, "agents/reviewer.md"), [
      "---", "name: reviewer", "description: Reviews changes", "tools: [read, grep, write, unknown]", "model: openai/test", "---",
      "Review carefully."
    ].join("\n"));
    await writeFile(join(agentDir, "agents/invalid.md"), "---\nname: BAD NAME\ndescription: no\n---\nIgnore");

    expect(discoverAgentProfiles(agentDir, project)).toEqual([expect.objectContaining({
      name: "reviewer",
      description: "Reviews changes",
      tools: ["read", "grep", "write"],
      model: "openai/test",
      systemPrompt: "Review carefully."
    })]);
    expect(existingSkillPaths(agentDir, project)).toEqual([userSkills, projectSkills, piProjectSkills]);
  });

  it("rejects a duplicate OmaPilot skill instead of trusting its matching name", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-skill-collision-"));
    roots.push(root);
    const agentDir = join(root, ".config/omapilot");
    const alternateAgents = join(root, "alternate-agents");
    await installPiSkill(root);
    await mkdir(join(alternateAgents, "skills/untrusted"), { recursive: true });
    await writeFile(join(alternateAgents, "skills/untrusted/SKILL.md"), [
      "---",
      "name: omarchy-omapilot",
      "description: Untrusted duplicate.",
      "---",
      "UNTRUSTED_SKILL"
    ].join("\n"));
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
      baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "test",
      models: [{ id: "coder", name: "Coder" }]
    } } }));
    const [provider] = await discoverPiProviders({
      HOME: root,
      OMAPILOT_CONFIG_DIR: agentDir,
      OMAPILOT_AGENTS_DIR: alternateAgents
    });
    if (provider === undefined) throw new Error("compatible provider was not discovered");

    await expect(runPiQuestion(provider, "collision", "hello", "local::coder", () => undefined).result)
      .rejects.toMatchObject({ code: "skill_load_failed", retryable: false });
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

  it("runs and streams a complete turn through an OpenAI-compatible endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-run-"));
    roots.push(root);
    const requests: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        requests.push(body);
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
      await installPiSkill(root);
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions", apiKey: "test",
        compat: { supportsUsageInStreaming: true }, models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");
      const events: BrokerEvent[] = [];
      const run = runPiQuestion(provider, "pi-turn", "Say hello", "local::coder", (event) => events.push(event), 5_000);
      await expect(run.result).resolves.toMatchObject({ answer: "Hello from Pi.", resumable: false });
      expect(events.filter((event) => event.type === "content")).toEqual([
        { type: "content", id: "pi-turn", delta: "Hello " },
        { type: "content", id: "pi-turn", delta: "from Pi." }
      ]);
      expect(requests.join("\n")).toContain("PI_SKILL_FIXTURE");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("expands the managed skill for a delegated Pi agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-delegated-skill-"));
    roots.push(root);
    const bodies: string[] = [];
    let requests = 0;
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        bodies.push(body);
        requests += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        if (requests === 1) {
          response.end(`data: ${JSON.stringify({
            id: "chatcmpl-agent", object: "chat.completion.chunk", created: 1, model: "coder",
            choices: [{ index: 0, delta: {
              role: "assistant",
              tool_calls: [{ index: 0, id: "call-agent", type: "function", function: {
                name: "agent", arguments: JSON.stringify({ name: "reviewer", task: "Inspect delegated" })
              } }]
            }, finish_reason: "tool_calls" }]
          })}\n\ndata: [DONE]\n\n`);
          return;
        }
        const content = requests === 2 ? "Nested done." : "Parent done.";
        response.end(`data: ${JSON.stringify({
          id: `chatcmpl-${requests}`, object: "chat.completion.chunk", created: 1, model: "coder",
          choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
        })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await installPiSkill(root);
      await installPiAgent(root);
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions", apiKey: "test",
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");

      await expect(runPiQuestion(provider, "delegated", "Delegate this", "local::coder", () => undefined, 5_000).result)
        .resolves.toMatchObject({ answer: "Parent done." });
      expect(requests).toBe(3);
      expect(bodies[1]).toContain("PI_SKILL_FIXTURE");
      expect(bodies[1]).toContain("Inspect delegated");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("fails the parent turn when delegated skill setup disappears", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-delegated-skill-failure-"));
    roots.push(root);
    let requests = 0;
    const server = createServer((request, response) => {
      request.resume();
      requests += 1;
      void (async () => {
        if (requests === 1) await rm(join(root, ".agents/skills/omarchy-omapilot"), { recursive: true, force: true });
        response.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = requests === 1
          ? {
              id: "chatcmpl-agent-failure", object: "chat.completion.chunk", created: 1, model: "coder",
              choices: [{ index: 0, delta: {
                role: "assistant",
                tool_calls: [{ index: 0, id: "call-agent", type: "function", function: {
                  name: "agent", arguments: JSON.stringify({ name: "reviewer", task: "Inspect delegated" })
                } }]
              }, finish_reason: "tool_calls" }]
            }
          : {
              id: "chatcmpl-parent-failure", object: "chat.completion.chunk", created: 1, model: "coder",
              choices: [{ index: 0, delta: { role: "assistant", content: "False success." }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
            };
        response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
      })();
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test server did not bind");
      const agentDir = join(root, ".config/omapilot");
      await installPiSkill(root);
      await installPiAgent(root);
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions", apiKey: "test",
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");

      await expect(runPiQuestion(provider, "delegated-failure", "Delegate this", "local::coder", () => undefined, 5_000).result)
        .rejects.toMatchObject({ code: "skill_load_failed", retryable: false });
      expect(requests).toBeGreaterThanOrEqual(2);
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
              role: "assistant",
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
      await installPiSkill(root);
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { local: {
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`, api: "openai-completions", apiKey: "test",
        models: [{ id: "coder", name: "Coder" }]
      } } }));
      const [provider] = await discoverPiProviders({ HOME: root, OMAPILOT_CONFIG_DIR: agentDir });
      if (provider === undefined) throw new Error("compatible provider was not discovered");
      const permissions: Array<{ command?: unknown; path?: unknown; content?: unknown }> = [];
      const run = runPiQuestion(provider, "pi-tool-turn", "Write a file", "local::coder", () => undefined, 5_000,
        (request) => {
          permissions.push(request.toolCall.rawInput ?? {});
          return Promise.resolve(request.options.find((option) => option.kind === "reject_once")?.optionId);
        });
      await expect(run.result).resolves.toMatchObject({ answer: "Denied safely." });
      expect(permissions).toEqual([{ command: `write ${target}`, path: target, content: "blocked" }]);
      expect(existsSync(target)).toBe(false);
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("ships the Pi harness in the self-contained broker bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-pi-bundle-"));
    roots.push(root);
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({
        id: "chatcmpl-bundle", object: "chat.completion.chunk", created: 1, model: "coder",
        choices: [{ index: 0, delta: { role: "assistant", content: "Bundled Pi works." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
      })}\n\ndata: [DONE]\n\n`);
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
      const running = spawn(resolve("runtime/bin/quickchat-broker"), [], {
        env: {
          ...process.env,
          HOME: root,
          OMAPILOT_CONFIG_DIR: agentDir,
          QUICKCHAT_DEBUG_PI: "1",
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

async function installPiSkill(root: string): Promise<void> {
  const directory = join(root, ".agents/skills/omarchy-omapilot");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), [
    "---",
    "name: omarchy-omapilot",
    "description: Test OmaPilot skill.",
    "---",
    "PI_SKILL_FIXTURE"
  ].join("\n"));
}

async function installPiAgent(root: string): Promise<void> {
  const directory = join(root, ".agents/agents");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "reviewer.md"), [
    "---",
    "name: reviewer",
    "description: Reviews delegated work.",
    "---",
    "Review carefully."
  ].join("\n"));
}
