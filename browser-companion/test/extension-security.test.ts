import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const extensionRoot = new URL("../extension/", import.meta.url);

describe("browser companion extension security", () => {
  it("keeps capture arm and result bound to the tab that answered the probe", async () => {
    const source = await readFile(new URL("background.js", extensionRoot), "utf8");
    const nativeMessages: Record<string, unknown>[] = [];
    const pickerMessages: Array<{ tabId: number; message: Record<string, unknown> }> = [];
    const runtimeListeners: Array<(message: Record<string, unknown>, sender?: Record<string, unknown>) => unknown> = [];
    let nativeListener: ((message: Record<string, unknown>) => unknown) | undefined;
    let activeTabId = 11;
    const nativePort = {
      onMessage: { addListener(listener: typeof nativeListener) { nativeListener = listener; } },
      onDisconnect: { addListener() {} },
      postMessage(message: Record<string, unknown>) { nativeMessages.push(message); }
    };
    const api = {
      runtime: {
        getManifest: () => ({ version: "0.1.0" }),
        connectNative: () => nativePort,
        onMessage: { addListener(listener: (message: Record<string, unknown>, sender?: Record<string, unknown>) => unknown) { runtimeListeners.push(listener); } },
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} }
      },
      tabs: {
        query: async () => [{ id: activeTabId, url: `https://example.test/tab-${activeTabId}` }],
        sendMessage: async (tabId: number, message: Record<string, unknown>) => {
          pickerMessages.push({ tabId, message });
          if (message.type === "probe") return { available: true, title: "Selected", url: "https://example.test/selected" };
          return { armed: true };
        }
      },
      scripting: { unregisterContentScripts: async () => undefined, registerContentScripts: async () => undefined, executeScript: async () => undefined },
      storage: { local: { get: async () => ({}), set: async () => undefined } },
      permissions: { onAdded: { addListener() {} }, contains: async () => false }
    };
    runInNewContext(source, {
      browser: api, navigator: { userAgent: "Chromium/140" }, crypto: webcrypto,
      TextEncoder, URL, setTimeout, clearTimeout
    });
    expect(nativeListener).toBeTypeOf("function");

    await nativeListener?.({ version: 1, type: "probe", requestId: "bound-request" });
    activeTabId = 22;
    await nativeListener?.({ version: 1, type: "capture.arm", requestId: "bound-request" });
    expect(pickerMessages.at(-1)).toMatchObject({ tabId: 11, message: { type: "capture.arm" } });

    const forged = await dispatchRuntime(runtimeListeners, {
      version: 1, type: "picker.result", requestId: "bound-request",
      title: "Selected", url: "https://example.test/selected", element: {}
    }, { tab: { id: 22 }, frameId: 0 });
    expect(forged).toEqual({ accepted: false });
    expect(nativeMessages.some((message) => message.type === "capture.result")).toBe(false);

    const accepted = await dispatchRuntime(runtimeListeners, {
      version: 1, type: "picker.result", requestId: "bound-request",
      title: "Selected", url: "https://example.test/selected", element: {}
    }, { tab: { id: 11 }, frameId: 0 });
    expect(accepted).toEqual({ accepted: true });
    expect(nativeMessages.some((message) => message.type === "capture.result")).toBe(true);
  });

  it("redacts editable names, descendants, and selected text before capture", async () => {
    const source = await readFile(new URL("picker.js", extensionRoot), "utf8");
    const runtimeListeners: Array<(message: Record<string, unknown>) => unknown> = [];
    const pageMessages: Record<string, unknown>[] = [];
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();

    class FakeElement {
      tagName: string;
      innerText: string;
      textContent: string;
      children: FakeElement[] = [];
      parentElement?: FakeElement;
      style: Record<string, string> = {};
      attributes: Record<string, string>;
      constructor(tagName: string, text = "", attributes: Record<string, string> = {}) {
        this.tagName = tagName.toUpperCase(); this.innerText = text; this.textContent = text; this.attributes = attributes;
      }
      get childElementCount(): number { return this.children.length; }
      append(...children: FakeElement[]): void { for (const child of children) { child.parentElement = this; this.children.push(child); } }
      remove(): void {}
      getAttribute(name: string): string | undefined { return this.attributes[name]; }
      matches(selector: string): boolean {
        if (!selector.includes("input") || !selector.includes("contenteditable")) return false;
        return this.tagName === "INPUT" || this.tagName === "TEXTAREA" || this.tagName === "SELECT"
          || (this.attributes.contenteditable !== undefined && this.attributes.contenteditable !== "false");
      }
      closest(selector: string): FakeElement | undefined {
        if (selector.includes("input") && selector.includes("contenteditable")) {
          for (let current: FakeElement | undefined = this; current; current = current.parentElement)
            if (current.matches(selector)) return current;
          return undefined;
        }
        if (selector.startsWith("a,button") || selector.startsWith("article,") || selector.startsWith("main,")) return undefined;
        return undefined;
      }
      querySelector(selector: string): FakeElement | undefined {
        for (const child of this.children) {
          if (child.matches(selector)) return child;
          const nested = child.querySelector(selector); if (nested) return nested;
        }
        return undefined;
      }
      getBoundingClientRect(): Record<string, number> { return { x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 80, width: 200, height: 60 }; }
    }

    const secret = "private editable value";
    const editable = new FakeElement("div", secret, { contenteditable: "true", "aria-label": secret });
    const container = new FakeElement("section", `Public heading ${secret}`, {
      "aria-label": secret, "aria-description": secret, title: secret
    });
    container.append(editable);
    const documentElement = new FakeElement("html");
    const document = {
      title: "Fixture", body: container, documentElement,
      createElement: (tag: string) => new FakeElement(tag),
      getElementById: () => undefined,
      elementFromPoint: () => editable
    };
    const selection = {
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: editable }),
      toString: () => secret
    };
    runInNewContext(source, {
      browser: {
        runtime: {
          onMessage: { addListener(listener: (message: Record<string, unknown>) => unknown) { runtimeListeners.push(listener); } },
          sendMessage(message: Record<string, unknown>) { pageMessages.push(message); }
        }
      },
      document, Element: FakeElement, location: { href: "https://example.test/page?secret=yes", origin: "https://example.test", pathname: "/page", protocol: "https:" },
      URL, innerWidth: 1200, innerHeight: 800, getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      getSelection: () => selection,
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler),
      removeEventListener: () => undefined
    });

    await runtimeListeners[0]?.({ version: 1, type: "capture.arm", requestId: "editable-request" });
    handlers.get("click")?.({ target: editable, preventDefault() {}, stopImmediatePropagation() {} });
    const serialized = JSON.stringify(pageMessages.at(-1));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("selection");
    expect(serialized).toContain("[redacted editable content]");
  });
});

async function dispatchRuntime(
  listeners: Array<(message: Record<string, unknown>, sender?: Record<string, unknown>) => unknown>,
  message: Record<string, unknown>,
  sender: Record<string, unknown>
): Promise<unknown> {
  for (const listener of listeners) {
    const result = listener(message, sender);
    if (result !== undefined) return await result;
  }
  return undefined;
}
