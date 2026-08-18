import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserCompanionServer, type BrowserCapture } from "../src/browser-companion.js";

const roots: string[] = [];
const servers: BrowserCompanionServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("browser companion broker", () => {
  it("selects a matching browser session and arms only that page", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-browser-")); roots.push(root);
    const captures: BrowserCapture[] = [];
    const server = new BrowserCompanionServer({ HOME: root, XDG_RUNTIME_DIR: join(root, "run") }, {
      capture: (capture) => { captures.push(capture); }, cancelled: () => undefined, error: () => undefined
    });
    servers.push(server);
    await server.start();
    const client = createConnection(server.socketPath);
    const lines: Record<string, unknown>[] = [];
    client.setEncoding("utf8");
    let buffer = "";
    client.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        lines.push(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
        buffer = buffer.slice(newline + 1);
      }
    });
    await new Promise<void>((resolve) => client.once("connect", resolve));
    client.write(`${JSON.stringify({ version: 1, type: "hello", family: "chromium", browser: "Chromium", extensionVersion: "0.1.0" })}\n`);
    await until(() => lines.some((line) => line.type === "hello.ack"));
    expect(server.status()).toEqual({ chromiumConnected: true, firefoxConnected: false });

    const arm = server.tryArm("clip-1", "chromium-browser", "Documentation - Chromium");
    await until(() => lines.some((line) => line.type === "probe"));
    client.write(`${JSON.stringify({
      version: 1, type: "probe.result", requestId: "clip-1", available: true,
      title: "Documentation", url: "https://example.test/docs"
    })}\n`);
    await expect(arm).resolves.toMatchObject({ status: "armed", browser: "Chromium", title: "Documentation" });
    await until(() => lines.some((line) => line.type === "capture.arm"));
    client.destroy();
    await until(() => !server.status().chromiumConnected);
  });

  it("reports a missing site grant without collecting page metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-browser-")); roots.push(root);
    const server = new BrowserCompanionServer({ HOME: root, XDG_RUNTIME_DIR: join(root, "run") }, {
      capture: () => undefined, cancelled: () => undefined, error: () => undefined
    });
    servers.push(server);
    await server.start();
    const client = createConnection(server.socketPath);
    const lines: Record<string, unknown>[] = [];
    client.setEncoding("utf8");
    let buffer = "";
    client.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        lines.push(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
        buffer = buffer.slice(newline + 1);
      }
    });
    await new Promise<void>((resolve) => client.once("connect", resolve));
    client.write(`${JSON.stringify({ version: 1, type: "hello", family: "firefox", browser: "Firefox", extensionVersion: "0.1.0" })}\n`);
    await until(() => lines.some((line) => line.type === "hello.ack"));
    const arm = server.tryArm("clip-2", "firefox", "Private page");
    await until(() => lines.some((line) => line.type === "probe"));
    client.write(`${JSON.stringify({
      version: 1, type: "probe.result", requestId: "clip-2", available: false,
      reason: "Site permission is required"
    })}\n`);
    await expect(arm).resolves.toEqual({ status: "permission-required" });
    client.destroy();
  });
});

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for browser companion event");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
