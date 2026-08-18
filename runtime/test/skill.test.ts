import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureOmapilotSkill } from "../src/skill.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("OmaPilot skill installation", () => {
  it("installs one shared skill link and is idempotent", async () => {
    const root = await fixture();
    const source = join(root, "source");
    const home = join(root, "home");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "# OmaPilot\n");

    await expect(ensureOmapilotSkill({ HOME: home }, source)).resolves.toBe("installed");
    const target = join(home, ".agents", "skills", "omarchy-omapilot");
    expect((await lstat(target)).isSymbolicLink()).toBe(true);
    expect(await readlink(target)).toBe(await realpath(source));
    await expect(readFile(join(target, "SKILL.md"), "utf8")).resolves.toBe("# OmaPilot\n");
    await expect(ensureOmapilotSkill({ HOME: home }, source)).resolves.toBe("present");
  });

  it("preserves an existing skill path instead of overwriting it", async () => {
    const root = await fixture();
    const source = join(root, "source");
    const target = join(root, "home", ".agents", "skills", "omarchy-omapilot");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "# Bundled\n");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "# User-owned\n");

    await expect(ensureOmapilotSkill({ HOME: join(root, "home") }, source)).rejects.toThrow("already exists");
    await expect(readFile(join(target, "SKILL.md"), "utf8")).resolves.toBe("# User-owned\n");
  });

  it("rejects a missing or relative HOME", async () => {
    const root = await fixture();
    await mkdir(join(root, "source"), { recursive: true });
    await writeFile(join(root, "source", "SKILL.md"), "# OmaPilot\n");
    await expect(ensureOmapilotSkill({}, join(root, "source"))).rejects.toThrow("absolute HOME");
    await expect(ensureOmapilotSkill({ HOME: "relative" }, join(root, "source"))).rejects.toThrow("absolute HOME");
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omapilot-skill-"));
  roots.push(root);
  return root;
}
