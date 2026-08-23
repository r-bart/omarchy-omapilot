import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextAttachmentStore, textAtPointFromTsv, windowAtPointFromHyprland, windowBoundsFromHyprland } from "../src/context-attachments.js";
import { promptWithContextAttachments } from "../src/context.js";
import { ImageStore } from "../src/images.js";
import { omapilotPaths } from "../src/paths.js";
import { commandSchema } from "../src/types.js";

const header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("explicit context attachments", () => {
  it("recovers focused window geometry when Quickshell omits it", () => {
    const active = { class: "chromium-browser", at: [807, 38], size: [781, 950] };
    expect(windowBoundsFromHyprland(active, "chromium-browser")).toEqual({ x: 807, y: 38, width: 781, height: 950 });
    expect(windowBoundsFromHyprland(active, "firefox")).toBeUndefined();
  });

  it("selects the window beneath the committed cursor instead of the active window", () => {
    const clients = [
      { address: "0xterminal", class: "kitty", title: "Terminal", at: [0, 0], size: [900, 900], mapped: true, focusHistoryID: 0 },
      { address: "0xbrowser", class: "chromium-browser", title: "Docs - Chromium", at: [900, 0], size: [900, 900], mapped: true, focusHistoryID: 8 },
      { address: "0xshell", class: "org.omarchy.quickshell", title: "OmaPilot", at: [900, 0], size: [900, 400], mapped: true, floating: true }
    ];
    expect(windowAtPointFromHyprland(clients, { x: 1200, y: 500 })).toMatchObject({
      address: "0xbrowser", appId: "chromium-browser", title: "Docs - Chromium", x: 900, width: 900
    });
    expect(windowAtPointFromHyprland(clients, { x: 400, y: 500 })).toMatchObject({ address: "0xterminal" });
  });

  it("selects the OCR paragraph beneath the pointer instead of unrelated visible text", () => {
    const tsv = [
      header,
      "5\t1\t1\t1\t1\t1\t10\t10\t45\t18\t93\tNavigation",
      "5\t1\t2\t1\t1\t1\t100\t100\t35\t18\t95\tMagic",
      "5\t1\t2\t1\t1\t2\t140\t100\t45\t18\t94\tcursor",
      "5\t1\t2\t1\t2\t1\t100\t124\t55\t18\t91\tcontext",
      "5\t1\t2\t1\t2\t2\t160\t124\t42\t18\t92\tclip"
    ].join("\n");
    expect(textAtPointFromTsv(tsv, { x: 150, y: 108 })).toBe("Magic cursor\ncontext clip");
  });

  it("omits low-confidence OCR and accepts a nearby pointer miss", () => {
    const tsv = [
      header,
      "5\t1\t1\t1\t1\t1\t20\t20\t40\t18\t12\tNoise",
      "5\t1\t2\t1\t1\t1\t100\t100\t60\t18\t88\tReadable"
    ].join("\n");
    expect(textAtPointFromTsv(tsv, { x: 170, y: 108 })).toBe("Readable");
    expect(textAtPointFromTsv(tsv, { x: 400, y: 400 })).toBeUndefined();
  });

  it("extracts all readable text when the user explicitly drags a region", () => {
    const tsv = [
      header,
      "5\t1\t1\t1\t1\t1\t10\t10\t45\t18\t93\tFirst",
      "5\t1\t1\t1\t1\t2\t60\t10\t45\t18\t92\tparagraph",
      "5\t1\t2\t1\t1\t1\t10\t80\t55\t18\t94\tSecond",
      "5\t1\t2\t1\t1\t2\t70\t80\t55\t18\t91\tparagraph"
    ].join("\n");
    expect(textAtPointFromTsv(tsv)).toBe("First paragraph\n\nSecond paragraph");
  });

  it("places explicit clip blocks before the authoritative request", () => {
    const prompt = promptWithContextAttachments("Explain this", undefined, [
      { type: "text", text: "CONTEXT CLIP: visible text" },
      { type: "image", data: "AAAA", mimeType: "image/png" }
    ]);
    expect(prompt).toEqual([
      { type: "text", text: expect.stringContaining("untrusted observational data") },
      { type: "text", text: "CONTEXT CLIP: visible text" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "text", text: "Explain this" }
    ]);
  });

  it("validates opaque attachment choices and bounded capture geometry", () => {
    const attachmentId = "11111111-1111-4111-8111-111111111111";
    expect(commandSchema.safeParse({
      type: "submit", id: "turn", question: "Explain", provider: "codex",
      contextAttachments: [{ id: attachmentId, representationIds: ["text", "image"] }]
    }).success).toBe(true);
    expect(commandSchema.safeParse({
      type: "submit", id: "turn", question: "Explain", provider: "codex",
      contextAttachments: [{ id: attachmentId, representationIds: ["html"] }]
    }).success).toBe(false);
    expect(commandSchema.safeParse({
      type: "context_capture", id: "capture", mode: "region",
      region: { x: 0, y: 0, width: 12_000, height: 12_000 }
    }).success).toBe(false);
  });

  it("captures, normalizes, resolves, and deletes an attachment behind its opaque id", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-context-")); roots.push(root);
    const fixtureRoot = resolve("runtime/test/fixtures");
    const env = {
      ...process.env,
      HOME: root,
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_STATE_HOME: join(root, "state"),
      XDG_RUNTIME_DIR: join(root, "run"),
      PATH: `${join(fixtureRoot, "context-bin")}:${join(fixtureRoot, "image-bin")}:${process.env.PATH ?? ""}`
    };
    const paths = omapilotPaths(env);
    const images = new ImageStore(paths, env);
    const store = new ContextAttachmentStore(images, paths, env);
    const target = await store.begin("capture-1", {
      appId: "chromium",
      title: "Documentation",
      bounds: { x: 100, y: 80, width: 800, height: 600 }
    });
    expect(target.window).toEqual({ x: 100, y: 80, width: 800, height: 600 });
    const attachment = await store.capture("capture-1", "window", undefined, { x: 100, y: 80 });
    expect(attachment.representations.map((value) => value.id)).toEqual(["text", "image"]);
    expect(attachment.selectedRepresentationIds).toEqual(["text"]);
    const resolved = await store.resolve([{ id: attachment.id, representationIds: ["text", "image"] }]);
    expect(resolved.blocks[0]).toMatchObject({ type: "text", text: expect.stringContaining("Captured context") });
    expect(resolved.blocks[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(await readFile(join(paths.images, `${attachment.id}.png`))).toBeInstanceOf(Buffer);
    await store.discard(attachment.id);
    await expect(readFile(join(paths.images, `${attachment.id}.png`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("turns an explicit browser pick into bounded element, text, and image choices", async () => {
    const root = await mkdtemp(join(tmpdir(), "omapilot-browser-context-")); roots.push(root);
    const fixtureRoot = resolve("runtime/test/fixtures");
    const env = {
      ...process.env,
      HOME: root,
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_STATE_HOME: join(root, "state"),
      XDG_RUNTIME_DIR: join(root, "run"),
      PATH: `${join(fixtureRoot, "context-bin")}:${join(fixtureRoot, "image-bin")}:${process.env.PATH ?? ""}`
    };
    const paths = omapilotPaths(env);
    const images = new ImageStore(paths, env);
    const store = new ContextAttachmentStore(images, paths, env);
    await store.begin("browser-1", {
      appId: "chromium", title: "Deployments - Chromium",
      bounds: { x: 100, y: 80, width: 800, height: 600 }
    });
    const attachment = await store.captureBrowser("browser-1", {
      version: 1, type: "capture.result", requestId: "browser-1",
      title: "Deployments", url: "https://example.test/deployments?token=secret",
      element: {
        tag: "button", role: "button", name: "Retry failed deployment", text: "Retry",
        ancestors: [{ tag: "main", role: "main" }],
        rect: { x: 50, y: 90, width: 120, height: 36 },
        tree: { tag: "button", role: "button", name: "Retry failed deployment", text: "Retry" },
        context: {
          tag: "article", role: "article", name: "Semantic clipping works",
          text: "Semantic clipping works This paragraph is exact browser text and should not require OCR. Retry",
          rect: { x: 20, y: 30, width: 700, height: 400 },
          tree: {
            tag: "article", role: "article", name: "Semantic clipping works",
            children: [
              { tag: "h1", name: "Semantic clipping works", text: "Semantic clipping works" },
              { tag: "p", name: "This paragraph is exact browser text and should not require OCR.", text: "This paragraph is exact browser text and should not require OCR." },
              { tag: "button", role: "button", name: "Retry failed deployment", text: "Retry" }
            ]
          }
        }
      }
    });
    expect(attachment.title).toBe("Retry");
    expect(attachment.representations[0]?.preview).toContain("in article: Semantic clipping works");
    expect(attachment.representations[1]?.preview).toContain("This paragraph is exact browser text");
    expect(attachment.representations.map((value) => value.id)).toEqual(["element", "text", "image"]);
    expect(attachment.selectedRepresentationIds).toEqual(["element"]);
    const resolved = await store.resolve([{ id: attachment.id, representationIds: ["element", "image"] }]);
    expect(resolved.blocks[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining('"name": "Retry failed deployment"')
    });
    expect(resolved.blocks[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining('"name": "Semantic clipping works"')
    });
    expect(resolved.blocks[0]).not.toMatchObject({ text: expect.stringContaining("token=secret") });
    expect(resolved.blocks[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  });
});
