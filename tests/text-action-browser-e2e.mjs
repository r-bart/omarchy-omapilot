#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(join(tmpdir(), "omapilot-browser-e2e-"));
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") reject(new Error("Could not allocate a DevTools port"));
    else server.close(() => resolvePort(address.port));
  });
});
const initial = "teh cat sat on teh mat";
let browser;

async function until(operation, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${label} timed out${last === undefined ? "" : `: ${String(last)}`}`);
}

async function command(name, args, timeout = 10_000) {
  return exec(name, args, { timeout, maxBuffer: 1_000_000 });
}

async function cdpSocket() {
  const page = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    const pages = await response.json();
    return pages.find((candidate) => candidate.type === "page" && candidate.url.includes("text-actions-lab.html"));
  }, 15_000, "Chromium DevTools page");
  return new WebSocket(page.webSocketDebuggerUrl);
}

async function evaluate(socket, expression) {
  const id = Math.floor(Math.random() * 1_000_000_000);
  const result = new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error("DevTools evaluation timed out")), 5_000);
    const listener = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", listener);
      if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)));
      else resolveResult(message.result?.result?.value);
    };
    socket.addEventListener("message", listener);
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  return result;
}

try {
  browser = spawn("chromium", [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--disable-default-apps",
    "--ozone-platform=wayland",
    `--app=${pathToFileURL(join(root, "tests/text-actions-lab.html")).href}`,
  ], { stdio: "ignore", detached: true });

  const socket = await cdpSocket();
  await new Promise((resolveOpen, reject) => {
    if (socket.readyState === WebSocket.OPEN) resolveOpen();
    else {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }
  });

  const address = await until(async () => {
    const { stdout } = await command("hyprctl", ["clients", "-j"]);
    const clients = JSON.parse(stdout);
    return clients.find((client) => String(client.title).includes("OmaPilot text action lab"))?.address;
  }, 15_000, "Chromium lab window");

  await command("hyprctl", ["dispatch", `hl.dsp.focus({ window = "address:${address}" })`]);
  await evaluate(socket, `(() => { const field = document.querySelector('textarea'); field.value = ${JSON.stringify(initial)}; field.focus(); field.select(); return field.value; })()`);
  await command("wtype", ["-M", "ctrl", "-k", "a", "-m", "ctrl"]);
  const selected = await until(async () => {
    const { stdout } = await command("wl-paste", ["--primary", "--no-newline"]);
    return stdout === initial ? stdout : undefined;
  }, 5_000, "primary selection");
  if (selected !== initial) throw new Error("The browser did not own the expected primary selection");

  await command("omarchy-shell", ["io.github.spencerbull.omapilot", "fixSelection"]);
  await until(async () => {
    const { stdout } = await command("omarchy-shell", ["io.github.spencerbull.omapilot", "status"]);
    if (stdout.trim() === "store=error" || stdout.trim() === "store=unavailable")
      throw new Error(`OmaPilot stopped in ${stdout.trim()}`);
    return stdout.trim() === "store=complete";
  }, 120_000, "OmaPilot answer");

  const { stdout: replace } = await command("omarchy-shell", ["io.github.spencerbull.omapilot", "replaceSelection"]);
  if (replace.trim() !== "ok") throw new Error(`Replacement returned ${replace.trim() || "no response"}`);

  const finalText = await until(async () => {
    const value = await evaluate(socket, "document.querySelector('textarea').value");
    return typeof value === "string" && value !== initial ? value : undefined;
  }, 10_000, "browser replacement");
  if (/\bteh\b/iu.test(finalText)) throw new Error(`Correction still contains the original typo: ${finalText}`);

  process.stdout.write(JSON.stringify({ result: "pass", app: "chromium", action: "fix", initial, final: finalText }) + "\n");
  socket.close();
} finally {
  if (browser?.pid !== undefined) {
    try { process.kill(-browser.pid, "SIGTERM"); } catch {}
  }
  await rm(profile, { recursive: true, force: true });
}
