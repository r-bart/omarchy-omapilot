import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { providerSessionRequest } from "../src/acp.js";
import type { DiscoveredProvider } from "../src/providers.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function until(predicate: () => boolean, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for MCP response");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

describe("read-only ACP capability bridge", () => {
  it("lists and runs only bounded read tools over MCP stdio", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-capability-mcp-"));
    roots.push(root);
    const bin = join(root, "bin");
    const home = join(root, "home");
    await Promise.all([mkdir(bin, { recursive: true }), mkdir(home, { recursive: true })]);
    const hey = join(bin, "hey");
    await writeFile(hey, [
      "#!/bin/sh",
      "if [ \"$1\" = auth ]; then",
      "  printf '%s\\n' '{\"ok\":true,\"data\":{\"authenticated\":true}}'",
      "else",
      "  printf '%s\\n' '{\"ok\":true,\"data\":[{\"subject\":\"Fixture result\"}]}'",
      "fi"
    ].join("\n"));
    await chmod(hey, 0o755);
    const child = spawn(process.execPath, [resolve("runtime/dist/capability-mcp.js")], {
      env: {
        HOME: home,
        PATH: bin,
        XDG_CONFIG_HOME: join(root, "config"),
        OMAPILOT_CAPABILITY_ACP_SCOPE: "host-reads"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const messages: Array<Record<string, unknown>> = [];
    createInterface({ input: child.stdout }).on("line", (line) => messages.push(JSON.parse(line) as Record<string, unknown>));
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}\n');
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n');
    await until(() => messages.some((message) => message.id === 2));
    const list = messages.find((message) => message.id === 2)?.result as { tools: Array<{ name: string }> };
    expect(list.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["capabilities", "email_search", "email_thread"]));
    expect(list.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["email_send", "calendar_todo_create", "files_open", "meeting_join", "signal_send"]));

    child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"email_search","arguments":{"query":"fixture"}}}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"email_send","arguments":{"to":"x@example.com","subject":"x","message":"x"}}}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"capabilities","arguments":{}}}\n');
    await until(() => messages.some((message) => message.id === 3) && messages.some((message) => message.id === 4)
      && messages.some((message) => message.id === 5));
    expect(JSON.stringify(messages.find((message) => message.id === 3))).toContain("Fixture result");
    expect(messages.find((message) => message.id === 4)).toMatchObject({ error: { code: -32602 } });
    const capabilityResult = messages.find((message) => message.id === 5)?.result as { content: Array<{ text: string }> };
    const capabilityViews = JSON.parse(capabilityResult.content[0]?.text ?? "[]") as Array<{
      id: string; operations: Array<{ id: string; available: boolean }>;
    }>;
    expect(capabilityViews.find((view) => view.id === "email")?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "search", available: true }),
      expect.objectContaining({ id: "send", available: false })
    ]));
    child.stdin.end();
    await new Promise((resolveExit) => child.once("close", resolveExit));
  });

  it("injects the bundled read-only server into answer sessions but not model probes", () => {
    const provider = {
      id: "codex",
      agent: { env: { HOME: "/home/test", PATH: "/usr/bin" } }
    } as unknown as DiscoveredProvider;
    const answer = providerSessionRequest(provider, "/tmp/chat");
    expect(answer.mcpServers).toEqual([expect.objectContaining({
      name: "OmaPilot personal capabilities (read only)",
      command: resolve("runtime/dist/capability-mcp.js"),
      args: [],
      env: [
        { name: "HOME", value: "/home/test" },
        { name: "PATH", value: "/usr/bin" },
        { name: "OMAPILOT_CAPABILITY_ACP_SCOPE", value: "host-reads" }
      ]
    })]);
    const opencode = {
      id: "opencode",
      agent: { env: { HOME: "/home/test", PATH: "/usr/bin" } }
    } as unknown as DiscoveredProvider;
    expect(providerSessionRequest(opencode, "/tmp/chat").mcpServers).toEqual([
      expect.objectContaining({ env: expect.arrayContaining([{
        name: "OMAPILOT_CAPABILITY_ACP_SCOPE", value: "connector-reads"
      }]) })
    ]);
    expect(providerSessionRequest(provider, "/tmp/probe", false).mcpServers).toEqual([]);
  });

  it("keeps registry and host-file tools out of OpenCode's connector-only scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-capability-mcp-scope-"));
    roots.push(root);
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const child = spawn(process.execPath, [resolve("runtime/dist/capability-mcp.js")], {
      env: {
        HOME: home,
        PATH: "",
        XDG_CONFIG_HOME: join(root, "config"),
        OMAPILOT_CAPABILITY_ACP_SCOPE: "connector-reads"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const messages: Array<Record<string, unknown>> = [];
    createInterface({ input: child.stdout }).on("line", (line) => messages.push(JSON.parse(line) as Record<string, unknown>));
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}\n');
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"capabilities","arguments":{}}}\n');
    await until(() => messages.some((message) => message.id === 2) && messages.some((message) => message.id === 3));
    const list = messages.find((message) => message.id === 2)?.result as { tools: Array<{ name: string }> };
    expect(list.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["capabilities", "files_list", "files_read"]));
    expect(messages.find((message) => message.id === 3)).toMatchObject({ error: { code: -32602 } });
    child.stdin.end();
    await new Promise((resolveExit) => child.once("close", resolveExit));
  });
});
