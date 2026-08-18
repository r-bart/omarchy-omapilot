import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browserCompanionSetupStatus, installBrowserCompanion } from "../src/browser-companion-setup.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("browser companion setup", () => {
  it("reports installer and relay readiness from user-owned paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-browser-setup-")); roots.push(root);
    const home = join(root, "home");
    const data = join(root, "data");
    const installer = join(root, "scripts/install-browser-companion.sh");
    const relay = join(data, "omapilot/browser-companion/omapilot-browser-companion-host");
    await mkdir(join(root, "scripts"), { recursive: true });
    await mkdir(join(data, "omapilot/browser-companion"), { recursive: true });
    await writeFile(installer, "#!/bin/sh\nexit 0\n");
    await writeFile(relay, "#!/bin/sh\nexit 0\n");
    await chmod(installer, 0o755); await chmod(relay, 0o755);
    await expect(browserCompanionSetupStatus({ HOME: home, XDG_DATA_HOME: data }, root)).resolves.toEqual({
      relayInstalled: true, setupAvailable: true
    });
  });

  it("runs only the repository-owned explicit installer", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-browser-install-")); roots.push(root);
    const audit = join(root, "audit.txt");
    const installer = join(root, "scripts/install-browser-companion.sh");
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(installer, `#!/bin/sh\nprintf '%s' "$*" > "${audit}"\n`);
    await chmod(installer, 0o755);
    await expect(installBrowserCompanion({ HOME: join(root, "home") }, root)).resolves.toBe(true);
    await expect(readFile(audit, "utf8")).resolves.toBe("install --development --no-build");
  });
});
