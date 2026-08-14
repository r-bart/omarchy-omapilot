import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopActionService } from "../src/actions.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("installed application actions", () => {
  it("resolves an exact user desktop entry without interpreting Exec", async () => {
    const root = await fixtureRoot();
    const applications = join(root, "user", "applications");
    await mkdir(applications, { recursive: true });
    await writeFile(join(applications, "Zoom.desktop"), [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Zoom",
      "Exec=sh -c 'this must never be interpreted by Quickchat'"
    ].join("\n"));
    const service = new DesktopActionService({ HOME: root, XDG_DATA_HOME: join(root, "user"), XDG_DATA_DIRS: join(root, "system"), PATH: "" });
    await expect(service.resolve("open zoom")).resolves.toEqual({
      kind: "launch",
      action: {
        kind: "launch_app",
        appName: "Zoom",
        desktopId: "Zoom.desktop",
        desktopFile: join(applications, "Zoom.desktop")
      }
    });
  });

  it("prefers the user desktop entry over a system entry with the same name", async () => {
    const root = await fixtureRoot();
    const user = join(root, "user", "applications");
    const system = join(root, "system", "applications");
    await mkdir(user, { recursive: true });
    await mkdir(system, { recursive: true });
    await writeFile(join(user, "zoom-user.desktop"), "[Desktop Entry]\nType=Application\nName=Zoom\n");
    await writeFile(join(system, "zoom-system.desktop"), "[Desktop Entry]\nType=Application\nName=Zoom\n");
    const service = new DesktopActionService({ HOME: root, XDG_DATA_HOME: join(root, "user"), XDG_DATA_DIRS: join(root, "system"), PATH: "" });
    const result = await service.resolve("launch Zoom please");
    expect(result.kind === "launch" ? result.action.desktopId : "not-found").toBe("zoom-user.desktop");
  });

  it("fails closed for missing, hidden, ambiguous, or command-shaped targets", async () => {
    const root = await fixtureRoot();
    const applications = join(root, "user", "applications");
    await mkdir(applications, { recursive: true });
    await writeFile(join(applications, "one.desktop"), "[Desktop Entry]\nType=Application\nName=Editor\n");
    await writeFile(join(applications, "two.desktop"), "[Desktop Entry]\nType=Application\nName=Editor\n");
    await writeFile(join(applications, "hidden.desktop"), "[Desktop Entry]\nType=Application\nName=Hidden\nHidden=true\n");
    await writeFile(join(applications, "unsafe.desktop"), "[Desktop Entry]\nType=Application\nName=Safe\u202eevil\n");
    const service = new DesktopActionService({ HOME: root, XDG_DATA_HOME: join(root, "user"), XDG_DATA_DIRS: join(root, "system"), PATH: "" });
    await expect(service.resolve("open Editor")).resolves.toEqual({ kind: "unresolved", appName: "Editor" });
    await expect(service.resolve("open Hidden")).resolves.toEqual({ kind: "unresolved", appName: "Hidden" });
    await expect(service.resolve("open /tmp/payload")).resolves.toEqual({ kind: "none" });
    await expect(service.resolve("open zoom and read secrets")).resolves.toEqual({ kind: "none" });
    await expect(service.resolve("How do I open Zoom?")).resolves.toEqual({ kind: "none" });
  });

  it("launches only the validated desktop id through Omarchy's detached UWSM scope", async () => {
    const root = await fixtureRoot();
    const bin = join(root, "bin");
    const audit = join(root, "uwsm-args");
    await mkdir(bin, { recursive: true });
    const uwsmApp = join(bin, "uwsm-app");
    const gtkLaunch = join(bin, "gtk-launch");
    await writeFile(uwsmApp, `#!/bin/sh\nprintf '%s\\n' "$@" > "${audit}"\n`);
    await writeFile(gtkLaunch, "#!/bin/sh\nexit 0\n");
    await Promise.all([chmod(uwsmApp, 0o755), chmod(gtkLaunch, 0o755)]);
    const service = new DesktopActionService({ HOME: root, PATH: bin });
    await expect(service.launch({
      kind: "launch_app", appName: "Zoom", desktopId: "Zoom.desktop", desktopFile: "/safe/apps/Zoom.desktop"
    })).resolves.toBe(true);
    await expect(readFile(audit, "utf8")).resolves.toBe(`--\n${gtkLaunch}\nZoom.desktop\n`);
  });

  it("uses bounded detached gio only when the Omarchy UWSM path is unavailable", async () => {
    const root = await fixtureRoot();
    const bin = join(root, "bin");
    const audit = join(root, "gio-args");
    await mkdir(bin, { recursive: true });
    const gio = join(bin, "gio");
    await writeFile(gio, `#!/bin/sh\nprintf '%s\\n' "$@" > "${audit}"\n`);
    await chmod(gio, 0o755);
    const service = new DesktopActionService({ HOME: root, PATH: bin });
    await expect(service.launch({
      kind: "launch_app", appName: "Zoom", desktopId: "Zoom.desktop", desktopFile: "/safe/apps/Zoom.desktop"
    })).resolves.toBe(true);
    await expect(readFile(audit, "utf8")).resolves.toBe("launch\n/safe/apps/Zoom.desktop\n");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "quickchat-actions-"));
  roots.push(root);
  return root;
}
