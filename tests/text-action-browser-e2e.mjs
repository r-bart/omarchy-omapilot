#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
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
const initial = (process.env.OMAPILOT_E2E_INITIAL ?? "teh cat sat on teh mat").replaceAll("\\n", "\n");
const electron = process.env.OMAPILOT_E2E_ELECTRON === "1";
let browser;
let browserClosed;
const stage = (message) => process.stderr.write(`browser e2e: ${message}\n`);

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

async function selectField(socket, selector, value) {
  return evaluate(socket, `(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    if (field.isContentEditable) field.textContent = ${JSON.stringify(value)};
    else field.value = ${JSON.stringify(value)};
    field.focus();
    if (typeof field.select === "function") field.select();
    else {
      const range = document.createRange();
      range.selectNodeContents(field);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return field.isContentEditable ? field.textContent : field.value;
  })()`);
}

async function fieldValue(socket, selector) {
  return evaluate(socket, `(() => { const field = document.querySelector(${JSON.stringify(selector)}); return field.isContentEditable ? field.textContent : field.value; })()`);
}

async function replaceThroughBroker(text, address) {
  const child = spawn(resolve(root, "runtime/bin/omapilot-broker"), [], {
    env: { ...process.env, XDG_STATE_HOME: profile },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  const id = randomUUID();
  try {
    return await new Promise((resolveReplace, reject) => {
      const timer = setTimeout(() => reject(new Error("Broker replacement timed out")), 15_000);
      lines.on("line", (line) => {
        const event = JSON.parse(line);
        if (event.type === "ready") {
          child.stdin.write(JSON.stringify({ type: "selection_replace", text, address }) + "\n");
        } else if (event.type === "selection_replaced") {
          clearTimeout(timer);
          if (event.replaced) resolveReplace();
          else reject(new Error(`Broker replacement failed: ${event.reason ?? "unknown"}`));
        }
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0 && code !== null) reject(new Error(`Broker exited with ${code}`));
      });
      child.stdin.write(JSON.stringify({ type: "initialize", protocolVersion: 2, harness: "builtin", client: id }) + "\n");
    });
  } finally {
    lines.close();
    child.kill("SIGTERM");
  }
}

async function answerAndReplaceThroughBroker(provider, selection, address) {
  const child = spawn(resolve(root, "runtime/bin/omapilot-broker"), [], {
    env: { ...process.env, XDG_STATE_HOME: profile },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout });
  const id = randomUUID();
  let answer = "";
  try {
    return await new Promise((resolveReplace, reject) => {
      const timer = setTimeout(() => reject(new Error(`${provider} live replacement timed out`)), 180_000);
      lines.on("line", (line) => {
        const event = JSON.parse(line);
        if (event.type === "ready") {
          child.stdin.write(JSON.stringify({
            type: "submit",
            id,
            provider,
            displayQuestion: selection,
            saveToHistory: false,
            question: `Correct spelling and grammar. Return only the corrected text, with no quotes or commentary.\nBEGIN SELECTED TEXT\n${selection}\nEND SELECTED TEXT`,
          }) + "\n");
        } else if (event.id === id && event.type === "error") {
          clearTimeout(timer);
          reject(new Error(`${event.code}: ${event.message}`));
        } else if (event.type === "complete" && event.id === id) {
          answer = String(event.answer ?? "").trim();
          if (answer === "") reject(new Error(`${provider} returned an empty answer`));
          else child.stdin.write(JSON.stringify({ type: "selection_replace", text: answer, address }) + "\n");
        } else if (event.type === "selection_replaced") {
          clearTimeout(timer);
          if (event.replaced) resolveReplace(answer);
          else reject(new Error(`Broker replacement failed: ${event.reason ?? "unknown"}`));
        }
      });
      child.once("error", reject);
      child.stdin.write(JSON.stringify({ type: "initialize", protocolVersion: 2, harness: provider, client: id }) + "\n");
    });
  } finally {
    lines.close();
    child.kill("SIGTERM");
  }
}

try {
  const executable = electron ? "npx" : "chromium";
  const args = electron ? [
    "--yes", "electron@44.0.0", resolve(root, "tests/fixtures/electron-text-editor"),
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--ozone-platform=wayland",
  ] : [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--disable-default-apps",
    "--ozone-platform=wayland",
    `--app=${pathToFileURL(join(root, "tests/text-actions-lab.html")).href}`,
  ];
  browser = spawn(executable, args, { stdio: "ignore", detached: true });
  browserClosed = new Promise((resolveClosed) => browser.once("close", resolveClosed));
  stage(`${electron ? "Electron" : "Chromium"} launched`);

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
  stage(`lab window found at ${address}`);

  await command("hyprctl", ["dispatch", `hl.dsp.focus({ window = "address:${address}" })`]);
  // hyprctl acknowledges the compositor dispatch before Quickshell's
  // Hyprland.activeToplevel mirror necessarily receives the focus event.
  // The real hotkey cannot arrive before that event; give the integration
  // under test the same event boundary instead of racing its state mirror.
  await new Promise((resolveFocus) => setTimeout(resolveFocus, 500));
  const primarySelector = "#f-area";
  await selectField(socket, primarySelector, initial);
  await command("wtype", ["-M", "ctrl", "-k", "a", "-m", "ctrl"]);
  const selected = await until(async () => {
    const { stdout } = await command("wl-paste", ["--primary", "--no-newline"]);
    return stdout === initial ? stdout : undefined;
  }, 5_000, "primary selection");
  if (selected !== initial) throw new Error("The browser did not own the expected primary selection");
  stage("primary selection verified");

  const liveProvider = process.env.OMAPILOT_E2E_LIVE_PROVIDER;
  if (liveProvider === "ui") {
    const uiRoute = process.env.OMAPILOT_E2E_UI_ROUTE ?? "direct-fix";
    const chooserRoute = uiRoute === "chooser-translate" || uiRoute === "chooser-custom";
    const expectedAction = uiRoute === "chooser-translate" ? "translate"
      : uiRoute === "chooser-custom" ? "custom" : "fix";
    const actionState = async () => {
      const { stdout } = await command("omarchy-shell", ["io.github.spencerbull.omapilot", "textActionState"]);
      return JSON.parse(stdout);
    };
    const before = await actionState();
    const method = chooserRoute ? "textAction" : "fixSelection";
    const { stdout: startOutput } = await command("omarchy-shell", ["io.github.spencerbull.omapilot", method]);
    const startDecision = startOutput.trim();
    if (startDecision !== "start")
      throw new Error(`OmaPilot refused the text action: ${startDecision || "no response"}`);
    stage(`${uiRoute} submitted through shell IPC (${startDecision})`);
    if (chooserRoute) {
      await until(async () => (await actionState()).choosing === true, 10_000, "OmaPilot chooser");
      const chooserArgs = uiRoute === "chooser-custom"
        ? ["io.github.spencerbull.omapilot", "chooseCustomTextAction",
          "Correct spelling and grammar while preserving the meaning. Return only the revised text."]
        : ["io.github.spencerbull.omapilot", "chooseTextAction", "translate"];
      const { stdout: chooseOutput } = await command("omarchy-shell", chooserArgs);
      if (chooseOutput.trim() !== "ok")
        throw new Error(`OmaPilot chooser returned ${chooseOutput.trim() || "no response"}`);
      stage(`${expectedAction} selected through chooser action route`);
    }
    const completed = await until(async () => {
      const current = await actionState();
      if (current.state === "error" || current.state === "unavailable")
        throw new Error(`OmaPilot stopped in ${current.state}`);
      return current.turnId !== "" && current.turnId !== before.turnId && current.state === "complete"
        ? current : undefined;
    }, 180_000, "new OmaPilot answer");
    if (completed.action !== expectedAction)
      throw new Error(`OmaPilot completed the wrong action: ${completed.action || "none"}`);
    stage("answer completed");
    const { stdout: replace } = await command("omarchy-shell", ["io.github.spencerbull.omapilot", "replaceSelection"]);
    if (replace.trim() !== "ok") throw new Error(`Replacement returned ${replace.trim() || "no response"}`);
  } else if (liveProvider === "codex" || liveProvider === "opencode" || liveProvider === "builtin") {
    const answer = await answerAndReplaceThroughBroker(liveProvider, initial, address);
    stage(`${liveProvider} answer completed: ${answer.length} characters`);
  } else {
    await replaceThroughBroker("The cat sat on the mat", address);
  }
  stage("replacement accepted");

  const finalText = await until(async () => {
    const value = await fieldValue(socket, primarySelector);
    return typeof value === "string" && value !== initial ? value : undefined;
  }, 10_000, "browser replacement");
  if (finalText === initial) throw new Error("The text action left the selected text unchanged");
  if (liveProvider !== "ui"
      || ["direct-fix", "chooser-custom"].includes(process.env.OMAPILOT_E2E_UI_ROUTE ?? "direct-fix"))
    if (/\bteh\b/iu.test(finalText)) throw new Error(`Correction still contains the original typo: ${finalText}`);

  const controls = [{ selector: primarySelector, kind: "textarea", final: finalText }];
  if (liveProvider === undefined) {
    for (const control of [
      { selector: "#f-text", kind: "text" },
      { selector: "#f-search", kind: "search" },
      { selector: "#f-editable", kind: "contenteditable" },
      { selector: "#f-controlled", kind: "controlled" },
    ]) {
      await selectField(socket, control.selector, initial);
      await command("wtype", ["-M", "ctrl", "-k", "a", "-m", "ctrl"]);
      await until(async () => (await command("wl-paste", ["--primary", "--no-newline"])).stdout === initial, 5_000, `${control.kind} primary selection`);
      await replaceThroughBroker("The cat sat on the mat", address);
      const value = await until(async () => {
        const current = await fieldValue(socket, control.selector);
        return current === "The cat sat on the mat" ? current : undefined;
      }, 5_000, `${control.kind} replacement`);
      controls.push({ ...control, final: value });
    }
  }

  const reportedAction = liveProvider === "ui"
    ? (process.env.OMAPILOT_E2E_UI_ROUTE === "chooser-translate" ? "translate"
      : process.env.OMAPILOT_E2E_UI_ROUTE === "chooser-custom" ? "custom" : "fix")
    : "fix";
  process.stdout.write(JSON.stringify({ result: "pass", app: electron ? "electron" : "chromium", action: reportedAction, initial, final: finalText, controls }) + "\n");
  socket.close();
} finally {
  if (browser?.pid !== undefined) {
    try { process.kill(-browser.pid, "SIGTERM"); } catch {}
    await Promise.race([
      browserClosed,
      new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
    ]);
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
