import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CapabilityConfigError,
  capabilityConfigPath,
  normalizeFilesRoot,
  readCapabilityConfig,
  setCapabilityEnabled,
  setFilesRoot
} from "../src/capabilities/config.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(): Promise<{ root: string; home: string; files: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(join(tmpdir(), "omapilot-capability-config-"));
  roots.push(root);
  const home = join(root, "home");
  const files = join(home, "Dropbox");
  await mkdir(files, { recursive: true });
  return { root, home, files, env: { HOME: home, XDG_CONFIG_HOME: join(root, "config") } };
}

describe("capability configuration", () => {
  it("persists only typed capability switches and one canonical files root", async () => {
    const setup = await fixture();
    expect(readCapabilityConfig(setup.env)).toEqual({ version: 1, enabled: {}, files: {} });
    setCapabilityEnabled("email", false, setup.env);
    setFilesRoot(setup.files, setup.env);
    expect(readCapabilityConfig(setup.env)).toEqual({
      version: 1,
      enabled: { email: false },
      files: { root: setup.files }
    });
    expect((await stat(capabilityConfigPath(setup.env))).mode & 0o777).toBe(0o600);
  });

  it("rejects broad, relative, missing, and malformed roots", async () => {
    const setup = await fixture();
    expect(() => normalizeFilesRoot(setup.home, setup.env)).toThrow(CapabilityConfigError);
    expect(() => normalizeFilesRoot("relative", setup.env)).toThrow(/absolute folder/u);
    expect(() => normalizeFilesRoot(join(setup.home, "missing"), setup.env)).toThrow(/existing readable folder/u);
    expect(normalizeFilesRoot("", setup.env)).toBeUndefined();
  });

  it("fails closed on a malformed or oversized config", async () => {
    const setup = await fixture();
    const path = capabilityConfigPath(setup.env);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "not json");
    try { readCapabilityConfig(setup.env); throw new Error("expected malformed config to fail"); }
    catch (error) { expect(error).toMatchObject({ code: "capability_config_invalid" }); }
    await writeFile(path, "x".repeat(128 * 1024 + 1));
    try { readCapabilityConfig(setup.env); throw new Error("expected oversized config to fail"); }
    catch (error) { expect(error).toMatchObject({ code: "capability_config_too_large" }); }
    expect((await readFile(path)).byteLength).toBeGreaterThan(128 * 1024);
  });

  it("revalidates a manually edited files root before exposing it", async () => {
    const setup = await fixture();
    const path = capabilityConfigPath(setup.env);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, enabled: {}, files: { root: "/" } }));
    try { readCapabilityConfig(setup.env); throw new Error("expected a broad stored root to fail"); }
    catch (error) { expect(error).toMatchObject({ code: "files_root_too_broad" }); }
  });
});
