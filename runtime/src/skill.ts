import { lstat, mkdir, realpath, stat, symlink } from "node:fs/promises";
import { isAbsolute, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type OmapilotSkillInstall = "installed" | "present";

export function bundledOmapilotSkillPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../skills/omarchy-omapilot");
}

export function managedOmapilotSkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME;
  if (home === undefined || !isAbsolute(home)) throw new Error("OmaPilot requires an absolute HOME to install its skill");
  return join(home, ".agents", "skills", "omarchy-omapilot");
}

export async function ensureOmapilotSkill(
  env: NodeJS.ProcessEnv = process.env,
  source = bundledOmapilotSkillPath()
): Promise<OmapilotSkillInstall> {
  const canonicalSource = await realpath(source);
  if (!(await stat(join(canonicalSource, "SKILL.md"))).isFile()) throw new Error("The bundled OmaPilot skill is incomplete");

  const target = managedOmapilotSkillPath(env);
  const skillsRoot = dirname(target);
  const existing = await lstat(target).catch((error: unknown) => {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  });
  if (existing !== undefined) {
    if (existing.isSymbolicLink() && await realpath(target).catch(() => undefined) === canonicalSource) return "present";
    throw new Error(`${target} already exists and is not managed by this OmaPilot installation`);
  }

  await mkdir(skillsRoot, { recursive: true, mode: 0o700 });
  try {
    await symlink(canonicalSource, target, "dir");
  } catch (error) {
    if (isErrno(error, "EEXIST") && await realpath(target).catch(() => undefined) === canonicalSource) return "present";
    throw error;
  }
  return "installed";
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
