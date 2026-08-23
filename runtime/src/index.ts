import { createInterface } from "node:readline";
import { OmaPilotBroker } from "./broker.js";
import { commandSchema, type BrokerEvent } from "./types.js";

function emit(event: BrokerEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

const broker = new OmaPilotBroker(emit);
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
    emit({ type: "error", code: "invalid_command", message: "Command did not match the OmaPilot protocol", retryable: false });
    return;
  }
  void broker.handle(parsed.data).then((keepRunning) => {
    if (!keepRunning) input.close();
  }).catch(() => emit({ type: "error", code: "broker_error", message: "OmaPilot could not complete the command", retryable: true }));
});

input.once("close", () => {
  process.exitCode = 0;
});
