import { createInterface } from "node:readline";
import { QuickchatBroker } from "./broker.js";
import { ensureOmapilotSkill } from "./skill.js";
import { commandSchema, type BrokerEvent } from "./types.js";

function emit(event: BrokerEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main(): Promise<void> {
  try {
    await ensureOmapilotSkill();
  } catch {
    emit({
      type: "error",
      code: "skill_setup_failed",
      message: "OmaPilot could not prepare ~/.agents/skills/omarchy-omapilot; any existing path was preserved",
      retryable: false
    });
    process.exitCode = 1;
    return;
  }

  const broker = new QuickchatBroker(emit);
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

  input.on("line", (line) => {
    if (Buffer.byteLength(line, "utf8") > 1_100_000) {
      emit({ type: "error", code: "command_too_large", message: "Command exceeds the input limit", retryable: false });
      return;
    }
    let raw: unknown;
    try { raw = JSON.parse(line); }
    catch { emit({ type: "error", code: "invalid_json", message: "Expected one JSON command per line", retryable: false }); return; }
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) {
      emit({ type: "error", code: "invalid_command", message: "Command did not match the Quickchat protocol", retryable: false });
      return;
    }
    void broker.handle(parsed.data).then((keepRunning) => {
      if (!keepRunning) input.close();
    }).catch(() => emit({ type: "error", code: "broker_error", message: "Quickchat could not complete the command", retryable: true }));
  });

  input.once("close", () => {
    process.exitCode = 0;
  });
}

void main().catch(() => {
  emit({ type: "error", code: "broker_error", message: "Quickchat could not start", retryable: true });
  process.exitCode = 1;
});
