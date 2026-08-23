import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageStore } from "./images.js";
import { presentImage } from "./history.js";
import { omapilotPaths, type OmaPilotPaths } from "./paths.js";
import { resolveExecutable, runBinaryCommand, runCommand } from "./process.js";
import type { ImageBlock, TextBlock } from "./context.js";
import type { ContextAttachmentSelection, ContextAttachmentView, StoredImage } from "./types.js";
import type { BrowserCapture, SemanticNode } from "./browser-companion.js";

type Rectangle = { x: number; y: number; width: number; height: number };
type TargetHint = { appId?: string | undefined; title?: string | undefined; bounds?: Rectangle | undefined };
type CaptureTarget = {
  appId?: string;
  title?: string;
  window?: Rectangle;
  monitor: Rectangle & { name?: string };
};
type WindowAtPoint = Rectangle & { appId?: string; title?: string; address?: string };
type PendingAttachment = {
  view: ContextAttachmentView;
  image: StoredImage;
  text?: string;
  element?: string;
};

export class ContextAttachmentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ContextAttachmentError";
  }
}

export class ContextAttachmentStore {
  readonly #images: ImageStore;
  readonly #paths: OmaPilotPaths;
  readonly #env: NodeJS.ProcessEnv;
  readonly #targets = new Map<string, CaptureTarget>();
  readonly #attachments = new Map<string, PendingAttachment>();

  constructor(images = new ImageStore(), paths = omapilotPaths(), env = process.env) {
    this.#images = images;
    this.#paths = paths;
    this.#env = env;
  }

  async begin(id: string, hint?: TargetHint): Promise<CaptureTarget> {
    const monitors = await this.#monitors();
    const window = hint?.bounds;
    const cursor = window === undefined ? await this.#cursorPosition() : undefined;
    const monitor = monitorFor(window, monitors) ?? monitorAtPoint(cursor, monitors)
      ?? monitors.find((value) => value.focused) ?? monitors[0];
    if (monitor === undefined) throw new ContextAttachmentError("context_monitor", "No active monitor is available for capture");
    const target: CaptureTarget = {
      ...(hint?.appId === undefined ? {} : { appId: hint.appId }),
      ...(hint?.title === undefined ? {} : { title: hint.title }),
      ...(window === undefined || !intersects(window, monitor) ? {} : { window: clampRectangle(window, monitor) }),
      monitor: { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height, ...(monitor.name === undefined ? {} : { name: monitor.name }) }
    };
    this.#targets.set(id, target);
    while (this.#targets.size > 8) {
      const oldest = this.#targets.keys().next().value;
      if (oldest === undefined) break;
      this.#targets.delete(oldest);
    }
    return target;
  }

  async #cursorPosition(): Promise<{ x: number; y: number } | undefined> {
    try {
      const hyprctl = await resolveExecutable("hyprctl", this.#env);
      if (hyprctl === undefined) return undefined;
      const result = await runCommand(hyprctl, ["-j", "cursorpos"], {
        env: this.#env, timeoutMs: 5_000, maxOutput: 64_000
      });
      if (result.code !== 0) return undefined;
      const value: unknown = JSON.parse(result.stdout);
      if (!isObject(value)) return undefined;
      const x = integer(value.x); const y = integer(value.y);
      return x === undefined || y === undefined ? undefined : { x, y };
    } catch { return undefined; }
  }

  async selectWindow(requestId: string, localAnchor: { x: number; y: number }): Promise<CaptureTarget> {
    const pending = this.#targets.get(requestId);
    if (pending === undefined) throw new ContextAttachmentError("context_expired", "That context capture has expired");
    const point = { x: pending.monitor.x + localAnchor.x, y: pending.monitor.y + localAnchor.y };
    const hyprctl = await resolveExecutable("hyprctl", this.#env);
    if (hyprctl === undefined) throw new ContextAttachmentError("context_window", "Window selection is unavailable");
    const result = await runCommand(hyprctl, ["-j", "clients"], {
      env: this.#env, timeoutMs: 5_000, maxOutput: 2_000_000
    });
    if (result.code !== 0) throw new ContextAttachmentError("context_window", "The window beneath the cursor could not be identified");
    let selected: WindowAtPoint | undefined;
    try { selected = windowAtPointFromHyprland(JSON.parse(result.stdout), point); } catch { selected = undefined; }
    if (selected === undefined) throw new ContextAttachmentError("context_window", "No capturable window is beneath the cursor");
    const target: CaptureTarget = {
      ...(selected.appId === undefined ? {} : { appId: selected.appId }),
      ...(selected.title === undefined ? {} : { title: selected.title }),
      window: clampRectangle(selected, pending.monitor),
      monitor: pending.monitor
    };
    this.#targets.set(requestId, target);
    if (selected.address !== undefined) {
      await runCommand(hyprctl, ["dispatch", "focuswindow", `address:${selected.address}`], {
        env: this.#env, timeoutMs: 5_000, maxOutput: 256_000
      });
    }
    return target;
  }

  cancel(requestId: string): void {
    this.#targets.delete(requestId);
  }

  target(requestId: string): CaptureTarget | undefined {
    return this.#targets.get(requestId);
  }

  async capture(
    requestId: string,
    mode: "window" | "region",
    localRegion?: Rectangle,
    localAnchor?: { x: number; y: number }
  ): Promise<ContextAttachmentView> {
    const target = this.#targets.get(requestId);
    this.#targets.delete(requestId);
    if (target === undefined) throw new ContextAttachmentError("context_expired", "That context capture has expired");
    const bounds = mode === "window"
      ? target.window
      : localRegion === undefined ? undefined : clampRectangle({
        x: target.monitor.x + localRegion.x,
        y: target.monitor.y + localRegion.y,
        width: localRegion.width,
        height: localRegion.height
      }, target.monitor);
    if (bounds === undefined || bounds.width < 8 || bounds.height < 8)
      throw new ContextAttachmentError("context_geometry", "Select a larger visible region to capture");
    if (sensitiveTarget(target))
      throw new ContextAttachmentError("context_sensitive", "OmaPilot will not capture a password or credential window");

    const image = await this.#captureImage(bounds);
    const anchor = localAnchor === undefined ? undefined : {
      x: target.monitor.x + localAnchor.x,
      y: target.monitor.y + localAnchor.y
    };
    // A click chooses the paragraph nearest the pointer. A drag is already an
    // explicit selection, so its release point (normally the empty lower-right
    // corner) must not narrow OCR to a single nearby word.
    const text = await this.#ocrText(image, bounds, mode === "window" ? anchor : undefined);
    const title = [target.title, target.appId]
      .map((value) => value?.trim() ?? "")
      .find((value) => value !== "") ?? (mode === "window" ? "Window capture" : "Region capture");
    const representations: ContextAttachmentView["representations"] = [];
    if (text !== undefined) representations.push({
      id: "text", kind: "text", label: "Text", preview: text.slice(0, 320), confidence: 0.72
    });
    representations.push({ id: "image", kind: "image", label: "Screenshot", confidence: 1 });
    const view: ContextAttachmentView = {
      version: 1,
      id: image.id,
      title: title.slice(0, 160),
      origin: {
        ...(target.appId === undefined ? {} : { appId: target.appId }),
        ...(target.title === undefined ? {} : { windowTitle: target.title })
      },
      previewImage: presentImage(image, this.#paths),
      representations,
      selectedRepresentationIds: text === undefined ? ["image"] : ["text"]
    };
    this.#attachments.set(view.id, { view, image, ...(text === undefined ? {} : { text }) });
    while (this.#attachments.size > 8) {
      const oldest = this.#attachments.keys().next().value;
      if (oldest === undefined) break;
      await this.discard(oldest);
    }
    return view;
  }

  async captureBrowser(requestId: string, capture: BrowserCapture): Promise<ContextAttachmentView> {
    const target = this.#targets.get(requestId);
    if (target === undefined) throw new ContextAttachmentError("context_expired", "That browser context capture has expired");
    if (target.window === undefined)
      throw new ContextAttachmentError("context_geometry", "The browser window geometry is unavailable");
    if (sensitiveTarget(target))
      throw new ContextAttachmentError("context_sensitive", "OmaPilot will not capture a password or credential window");
    if (capture.element.attributes?.type?.trim().toLowerCase() === "password") {
      this.#targets.delete(requestId);
      throw new ContextAttachmentError("context_sensitive", "OmaPilot will not capture a password field");
    }

    const image = await this.#captureImage(target.window);
    this.#targets.delete(requestId);
    const text = boundedBrowserText(capture.selection ?? capture.element.context?.text ?? capture.element.text);
    const element = semanticElementText(capture);
    const title = (capture.element.text ?? capture.element.name ?? capture.element.context?.name
      ?? capture.title ?? target.title ?? "Browser element").slice(0, 160);
    const representations: ContextAttachmentView["representations"] = [
      { id: "element", kind: "element", label: "Element", preview: elementPreview(capture), confidence: elementConfidence(capture) }
    ];
    if (text !== undefined) representations.push({
      id: "text", kind: "text", label: "Text", preview: text.slice(0, 320),
      confidence: capture.selection === undefined ? 0.86 : 1
    });
    representations.push({ id: "image", kind: "image", label: "Screenshot", confidence: imageConfidence(capture) });
    const selectedRepresentationIds: ContextAttachmentView["selectedRepresentationIds"] =
      capture.selection !== undefined ? ["text"]
        : visualElement(capture) ? ["image"]
          : elementConfidence(capture) >= 0.9 ? ["element"]
            : text === undefined ? ["image"] : ["text"];
    const view: ContextAttachmentView = {
      version: 1,
      id: image.id,
      title,
      origin: {
        ...(target.appId === undefined ? {} : { appId: target.appId }),
        windowTitle: capture.title
      },
      previewImage: presentImage(image, this.#paths),
      representations,
      selectedRepresentationIds
    };
    this.#attachments.set(view.id, {
      view, image, element,
      ...(text === undefined ? {} : { text })
    });
    while (this.#attachments.size > 8) {
      const oldest = this.#attachments.keys().next().value;
      if (oldest === undefined) break;
      await this.discard(oldest);
    }
    return view;
  }

  async resolve(selections: ContextAttachmentSelection[]): Promise<{ blocks: Array<TextBlock | ImageBlock>; attachmentIds: string[] }> {
    const blocks: Array<TextBlock | ImageBlock> = [];
    const attachmentIds: string[] = [];
    for (const selection of selections) {
      const attachment = this.#attachments.get(selection.id);
      if (attachment === undefined) throw new ContextAttachmentError("context_expired", "A selected context attachment has expired");
      const available = new Set(attachment.view.representations.map((value) => value.id));
      if (selection.representationIds.some((value) => !available.has(value)))
        throw new ContextAttachmentError("context_representation", "A selected context representation is unavailable");
      attachmentIds.push(selection.id);
      if (selection.representationIds.includes("text") && attachment.text !== undefined) {
        blocks.push({
          type: "text",
          text: [
            `CONTEXT CLIP: ${attachment.view.title}`,
            `Source application: ${attachment.view.origin.appId ?? "unknown"}`,
            "Representation: locally extracted visible text",
            attachment.text,
            "END CONTEXT CLIP"
          ].join("\n")
        });
      }
      if (selection.representationIds.includes("element") && attachment.element !== undefined) {
        blocks.push({
          type: "text",
          text: [
            `CONTEXT CLIP: ${attachment.view.title}`,
            `Source application: ${attachment.view.origin.appId ?? "browser"}`,
            "Representation: bounded semantic browser element",
            attachment.element,
            "END CONTEXT CLIP"
          ].join("\n")
        });
      }
      if (selection.representationIds.includes("image")) {
        const data = (await readFile(join(this.#paths.images, attachment.image.path))).toString("base64");
        blocks.push({ type: "image", data, mimeType: attachment.image.mimeType });
      }
    }
    return { blocks, attachmentIds };
  }

  async discard(id: string): Promise<void> {
    const attachment = this.#attachments.get(id);
    this.#attachments.delete(id);
    if (attachment !== undefined) await this.#images.remove(attachment.image);
  }

  async discardMany(ids: string[]): Promise<void> {
    await Promise.all([...new Set(ids)].map((id) => this.discard(id)));
  }

  async #monitors(): Promise<Array<Rectangle & { name?: string; focused?: boolean }>> {
    const hyprctl = await resolveExecutable("hyprctl", this.#env);
    if (hyprctl === undefined) throw new ContextAttachmentError("context_monitor", "Context capture requires Hyprland");
    const result = await runCommand(hyprctl, ["-j", "monitors"], { env: this.#env, timeoutMs: 5_000, maxOutput: 256_000 });
    if (result.code !== 0) throw new ContextAttachmentError("context_monitor", "The monitor layout could not be read");
    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch { parsed = undefined; }
    if (!Array.isArray(parsed)) throw new ContextAttachmentError("context_monitor", "The monitor layout was invalid");
    return parsed.flatMap((value) => {
      if (!isObject(value)) return [];
      const x = integer(value.x); const y = integer(value.y);
      const width = integer(value.width); const height = integer(value.height);
      const scale = typeof value.scale === "number" && value.scale > 0 ? value.scale : 1;
      if (x === undefined || y === undefined || width === undefined || height === undefined) return [];
      return [{
        x, y,
        width: Math.max(1, Math.round(width / scale)),
        height: Math.max(1, Math.round(height / scale)),
        ...(typeof value.name === "string" ? { name: value.name.slice(0, 120) } : {}),
        ...(value.focused === true ? { focused: true } : {})
      }];
    });
  }

  async #ocrText(image: StoredImage, bounds: Rectangle, anchor?: { x: number; y: number }): Promise<string | undefined> {
    try {
      const tesseract = await resolveExecutable("tesseract", this.#env);
      if (tesseract === undefined) return undefined;
      const result = await runCommand(tesseract, [join(this.#paths.images, image.path), "stdout", "tsv"], {
        env: this.#env, timeoutMs: 15_000, maxOutput: 2_000_000
      });
      if (result.code !== 0) return undefined;
      const point = anchor === undefined ? undefined : {
        x: (anchor.x - bounds.x) * image.width / bounds.width,
        y: (anchor.y - bounds.y) * image.height / bounds.height
      };
      return textAtPointFromTsv(result.stdout, point);
    } catch {
      return undefined;
    }
  }

  async #captureImage(bounds: Rectangle): Promise<StoredImage> {
    const grim = await resolveExecutable("grim", this.#env);
    if (grim === undefined) throw new ContextAttachmentError("context_capture_unavailable", "Screen capture requires grim");
    const geometry = `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`;
    const captured = await runBinaryCommand(grim, ["-g", geometry, "-t", "png", "-l", "9", "-"], {
      env: this.#env,
      timeoutMs: 15_000,
      maxOutput: 5 * 1024 * 1024
    });
    if (captured.code !== 0 || captured.stdout.byteLength === 0)
      throw new ContextAttachmentError("context_capture_failed", "The selected region could not be captured");
    return this.#images.save(captured.stdout, "image/png");
  }
}

function boundedBrowserText(value?: string): string | undefined {
  const text = value?.replaceAll(/\s+/gu, " ").trim().slice(0, 12_000);
  return text === undefined || text === "" ? undefined : text;
}

function semanticElementText(capture: BrowserCapture): string {
  const nodes = { count: 0 };
  const tree = boundedSemanticNode(capture.element.tree, 0, nodes);
  const context = capture.element.context;
  const contextTree = context === undefined ? undefined : boundedSemanticNode(context.tree, 0, { count: 0 });
  return JSON.stringify({
    page: { url: safePageUrl(capture.url), title: capture.title },
    target: {
      tag: capture.element.tag,
      ...(capture.element.role === undefined ? {} : { role: capture.element.role }),
      ...(capture.element.name === undefined ? {} : { name: capture.element.name }),
      ...(capture.element.text === undefined ? {} : { text: capture.element.text.slice(0, 12_000) }),
      ...(capture.element.attributes === undefined ? {} : { attributes: capture.element.attributes }),
      ancestors: capture.element.ancestors,
      rect: capture.element.rect,
      tree
    },
    ...(context === undefined ? {} : { context: {
      tag: context.tag,
      ...(context.role === undefined ? {} : { role: context.role }),
      ...(context.name === undefined ? {} : { name: context.name }),
      ...(context.text === undefined ? {} : { text: context.text.slice(0, 12_000) }),
      rect: context.rect,
      tree: contextTree
    } })
  }, null, 2).slice(0, 32_000);
}

function boundedSemanticNode(node: SemanticNode, depth: number, state: { count: number }): SemanticNode {
  state.count++;
  const children = depth >= 4 || state.count >= 80 ? undefined
    : node.children?.slice(0, 20).flatMap((child) => state.count >= 80 ? [] : [boundedSemanticNode(child, depth + 1, state)]);
  return {
    tag: node.tag.slice(0, 40),
    ...(node.role === undefined ? {} : { role: node.role.slice(0, 80) }),
    ...(node.name === undefined ? {} : { name: node.name.slice(0, 500) }),
    ...(node.text === undefined ? {} : { text: node.text.slice(0, 4_000) }),
    ...(node.attributes === undefined ? {} : { attributes: node.attributes }),
    ...(children === undefined || children.length === 0 ? {} : { children })
  };
}

function safePageUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "restricted";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return "restricted"; }
}

function elementPreview(capture: BrowserCapture): string {
  const identity = capture.element.text ?? capture.element.name ?? capture.element.role ?? capture.element.tag;
  const context = capture.element.context;
  const scope = context === undefined ? "" : ` · in ${context.role ?? context.tag}: ${context.name ?? context.text ?? context.tag}`;
  return `${capture.element.role ?? capture.element.tag}: ${identity}${scope}`.replaceAll(/\s+/gu, " ").slice(0, 320);
}

function elementConfidence(capture: BrowserCapture): number {
  if (capture.element.role !== undefined || /^(?:a|button|code|pre|table|tr|article|main|nav|input|select|textarea)$/u.test(capture.element.tag)) return 0.96;
  if (capture.element.name !== undefined) return 0.9;
  return 0.78;
}

function visualElement(capture: BrowserCapture): boolean {
  return /^(?:canvas|video|img|svg)$/u.test(capture.element.tag)
    && (capture.element.text?.trim() ?? "") === "";
}

function imageConfidence(capture: BrowserCapture): number {
  return visualElement(capture) ? 1 : 0.82;
}

export function textAtPointFromTsv(tsv: string, point?: { x: number; y: number }): string | undefined {
  const rows = tsv.split("\n").slice(1).flatMap((line) => {
    const fields = line.split("\t");
    if (fields.length < 12 || fields[0] !== "5") return [];
    const left = Number(fields[6]); const top = Number(fields[7]);
    const width = Number(fields[8]); const height = Number(fields[9]); const confidence = Number(fields[10]);
    const text = fields.slice(11).join("\t").trim();
    if (![left, top, width, height, confidence].every(Number.isFinite) || confidence < 35 || text === "") return [];
    return [{ page: fields[1], block: fields[2], paragraph: fields[3], line: fields[4], left, top, width, height, confidence, text }];
  });
  if (rows.length === 0) return undefined;
  if (point === undefined) return textFromRows(rows);
  let selected = rows.find((row) =>
    point.x >= row.left && point.x <= row.left + row.width && point.y >= row.top && point.y <= row.top + row.height);
  selected ??= rows.map((row) => ({
      row,
      distance: rectangleDistance(point, { x: row.left, y: row.top, width: row.width, height: row.height })
    }))
      .filter((value) => value.distance <= 36)
      .sort((left, right) => left.distance - right.distance)[0]?.row;
  if (selected === undefined) return undefined;
  const paragraph = rows.filter((row) => row.page === selected.page && row.block === selected.block && row.paragraph === selected.paragraph);
  return textFromRows(paragraph);
}

function textFromRows(rows: Array<{
  page: string | undefined;
  block: string | undefined;
  paragraph: string | undefined;
  line: string | undefined;
  text: string;
}>): string | undefined {
  const paragraphs = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    const paragraphKey = `${row.page}\u0000${row.block}\u0000${row.paragraph}`;
    const lines = paragraphs.get(paragraphKey) ?? new Map<string, string[]>();
    const lineKey = row.line ?? "";
    const words = lines.get(lineKey) ?? [];
    words.push(row.text);
    lines.set(lineKey, words);
    paragraphs.set(paragraphKey, lines);
  }
  const text = [...paragraphs.values()]
    .map((lines) => [...lines.values()].map((words) => words.join(" ")).join("\n"))
    .join("\n\n")
    .trim()
    .slice(0, 12_000);
  return text === "" ? undefined : text;
}

function monitorFor(rectangle: Rectangle | undefined, monitors: Array<Rectangle & { focused?: boolean }>): (Rectangle & { focused?: boolean; name?: string }) | undefined {
  if (rectangle === undefined) return undefined;
  const center = { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 };
  return monitors.find((monitor) => center.x >= monitor.x && center.x < monitor.x + monitor.width && center.y >= monitor.y && center.y < monitor.y + monitor.height);
}

function monitorAtPoint(point: { x: number; y: number } | undefined, monitors: Array<Rectangle & { focused?: boolean; name?: string }>): (Rectangle & { focused?: boolean; name?: string }) | undefined {
  if (point === undefined) return undefined;
  return monitors.find((monitor) => point.x >= monitor.x && point.x < monitor.x + monitor.width
    && point.y >= monitor.y && point.y < monitor.y + monitor.height);
}

function clampRectangle(value: Rectangle, container: Rectangle): Rectangle {
  const left = Math.max(value.x, container.x);
  const top = Math.max(value.y, container.y);
  const right = Math.min(value.x + value.width, container.x + container.width);
  const bottom = Math.min(value.y + value.height, container.y + container.height);
  return { x: Math.round(left), y: Math.round(top), width: Math.max(1, Math.round(right - left)), height: Math.max(1, Math.round(bottom - top)) };
}

function intersects(left: Rectangle, right: Rectangle): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function sensitiveTarget(target: CaptureTarget): boolean {
  return /(?:password|passphrase|credential|1password|bitwarden|keepass)/iu.test(`${target.appId ?? ""} ${target.title ?? ""}`);
}

export function windowBoundsFromHyprland(value: unknown, expectedAppId?: string): Rectangle | undefined {
  if (!isObject(value)) return undefined;
  const appId = typeof value.class === "string" ? value.class
    : typeof value.initialClass === "string" ? value.initialClass : "";
  if (expectedAppId !== undefined && appId.trim().toLowerCase() !== expectedAppId.trim().toLowerCase()) return undefined;
  const at = Array.isArray(value.at) ? value.at : [];
  const size = Array.isArray(value.size) ? value.size : [];
  const x = integer(at[0]); const y = integer(at[1]);
  const width = integer(size[0]); const height = integer(size[1]);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width < 1 || height < 1)
    return undefined;
  return { x, y, width, height };
}

export function windowAtPointFromHyprland(value: unknown, point: { x: number; y: number }): WindowAtPoint | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((client, index) => {
    const bounds = windowBoundsFromHyprland(client);
    if (bounds === undefined || !isObject(client) || client.mapped === false || client.hidden === true
        || point.x < bounds.x || point.x >= bounds.x + bounds.width
        || point.y < bounds.y || point.y >= bounds.y + bounds.height) return [];
    const appId = typeof client.class === "string" && client.class.trim() !== "" ? client.class.trim()
      : typeof client.initialClass === "string" && client.initialClass.trim() !== "" ? client.initialClass.trim() : undefined;
    if (/^(?:org\.omarchy\.quickshell|quickshell)$/iu.test(appId ?? "")) return [];
    const title = typeof client.title === "string" && client.title.trim() !== "" ? client.title.trim() : undefined;
    const address = typeof client.address === "string" && client.address.trim() !== "" ? client.address.trim() : undefined;
    const focus = integer(client.focusHistoryID) ?? 1_000_000;
    const floating = client.floating === true ? 1 : 0;
    const fullscreen = integer(client.fullscreen) ?? 0;
    return [{ ...bounds, ...(appId === undefined ? {} : { appId }), ...(title === undefined ? {} : { title }),
      ...(address === undefined ? {} : { address }), focus, floating, fullscreen, area: bounds.width * bounds.height, index }];
  }).sort((left, right) => right.fullscreen - left.fullscreen || right.floating - left.floating
    || left.focus - right.focus || left.area - right.area || left.index - right.index)[0];
}

function rectangleDistance(point: { x: number; y: number }, row: Rectangle): number {
  const dx = Math.max(row.x - point.x, 0, point.x - (row.x + row.width));
  const dy = Math.max(row.y - point.y, 0, point.y - (row.y + row.height));
  return Math.hypot(dx, dy);
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
