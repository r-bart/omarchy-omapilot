#!/usr/bin/env node
import { connect } from "node:net";
import { join } from "node:path";

const CHROMIUM_ORIGIN = "chrome-extension://fhphgomajpimcnpfjjgfgamnlnopahmd/";
const FIREFOX_ID = "omapilot-browser-companion@spencerbull.dev";
const caller = process.argv.slice(2);
if (process.env.OMAPILOT_BROWSER_HOST_TEST !== "1"
    && !caller.includes(CHROMIUM_ORIGIN)
    && !caller.includes(FIREFOX_ID)) {
  process.stderr.write("OmaPilot browser host rejected an unknown extension caller\n");
  process.exit(1);
}

const runtimeRoot = process.env.XDG_RUNTIME_DIR?.trim()
  || join(process.env.HOME ?? "/tmp", ".cache");
const socketPath = join(runtimeRoot, "omapilot", "browser-companion.sock");
const socket = connect(socketPath);
let nativeBuffer = Buffer.alloc(0);
let socketBuffer = "";
const pending = [];

process.stdout.on("error", (error) => {
  process.exit(error?.code === "EPIPE" ? 0 : 1);
});

function writeNative(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.byteLength > 1024 * 1024) return;
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.byteLength, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function forwardNativePayload(payload) {
  let message;
  try { message = JSON.parse(payload.toString("utf8")); }
  catch { process.exit(1); }
  const line = `${JSON.stringify(message)}\n`;
  if (socket.readyState === "open") socket.write(line);
  else pending.push(line);
}

process.stdin.on("data", (chunk) => {
  nativeBuffer = Buffer.concat([nativeBuffer, chunk]);
  while (nativeBuffer.byteLength >= 4) {
    const length = nativeBuffer.readUInt32LE(0);
    if (length > 64 * 1024 * 1024) process.exit(1);
    if (nativeBuffer.byteLength < 4 + length) break;
    forwardNativePayload(nativeBuffer.subarray(4, 4 + length));
    nativeBuffer = nativeBuffer.subarray(4 + length);
  }
});

socket.setEncoding("utf8");
socket.on("connect", () => {
  for (const line of pending.splice(0)) socket.write(line);
});
socket.on("data", (chunk) => {
  socketBuffer += chunk;
  if (Buffer.byteLength(socketBuffer, "utf8") > 1_100_000) process.exit(1);
  while (true) {
    const newline = socketBuffer.indexOf("\n");
    if (newline < 0) break;
    const line = socketBuffer.slice(0, newline);
    socketBuffer = socketBuffer.slice(newline + 1);
    try { writeNative(JSON.parse(line)); } catch { process.exit(1); }
  }
});
socket.on("error", (error) => {
  process.stderr.write(`OmaPilot broker connection failed: ${error.message}\n`);
  process.exit(1);
});
socket.on("close", () => process.exit(0));
process.stdin.on("end", () => socket.end());
