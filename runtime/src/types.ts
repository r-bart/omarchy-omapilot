import { z } from "zod";

export const providerIdSchema = z.enum(["codex", "claude", "opencode"]);
export type ProviderId = z.infer<typeof providerIdSchema>;
export const capabilitySchema = z.enum(["answer", "web", "tools"]);
export type Capability = z.infer<typeof capabilitySchema>;

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
  capability: capabilitySchema.default("answer")
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
export type ProviderInfo = {
  id: ProviderId;
  name: string;
  version?: string;
  models: ModelOption[];
  defaultModel?: string;
  capabilities: Capability[];
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
  kind: "execute" | "local_action";
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
  capability: Capability;
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
  | { type: "ready"; protocolVersion: 1; providers: ProviderInfo[]; history: ChatView[] }
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
