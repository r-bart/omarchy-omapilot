import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardedTextEmitter } from "../src/acp.js";
import type { BrokerEvent } from "../src/types.js";

afterEach(() => vi.useRealTimers());

describe("guarded ACP text streaming", () => {
  it("emits a safe sub-64-character chunk on the next frame interval", async () => {
    vi.useFakeTimers();
    const events: BrokerEvent[] = [];
    const stream = new GuardedTextEmitter("short", (event) => events.push(event));

    stream.write("Short answer");
    await vi.advanceTimersByTimeAsync(31);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{ type: "content", id: "short", delta: "Short answer" }]);
  });

  it("coalesces bursty provider chunks and flushes final text immediately", async () => {
    vi.useFakeTimers();
    const events: BrokerEvent[] = [];
    const stream = new GuardedTextEmitter("burst", (event) => events.push(event));

    stream.write("one ");
    stream.write("two ");
    stream.write("three");
    await vi.advanceTimersByTimeAsync(32);
    expect(events).toEqual([{ type: "content", id: "burst", delta: "one two three" }]);

    stream.write(" final");
    stream.finish();
    expect(events.at(-1)).toEqual({ type: "content", id: "burst", delta: " final" });
    await vi.runAllTimersAsync();
    expect(events).toHaveLength(2);
  });

  it("holds a possible split tool marker and fails closed before exposing it", async () => {
    vi.useFakeTimers();
    const events: BrokerEvent[] = [];
    const stream = new GuardedTextEmitter("guarded", (event) => events.push(event));

    stream.write(`safe prefix <||${" ".repeat(128)}DS`);
    await vi.advanceTimersByTimeAsync(32);
    expect(events).toEqual([{ type: "content", id: "guarded", delta: "safe prefix " }]);
    expect(() => stream.write("ML || tool_calls>hidden")).toThrow("Provider returned raw tool-call markup");
    await vi.runAllTimersAsync();
    expect(events).toEqual([{ type: "content", id: "guarded", delta: "safe prefix " }]);
  });

  it("does not delay ordinary Markdown autolinks containing a less-than sign", async () => {
    vi.useFakeTimers();
    const events: BrokerEvent[] = [];
    const stream = new GuardedTextEmitter("link", (event) => events.push(event));

    stream.write("See <https://example.com> now.");
    await vi.advanceTimersByTimeAsync(32);
    expect(events).toEqual([{ type: "content", id: "link", delta: "See <https://example.com> now." }]);
  });

  it("bounds an indefinitely padded suspicious marker prefix", () => {
    const stream = new GuardedTextEmitter("bounded", () => undefined);
    expect(() => stream.write(`<|${" ".repeat(4_096)}`)).toThrow("Provider returned raw tool-call markup");
  });

  it("keeps discard latched against late provider chunks", async () => {
    vi.useFakeTimers();
    const events: BrokerEvent[] = [];
    const stream = new GuardedTextEmitter("cancelled", (event) => events.push(event));
    stream.write("queued");
    stream.discard();
    stream.write("late ordinary text");
    stream.finish();
    await vi.runAllTimersAsync();
    expect(events).toEqual([]);
  });

  it.each([
    "<tool_calls>",
    "</function-call>",
    "<invoke>",
    "<parameter>",
    "</｜｜DSML｜｜invoke>",
    `<｜｜${" ".repeat(96)}DSML｜｜${" ".repeat(96)}tool calls>`
  ])("rejects every delayed two-chunk split of %s before marker text is emitted", async (marker) => {
    vi.useFakeTimers();
    for (let split = 1; split < marker.length; split += 1) {
      const events: BrokerEvent[] = [];
      const stream = new GuardedTextEmitter("split", (event) => events.push(event));
      stream.write("safe ");
      await vi.advanceTimersByTimeAsync(32);
      let rejected = false;
      try {
        stream.write(marker.slice(0, split));
        await vi.advanceTimersByTimeAsync(32);
        stream.write(marker.slice(split));
      } catch (error) {
        expect(error).toMatchObject({ name: "ForbiddenToolMarkupError" });
        rejected = true;
      }
      await vi.runAllTimersAsync();
      expect(rejected).toBe(true);
      expect(events.map((event) => event.type === "content" ? event.delta : "").join(""))
        .toBe("safe ");
      vi.clearAllTimers();
    }
  });
});
