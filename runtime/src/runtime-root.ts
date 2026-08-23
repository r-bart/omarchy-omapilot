import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function pluginRoot(moduleUrl: string | undefined): string {
  const configured = process.env.OMAPILOT_PLUGIN_ROOT?.trim();
  if (configured?.startsWith("/")) return resolve(configured);
  if (moduleUrl === undefined) throw new Error("OmaPilot runtime root is unavailable");
  return resolve(dirname(fileURLToPath(moduleUrl)), "../..");
}
