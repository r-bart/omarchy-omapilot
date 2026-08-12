#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { appendFile } from "node:fs/promises";

let sessionCounter = 0;
let pending;
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const server = acp.agent({ name: "quickchat-fake" })
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
    if (process.env.FAKE_ACP_FAIL_SECRET === "1") {
      process.stderr.write("provider failed for person@example.com token=top-secret sk-secret-value\n");
      throw new Error("provider failed for person@example.com token=top-secret sk-secret-value");
    }
    const controller = new AbortController();
    pending = controller;
    const decision = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: "forbidden", title: "Forbidden shell", kind: "execute" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }]
    });
    if (decision.outcome.outcome !== "cancelled") throw new Error("permission was not denied");
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "# Answer\n\nHello [link](https://example.com)." } }
    });
    if (process.env.FAKE_ACP_WAIT === "1") {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    return { stopReason: controller.signal.aborted ? "cancelled" : "end_turn" };
  })
  .onNotification(acp.methods.agent.session.cancel, () => { pending?.abort(); });

server.connect(stream);
