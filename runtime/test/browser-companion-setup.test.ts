import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  browserCompanionSetupStatus,
  installBrowserCompanion,
  openBrowserCompanionSettings,
  uninstallBrowserCompanion
} from "../src/browser-companion-setup.js";

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
      relayInstalled: true, setupAvailable: true,
      chromiumExtensionPath: join(root, "browser-companion/dist/chromium"),
      firefoxExtensionPath: join(root, "browser-companion/dist/firefox")
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

  it("runs only the repository-owned uninstaller", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-browser-uninstall-")); roots.push(root);
    const audit = join(root, "audit.txt");
    const installer = join(root, "scripts/install-browser-companion.sh");
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(installer, `#!/bin/sh\nprintf '%s' "$*" > "${audit}"\n`);
    await chmod(installer, 0o755);
    await expect(uninstallBrowserCompanion({ HOME: join(root, "home") }, root)).resolves.toBe(true);
    await expect(readFile(audit, "utf8")).resolves.toBe("uninstall");
  });

  it("opens the fixed browser settings target without accepting a user command", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-browser-settings-")); roots.push(root);
    const bin = join(root, "bin");
    const audit = join(root, "audit.txt");
    const firefox = join(bin, "firefox");
    await mkdir(bin, { recursive: true });
    await writeFile(firefox, `#!/bin/sh\nprintf '%s' "$1" > "${audit}"\n`);
    await chmod(firefox, 0o755);
    await expect(openBrowserCompanionSettings("firefox", {
      HOME: join(root, "home"), PATH: bin
    })).resolves.toBe(true);
    await until(async () => await readFile(audit, "utf8").catch(() => "") !== "");
    await expect(readFile(audit, "utf8")).resolves.toBe("about:debugging#/runtime/this-firefox");
  });
});

async function until(condition: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for browser settings launch");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
