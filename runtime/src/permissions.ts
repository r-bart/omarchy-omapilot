import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { ProviderId, ToolPermission } from "./types.js";

export type PendingToolPermission = {
  view: ToolPermission;
  allowOptionId?: string;
  rejectOptionId?: string;
};

export function normalizeToolPermission(
  requestId: string,
  permissionId: string,
  provider: ProviderId,
  request: RequestPermissionRequest
): PendingToolPermission | undefined {
  const kind = request.toolCall.kind ?? "other";
  if (kind !== "execute") return undefined;

  const rejectOptionId = request.options.find((option) => option.kind === "reject_once")?.optionId;
  const title = boundedText(request.toolCall.title ?? request.toolCall.name ?? `${kind} tool`, 120);
  const detail = permissionDetail(kind, request.toolCall.rawInput);
  const reviewable = detail !== undefined;
  const allowOptionId = reviewable
    ? request.options.find((option) => option.kind === "allow_once")?.optionId
    : undefined;

  return {
    view: {
      id: permissionId,
      requestId,
      title: reviewable ? (title === "" ? `${kind} tool` : title) : "Command blocked",
      kind,
      authority: provider === "claude" ? "sandboxed" : "device",
      detail: detail ?? "Quickchat blocked this command because its complete contents cannot be displayed safely.",
      allowOnce: allowOptionId !== undefined
    },
    ...(allowOptionId === undefined ? {} : { allowOptionId }),
    ...(rejectOptionId === undefined ? {} : { rejectOptionId })
  };
}

function permissionDetail(
  kind: "execute",
  rawInput: unknown
): string | undefined {
  return exactInput(kind, rawInput);
}

function exactInput(kind: "execute", value: unknown): string | undefined {
  if (kind !== "execute" || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.command !== "string" || source.command === "") return undefined;
  if (hasUnsafeCommandText(source.command)) return undefined;
  const remaining = { ...source, command: "" };
  if (hasUnsafeText(remaining)) return undefined;
  let rendered: string;
  try { rendered = JSON.stringify(value, null, 2); } catch { return undefined; }
  if (rendered.length > 3_000) return undefined;
  return rendered;
}

function hasUnsafeCommandText(value: string): boolean {
  return /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function hasUnsafeText(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasUnsafeText(item, seen));
  return Object.entries(value).some(([key, item]) => hasUnsafeText(key, seen) || hasUnsafeText(item, seen));
}

function boundedText(value: string, limit: number): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ").trim().slice(0, limit);
}
