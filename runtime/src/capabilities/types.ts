import type { ToolDefinition } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.js";

export const CAPABILITY_IDS = ["email", "calendar", "files", "projects", "messages", "meetings"] as const;
export type CapabilityId = typeof CAPABILITY_IDS[number];

export type CapabilityState =
  | "ready"
  | "needs_configuration"
  | "missing_connector"
  | "needs_setup"
  | "degraded"
  | "disabled";

export type CapabilityRisk = "inspect" | "prepare" | "local_action" | "external_write" | "destructive" | "setup";

export type CapabilityOperationView = {
  id: string;
  label: string;
  risk: CapabilityRisk;
  available: boolean;
};

export type CapabilityView = {
  id: CapabilityId;
  label: string;
  description: string;
  connector: string;
  state: CapabilityState;
  status: string;
  enabled: boolean;
  operations: CapabilityOperationView[];
  configuration?: { filesRoot?: string };
  setupHint?: string;
};

export type CapabilityConfig = {
  version: 1;
  enabled: Partial<Record<CapabilityId, boolean>>;
  files: { root?: string };
};

export type CapabilityCommandResult = { stdout: string; stderr: string };
export type CapabilityCommandRunner = (
  file: string,
  args: string[],
  signal?: AbortSignal
) => Promise<CapabilityCommandResult>;

export type CapabilityRegistry = {
  views: CapabilityView[];
  tools: ToolDefinition[];
};
