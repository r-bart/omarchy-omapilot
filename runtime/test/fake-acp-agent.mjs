#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { appendFile } from "node:fs/promises";

let sessionCounter = 0;
let pending;
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const server = acp.agent({ name: "omapilot-fake" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: process.env.FAKE_ACP_NO_DELETE === "1" ? { close: {} } : { delete: {}, close: {} }
    }
  }))
  .onRequest(acp.methods.agent.session.new, () => ({
    sessionId: `fake-${++sessionCounter}`,
    modes: { currentModeId: "read-only", availableModes: [{ id: "read-only", name: "Read only" }] },
    configOptions: [{
      type: "select", id: "model", name: "Model", category: "model", currentValue: "test/default",
      options: [{ value: "test/default", name: "Default" }, { value: "test/fast", name: "Fast" }]
    }]
  }))
  .onRequest(acp.methods.agent.session.setMode, () => ({}))
  .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => ({ configOptions: [{
    type: "select", id: "model", name: "Model", category: "model", currentValue: String(params.value), options: []
  }] }))
  .onRequest(acp.methods.agent.session.delete, async ({ params }) => {
    if (process.env.FAKE_ACP_AUDIT_FILE) await appendFile(process.env.FAKE_ACP_AUDIT_FILE, `delete:${params.sessionId}\n`);
    return {};
  })
  .onRequest(acp.methods.agent.session.close, async ({ params }) => {
    if (process.env.FAKE_ACP_AUDIT_FILE) await appendFile(process.env.FAKE_ACP_AUDIT_FILE, `close:${params.sessionId}\n`);
    return {};
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    if (process.env.FAKE_ACP_PROMPT_AUDIT) await appendFile(process.env.FAKE_ACP_PROMPT_AUDIT, "prompt\n");
    if (process.env.FAKE_ACP_PROMPT_CAPTURE) await appendFile(process.env.FAKE_ACP_PROMPT_CAPTURE, `${JSON.stringify(params.prompt)}\n`);
    if (process.env.FAKE_ACP_FAIL_SECRET === "1") {
      process.stderr.write("provider failed for person@example.com token=top-secret sk-secret-value\n");
      throw new Error("provider failed for person@example.com token=top-secret sk-secret-value");
    }
    const controller = new AbortController();
    pending = controller;
    if (process.env.FAKE_ACP_PERMISSION_ATTEMPT === "1") {
      const permissionKind = process.env.FAKE_ACP_PERMISSION_KIND || "execute";
      const permissionOptions = process.env.FAKE_ACP_PERMISSION_NO_ALLOW === "1"
        ? [{ optionId: "deny", name: "Deny", kind: "reject_once" }]
        : [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" }
          ];
      const decision = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: "permission-test",
          title: "Run a read-only command",
          kind: permissionKind,
          rawInput: process.env.FAKE_ACP_PERMISSION_UNREVIEWABLE === "1"
            ? { opaque: "hidden" } : { command: "uname -s" }
        },
        options: permissionOptions
      });
      const allowed = decision.outcome.outcome === "selected" && decision.outcome.optionId === "allow";
      if ((process.env.FAKE_ACP_EXPECT_ALLOW === "1") !== allowed) throw new Error("permission decision did not match the fixture");
    }
    const answer = process.env.FAKE_ACP_RAW_TOOL_MARKUP === "1"
      ? '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="Bash">\n<｜｜DSML｜｜parameter name="command" string="true">cat /etc/hostname</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>'
      : "# Answer\n\nHello [link](https://example.com).";
    const configuredChunks = process.env.FAKE_ACP_STREAM_CHUNKS === undefined
      ? undefined
      : JSON.parse(process.env.FAKE_ACP_STREAM_CHUNKS);
    const chunks = Array.isArray(configuredChunks) && configuredChunks.every((chunk) => typeof chunk === "string")
      ? configuredChunks
      : process.env.FAKE_ACP_RAW_TOOL_MARKUP === "1"
        ? [answer.slice(0, 5), answer.slice(5, 14), answer.slice(14)]
        : [answer];
    const chunkDelay = Number(process.env.FAKE_ACP_CHUNK_DELAY_MS ?? 0);
    for (const text of chunks) {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } }
      });
      if (Number.isFinite(chunkDelay) && chunkDelay > 0)
        await new Promise((resolve) => setTimeout(resolve, chunkDelay));
    }
    if (process.env.FAKE_ACP_CHUNK_AUDIT) await appendFile(process.env.FAKE_ACP_CHUNK_AUDIT, "chunks\n");
    if (process.env.FAKE_ACP_WAIT === "1") {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    if (controller.signal.aborted && process.env.FAKE_ACP_LATE_AFTER_CANCEL === "1") {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "late ordinary text" } }
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    return { stopReason: controller.signal.aborted ? "cancelled" : "end_turn" };
  })
  .onNotification(acp.methods.agent.session.cancel, () => { pending?.abort(); });

server.connect(stream);
