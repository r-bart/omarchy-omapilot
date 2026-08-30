#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "omapilot-gtk-e2e-"));
const output = join(scratch, "value.txt");
const initial = "teh cat sat on teh mat";
const corrected = "The cat sat on the mat";
let app;

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
async function until(operation, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch {}
    await wait(200);
  }
  throw new Error(`${label} timed out`);
}
async function command(name, args, timeout = 10_000) {
  return exec(name, args, { timeout, maxBuffer: 1_000_000 });
}
async function replaceThroughBroker(text, address) {
  const child = spawn(resolve(root, "runtime/bin/omapilot-broker"), [], {
    env: { ...process.env, XDG_STATE_HOME: scratch }, stdio: ["pipe", "pipe", "inherit"]
  });
  const lines = createInterface({ input: child.stdout });
  try {
    await new Promise((resolveReplace, reject) => {
      const timer = setTimeout(() => reject(new Error("Broker replacement timed out")), 15_000);
      lines.on("line", (line) => {
        const event = JSON.parse(line);
        if (event.type === "ready") child.stdin.write(JSON.stringify({ type: "selection_replace", text, address }) + "\n");
        if (event.type === "selection_replaced") {
          clearTimeout(timer);
          if (event.replaced) resolveReplace();
          else reject(new Error(`Broker replacement failed: ${event.reason ?? "unknown"}`));
        }
      });
      child.once("error", reject);
      child.stdin.write(JSON.stringify({ type: "initialize", protocolVersion: 2, harness: "builtin", client: randomUUID() }) + "\n");
    });
  } finally {
    lines.close();
    child.kill("SIGTERM");
  }
}

try {
  app = spawn("python3", [resolve(root, "tests/fixtures/text-editor-gtk.py")], {
    env: { ...process.env, OMAPILOT_GTK_E2E_OUTPUT: output }, stdio: "ignore", detached: true
  });
  const address = await until(async () => {
    const { stdout } = await command("hyprctl", ["clients", "-j"]);
    return JSON.parse(stdout).find((client) => client.title === "OmaPilot GTK text action lab")?.address;
  }, 10_000, "GTK fixture window");
  await command("hyprctl", ["dispatch", `hl.dsp.focus({ window = "address:${address}" })`]);
  await command("wtype", ["-M", "ctrl", "-k", "a", "-m", "ctrl"]);
  await until(async () => (await command("wl-paste", ["--primary", "--no-newline"])).stdout === initial, 5_000, "GTK primary selection");
  await replaceThroughBroker(corrected, address);
  const finalText = await until(async () => {
    const value = await readFile(output, "utf8");
    return value === corrected ? value : undefined;
  }, 5_000, "GTK replacement");
  process.stdout.write(JSON.stringify({ result: "pass", app: "gtk4-textview", action: "fix", initial, final: finalText }) + "\n");
} finally {
  if (app?.pid !== undefined) {
    try { process.kill(-app.pid, "SIGTERM"); } catch {}
  }
  await wait(200);
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
