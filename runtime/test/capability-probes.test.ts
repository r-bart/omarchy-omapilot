import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setCapabilityEnabled, setFilesRoot } from "../src/capabilities/config.js";
import { discoverCapabilitySnapshot } from "../src/capabilities/probes.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function executable(path: string, script: string): Promise<void> {
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
}

describe("capability discovery", () => {
  it("reports truthful connector readiness without reading domain data", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-capability-probes-"));
    roots.push(root);
    const home = join(root, "home");
    const bin = join(root, "bin");
    const files = join(home, "Dropbox");
    await Promise.all([
      mkdir(bin, { recursive: true }),
      mkdir(files, { recursive: true }),
      mkdir(join(home, ".local/share/applications"), { recursive: true })
    ]);
    await executable(join(bin, "hey"), "printf '%s\\n' '{\"ok\":true,\"data\":{\"authenticated\":true}}'");
    await executable(join(bin, "basecamp"), "test \"$1\" = doctor && printf '%s\\n' '{\"ok\":true}'");
    await executable(join(bin, "omarchy"), "exit 0");
    await writeFile(join(home, ".local/share/applications/Zoom.desktop"), "[Desktop Entry]\nType=Application\nName=Zoom\n");
    const env: NodeJS.ProcessEnv = { HOME: home, PATH: bin, XDG_CONFIG_HOME: join(root, "config") };
    setFilesRoot(files, env);
    setCapabilityEnabled("calendar", false, env);

    const snapshot = await discoverCapabilitySnapshot(env);
    expect(snapshot.views.map((view) => [view.id, view.state])).toEqual([
      ["email", "ready"],
      ["calendar", "disabled"],
      ["files", "ready"],
      ["projects", "ready"],
      ["messages", "needs_setup"],
      ["meetings", "ready"]
    ]);
    expect(snapshot).toMatchObject({ heyPath: join(bin, "hey"), basecampPath: join(bin, "basecamp"), filesRoot: files, omarchyPath: join(bin, "omarchy") });
    expect(snapshot).not.toHaveProperty("signalEndpoint");
  });
});
