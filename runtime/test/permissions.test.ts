import { describe, expect, it } from "vitest";
import { normalizeToolPermission } from "../src/permissions.js";

describe("tool permission presentation", () => {
  it("exposes only exact allow-once command requests", () => {
    const permission = normalizeToolPermission("turn-1", "11111111-1111-4111-8111-111111111111", {
      sessionId: "session",
      toolCall: { toolCallId: "tool", kind: "execute", title: "Run uname", rawInput: { command: "uname -s", cwd: "/tmp/chat", timeout: 10 } },
      options: [
        { optionId: "provider-allow", name: "Yes", kind: "allow_once" },
        { optionId: "provider-always", name: "Always", kind: "allow_always" },
        { optionId: "provider-deny", name: "No", kind: "reject_once" }
      ]
    });
    expect(permission).toEqual({
      view: {
        id: "11111111-1111-4111-8111-111111111111",
        requestId: "turn-1",
        title: "Run uname",
        kind: "execute",
        detail: '{\n  "command": "uname -s",\n  "cwd": "/tmp/chat",\n  "timeout": 10\n}',
        allowOnce: true
      },
      allowOptionId: "provider-allow",
      rejectOptionId: "provider-deny"
    });
    expect(JSON.stringify(permission)).not.toContain("provider-always");
  });

  it.each(["read", "search", "fetch", "edit", "delete", "move", "switch_mode", "other"] as const)("rejects %s before it reaches the UI", (kind) => {
    expect(normalizeToolPermission("turn-1", "11111111-1111-4111-8111-111111111111", {
      sessionId: "session",
      toolCall: { toolCallId: "tool", kind, title: "Unsafe" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }]
    })).toBeUndefined();
  });

  it("does not invent a positive decision when allow-once is absent", () => {
    expect(normalizeToolPermission("turn-1", "11111111-1111-4111-8111-111111111111", {
      sessionId: "session",
      toolCall: { toolCallId: "tool", kind: "execute", rawInput: { command: "uname -s" } },
      options: [{ optionId: "always", name: "Always", kind: "allow_always" }]
    })?.view.allowOnce).toBe(false);
  });

  it.each(["x".repeat(3_001), "echo safe\u202eevil", "echo safe\u061cevil", "echo safe\u0085evil"])("rejects oversized, controlled, or directionally ambiguous commands", (command) => {
    expect(normalizeToolPermission("turn-1", "11111111-1111-4111-8111-111111111111", {
      sessionId: "session",
      toolCall: { toolCallId: "tool", kind: "execute", rawInput: { command } },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }]
    })).toBeUndefined();
  });

  it("fails closed when the adapter omits a classifiable target", () => {
    expect(normalizeToolPermission("turn-1", "11111111-1111-4111-8111-111111111111", {
      sessionId: "session",
      toolCall: { toolCallId: "tool", kind: "execute", rawInput: { opaque: "do something" } },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }]
    })).toBeUndefined();
  });
});
