import { discoverCapabilitySnapshot } from "./probes.js";
import { createCapabilityTools } from "./tools.js";
import type { CapabilityRegistry } from "./types.js";

export async function createCapabilityRegistry(env: NodeJS.ProcessEnv = process.env): Promise<CapabilityRegistry> {
  const snapshot = await discoverCapabilitySnapshot(env);
  return { views: snapshot.views, tools: createCapabilityTools(snapshot) };
}

export { CapabilityConfigError, setCapabilityEnabled, setFilesRoot } from "./config.js";
export { discoverCapabilitySnapshot } from "./probes.js";
export { capabilityReviewableInput, capabilityToolAcpReadOnly, capabilityToolRisk, capabilityToolTitle, createCapabilityTools } from "./tools.js";
export type { CapabilityId, CapabilityRisk, CapabilityView } from "./types.js";
