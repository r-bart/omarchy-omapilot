import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { embeddedNodeExecutable } from "../launcher/embedded-node-launcher.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("embedded Node launcher", () => {
  it("is deterministic and appends the payload at the fixed offset", () => {
    const payload = Buffer.from("module.exports = 42;", "utf8");
    const first = embeddedNodeExecutable(payload, 2);
    const second = embeddedNodeExecutable(payload, 2);
    expect(first.equals(second)).toBe(true);
    expect([...first.subarray(0, 4)]).toEqual([0x7f, 0x45, 0x4c, 0x46]);
    expect(first.readUInt16LE(18)).toBe(62);
    expect(first.readUInt16LE(56)).toBe(2);
    expect(first.subarray(4096).equals(payload)).toBe(true);
  });

  it("executes with preserved arguments and an exact plugin root", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-launcher-test-"));
    roots.push(root);
    const output = join(root, "plugin", "runtime");
    await mkdir(output, { recursive: true });
    const executable = join(output, "launcher");
    const payload = Buffer.from(
      "process.stdout.write(JSON.stringify({args:process.argv.slice(2),root:process.env.OMAPILOT_PLUGIN_ROOT}));",
      "utf8"
    );
    await writeFile(executable, embeddedNodeExecutable(payload, 2));
    await chmod(executable, 0o755);

    const result = await run(executable, ["alpha", "beta"]);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({ args: ["alpha", "beta"], root: join(root, "plugin") });
  });

  it("rejects missing payloads and invalid root levels", () => {
    expect(() => embeddedNodeExecutable(Buffer.alloc(0), 2)).toThrow("embedded payload is required");
    expect(() => embeddedNodeExecutable(Buffer.from("x"), 0)).toThrow("root level count is invalid");
  });
});
