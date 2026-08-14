import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { ToolPermission } from "./types.js";

export type PendingToolPermission = {
  view: ToolPermission;
  allowOptionId?: string;
  rejectOptionId?: string;
};

export function normalizeToolPermission(
  requestId: string,
  permissionId: string,
  request: RequestPermissionRequest
): PendingToolPermission | undefined {
  const kind = request.toolCall.kind ?? "other";
  if (kind !== "execute") return undefined;

  const allowOptionId = request.options.find((option) => option.kind === "allow_once")?.optionId;
  const rejectOptionId = request.options.find((option) => option.kind === "reject_once")?.optionId;
  const title = boundedText(request.toolCall.title ?? request.toolCall.name ?? `${kind} tool`, 120);
  const detail = permissionDetail(kind, request.toolCall.rawInput);
  if (detail === undefined) return undefined;

  return {
    view: {
      id: permissionId,
      requestId,
      title: title === "" ? `${kind} tool` : title,
      kind,
      detail,
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
  if (hasUnsafeText(value)) return undefined;
  let rendered: string;
  try { rendered = JSON.stringify(value, null, 2); } catch { return undefined; }
  if (rendered.length > 3_000) return undefined;
  return rendered;
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
