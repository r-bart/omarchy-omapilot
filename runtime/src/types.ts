import { z } from "zod";

export const providerIdSchema = z.enum(["codex", "claude", "opencode"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

const contextText = (max: number) => z.string().min(1).max(max).refine(
  (value) => !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value),
  "desktop context contains control characters"
);
const desktopWindowSchema = z.object({
  appId: contextText(160).optional(),
  title: contextText(240).optional(),
  workspace: z.number().int().min(-100_000).max(100_000).optional(),
  monitor: contextText(120).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "desktop window is empty");
const desktopAppSchema = z.object({
  appId: contextText(160),
  workspaces: z.array(z.number().int().min(-100_000).max(100_000)).max(12),
  windowCount: z.number().int().min(1).max(64)
}).strict();
const desktopMediaSchema = z.object({
  player: contextText(160).optional(),
  title: contextText(240).optional(),
  artist: contextText(200).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "desktop media is empty");
export const desktopContextSchema = z.object({
  version: z.literal(1),
  activeWindow: desktopWindowSchema.optional(),
  apps: z.array(desktopAppSchema).max(12),
  workspaces: z.array(z.number().int().min(-100_000).max(100_000)).max(12),
  media: z.array(desktopMediaSchema).max(4)
}).strict().refine(
  (value) => value.activeWindow !== undefined || value.apps.length > 0 || value.workspaces.length > 0 || value.media.length > 0,
  "desktop context is empty"
);
export type DesktopContext = z.infer<typeof desktopContextSchema>;

const initializeCommand = z.object({
  type: z.literal("initialize"),
  protocolVersion: z.number().int().positive(),
  client: z.string().max(120).optional()
});
const submitCommand = z.object({
  type: z.literal("submit"),
  id: z.string().min(1).max(120),
  question: z.string().trim().min(1).max(100_000),
  provider: providerIdSchema,
  model: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().min(1).max(500).optional()),
  desktopContext: desktopContextSchema.optional()
});
const cancelCommand = z.object({ type: z.literal("cancel"), id: z.string().min(1).max(120) });
const permissionResponseCommand = z.object({
  type: z.literal("permission_response"),
  id: z.string().min(1).max(120),
  permissionId: z.string().uuid(),
  decision: z.enum(["allow_once", "reject_once"])
});
const chatCommand = z.object({ type: z.enum(["continue_in_herdr", "history_delete"]), chatId: z.string().uuid() });
const linkCommand = z.object({ type: z.literal("open_link"), url: z.string().max(8_192) });
const imageCommand = z.object({ type: z.literal("load_image"), id: z.string().min(1).max(200).optional(), url: z.string().max(8_192) });
const copyCommand = z.object({ type: z.literal("copy"), text: z.string().max(1_000_000) });

export const commandSchema = z.discriminatedUnion("type", [
  initializeCommand,
  submitCommand,
  cancelCommand,
  permissionResponseCommand,
  chatCommand,
  linkCommand,
  imageCommand,
  copyCommand,
  z.object({ type: z.enum(["dictation_start", "dictation_stop", "dictation_cancel", "history_list", "history_clear", "shutdown"]) })
]);
export type BrokerCommand = z.infer<typeof commandSchema>;

export type ModelOption = { id: string; name: string; description?: string };
export type ProviderPolicyInfo = {
  tools: "device-approval" | "sandboxed" | "blocked";
  web: "approved-command" | "search" | "blocked";
  hostReads: boolean;
};
export type ProviderInfo = {
  id: ProviderId;
  name: string;
  version?: string;
  models: ModelOption[];
  defaultModel?: string;
  policy: ProviderPolicyInfo;
};

export type StoredImage = {
  id: string;
  mimeType: string;
  path: string;
  bytes: number;
  width: number;
  height: number;
  sourceUrl?: string;
};

export type RenderableImage = StoredImage & { localUrl: string };

export type ToolPermission = {
  id: string;
  requestId: string;
  title: string;
  kind: "execute";
  authority: "device" | "sandboxed";
  detail: string;
  allowOnce: boolean;
};

export type ChatRecord = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  title: string;
  provider: ProviderId;
  model?: string;
  question: string;
  answer: string;
  images: StoredImage[];
  session: {
    acpId?: string;
    cwd?: string;
    resumable: boolean;
    resumeKind: "native" | "transcript";
  };
};

export type ChatView = Omit<ChatRecord, "images"> & { images: RenderableImage[] };

export type BrokerEvent =
  | { type: "ready"; protocolVersion: 2; features: Array<"desktop-context">; providers: ProviderInfo[]; history: ChatView[] }
  | { type: "providers"; providers: ProviderInfo[] }
  | { type: "state"; id?: string; state: "idle" | "preparing" | "streaming" | "stopping"; message?: string }
  | { type: "content"; id: string; delta: string }
  | { type: "permission"; permission: ToolPermission }
  | { type: "permission_closed"; id: string; permissionId: string; reason: "decided" | "expired" | "cancelled" }
  | { type: "image"; id: string; image: RenderableImage }
  | { type: "complete"; chat: ChatView }
  | { type: "complete"; id: string; answer: string }
  | { type: "error"; id?: string; code: string; message: string; retryable: boolean }
  | { type: "dictation"; state: "recording" | "transcribing" | "idle" | "unavailable"; text?: string; message?: string }
  | { type: "history"; history: ChatView[] }
  | { type: "herdr"; chatId: string; state: "opening" | "continued" | "unavailable" | "failed"; mode?: "native" | "transcript"; message?: string; stage?: "availability" | "launch" | "workspace" | "session" | "transcript" | "focus"; errorCode?: string }
  | { type: "link"; url: string; opened: boolean }
  | { type: "copied"; copied: boolean };
