import { describe, expect, it } from "vitest";
import { readOsdEnabled, withOsdEnabled } from "../src/voxtype-osd.js";

describe("voxtype OSD switch", () => {
  it("treats an absent section or key as enabled, matching Voxtype's default", () => {
    expect(readOsdEnabled("")).toBe(true);
    expect(readOsdEnabled("[audio]\ndevice = \"default\"\n")).toBe(true);
    expect(readOsdEnabled("[osd]\nposition = \"bottom-center\"\n")).toBe(true);
  });

  it("reads an explicit value", () => {
    expect(readOsdEnabled("[osd]\nenabled = false\n")).toBe(false);
    expect(readOsdEnabled("[osd]\nenabled = true\n")).toBe(true);
    expect(readOsdEnabled("[osd]\n  enabled   =   false  \n")).toBe(false);
  });

  it("never reads a commented-out or foreign key as the value", () => {
    expect(readOsdEnabled("[osd]\n# enabled = false\n")).toBe(true);
    // `enabled` under a different table must not be mistaken for the OSD's.
    expect(readOsdEnabled("[hotkey]\nenabled = false\n\n[osd]\nposition = \"top-center\"\n")).toBe(true);
  });

  it("stops at the next table header rather than reading a later section", () => {
    const text = "[osd]\nposition = \"bottom-center\"\n\n[meeting]\nenabled = false\n";
    expect(readOsdEnabled(text)).toBe(true);
  });

  it("appends a section when none exists, without disturbing the file", () => {
    const original = "# Voxtype Configuration\nstate_file = \"auto\"\n\n[audio]\ndevice = \"default\"\n";
    const next = withOsdEnabled(original, false);
    expect(next.startsWith(original)).toBe(true);
    expect(readOsdEnabled(next)).toBe(false);
    expect(next).toContain("[osd]");
  });

  it("rewrites only the value, preserving comments and every other key", () => {
    const original = [
      "# top comment",
      "state_file = \"auto\"",
      "",
      "[osd]",
      "# which frontend to use",
      "frontend = \"gtk4\"",
      "enabled = true",
      "width_px = 400",
      "",
      "[audio]",
      "device = \"default\"",
      ""
    ].join("\n");
    const next = withOsdEnabled(original, false);
    expect(readOsdEnabled(next)).toBe(false);
    expect(next).toContain("# top comment");
    expect(next).toContain("# which frontend to use");
    expect(next).toContain("frontend = \"gtk4\"");
    expect(next).toContain("width_px = 400");
    expect(next).toContain("[audio]\ndevice = \"default\"");
    // Exactly one line changed.
    const before = original.split("\n");
    const after = next.split("\n");
    expect(after.length).toBe(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual(["enabled = false"]);
  });

  it("inserts the key into an existing section that lacks it", () => {
    const original = "[osd]\nfrontend = \"gtk4\"\n\n[audio]\ndevice = \"default\"\n";
    const next = withOsdEnabled(original, false);
    expect(readOsdEnabled(next)).toBe(false);
    expect(next).toContain("frontend = \"gtk4\"");
    expect(next).toContain("[audio]\ndevice = \"default\"");
  });

  it("round-trips both directions", () => {
    const original = "[osd]\nenabled = true\nwidth_px = 400\n";
    const off = withOsdEnabled(original, false);
    expect(readOsdEnabled(off)).toBe(false);
    const on = withOsdEnabled(off, true);
    expect(readOsdEnabled(on)).toBe(true);
    expect(on).toBe(original);
  });
});
