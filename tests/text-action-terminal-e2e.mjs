#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), "omapilot-terminal-e2e-"));
const output = join(scratch, "result.txt");
const title = `OmaPilot terminal safety lab ${process.pid}`;
const expected = "OMAPILOT_TERMINAL_UNCHANGED";
let terminal;

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
async function command(name, args, timeout = 10_000) {
  return exec(name, args, { timeout, maxBuffer: 1_000_000 });
}
async function until(operation, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await operation(); if (value) return value; } catch {}
    await wait(200);
  }
  throw new Error(`${label} timed out`);
}
async function ownPrimary(text) {
  const copy = spawn("wl-copy", ["--primary"], { stdio: ["pipe", "ignore", "inherit"] });
  copy.stdin.end(text);
  await new Promise((resolveCopy, reject) => {
    copy.once("error", reject);
    copy.once("close", (code) => code === 0 ? resolveCopy() : reject(new Error(`wl-copy exited with ${code}`)));
  });
}

try {
  terminal = spawn("foot", [`--title=${title}`, "bash", "--noprofile", "--norc"], {
    env: { ...process.env, PS1: "omapilot-e2e$ " }, stdio: "ignore", detached: true
  });
  const address = await until(async () => {
    const { stdout } = await command("hyprctl", ["clients", "-j"]);
    return JSON.parse(stdout).find((client) => client.title === title)?.address;
  }, 10_000, "terminal fixture window");

  await command("hyprctl", ["dispatch", `hl.dsp.focus({ window = "address:${address}" })`]);
  await wait(300);
  const line = `printf ${expected} > ${output}`;
  await command("wtype", [line]);
  await ownPrimary("teh cat sat on teh mat");

  const { stdout } = await command("omarchy-shell", ["io.github.spencerbull.omapilot", "fixSelection"]);
  const decision = stdout.trim();
  if (decision !== "terminal") throw new Error(`Terminal action returned ${decision || "no response"}`);

  // A refused action opens the explanatory surface. Return to the isolated
  // fixture and execute the line we typed before the refusal. Any injected
  // replacement changes the command or its output and fails this assertion.
  await command("hyprctl", ["dispatch", `hl.dsp.focus({ window = "address:${address}" })`]);
  await command("wtype", ["-k", "Return"]);
  const final = await until(async () => {
    const value = await readFile(output, "utf8");
    return value === expected ? value : undefined;
  }, 5_000, "unchanged terminal command");

  process.stdout.write(JSON.stringify({
    result: "pass", app: "foot", action: "refuse-text-replacement", decision, commandUnchanged: final === expected
  }) + "\n");
} finally {
  if (terminal?.pid !== undefined) {
    try { process.kill(-terminal.pid, "SIGTERM"); } catch {}
  }
  await wait(200);
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
