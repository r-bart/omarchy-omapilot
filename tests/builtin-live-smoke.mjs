#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const state = await mkdtemp(join(tmpdir(), "omapilot-builtin-live-"));
const id = randomUUID();
const broker = spawn(resolve("runtime/bin/omapilot-broker"), [], {
  env: { ...process.env, XDG_STATE_HOME: state },
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = createInterface({ input: broker.stdout });
let ready = false;

const result = new Promise((resolveResult, reject) => {
  const timer = setTimeout(() => reject(new Error("Built-in live smoke timed out")), 120_000);
  lines.on("line", (line) => {
    const event = JSON.parse(line);
    if (event.type === "ready" && !ready) {
      ready = true;
      broker.stdin.write(JSON.stringify({
        type: "submit",
        id,
        question: "Return exactly OMAPILOT_BUILTIN_LIVE_OK.",
        provider: "builtin",
        model: process.env.OMAPILOT_LIVE_BUILTIN_MODEL ?? "openai-codex::gpt-5.4-mini",
      }) + "\n");
    }
    if (event.type === "complete" && event.chat !== undefined) {
      clearTimeout(timer);
      resolveResult(event);
    } else if (event.id === id && event.type === "error") {
      clearTimeout(timer);
      reject(new Error(`${event.code}: ${event.message}`));
    }
  });
  broker.once("error", reject);
  broker.once("close", (code) => {
    if (code !== 0 && code !== null) reject(new Error(`Broker exited with ${code}`));
  });
});

try {
  broker.stdin.write(JSON.stringify({ type: "initialize", protocolVersion: 2, harness: "builtin", client: "live-smoke" }) + "\n");
  const event = await result;
  if (!String(event.chat?.answer ?? "").includes("OMAPILOT_BUILTIN_LIVE_OK"))
    throw new Error(`Unexpected Built-in answer: ${String(event.chat?.answer ?? "")}`);
  process.stdout.write(JSON.stringify({ result: "pass", provider: "builtin" }) + "\n");
} finally {
  lines.close();
  broker.kill("SIGTERM");
  await rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
