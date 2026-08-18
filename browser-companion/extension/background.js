const api = globalThis.browser ?? globalThis.chrome;
const HOST = "io.github.spencerbull.omapilot_browser";
const SCRIPT_PREFIX = "omapilot-site-";
let nativePort;
let reconnectTimer;
const registrationJobs = new Map();
const captureTabs = new Map();

function browserFamily() {
  // Chromium may expose a `browser` compatibility namespace and user-agent
  // reduction makes UA sniffing brittle. Only the Firefox build carries the
  // Gecko manifest metadata.
  return api.runtime.getManifest().browser_specific_settings?.gecko
    ? "firefox" : "chromium";
}

function browserName() {
  const brands = globalThis.navigator?.userAgentData?.brands ?? [];
  const brand = brands.find((entry) => !/Not.A.Brand/iu.test(entry.brand))?.brand;
  if (brand) return brand.slice(0, 80);
  const match = globalThis.navigator?.userAgent?.match(/(Firefox|Edg|Chrome|Chromium|Brave)\/[\d.]+/u);
  return (match?.[1] ?? browserFamily()).slice(0, 80);
}

function connectNative() {
  clearTimeout(reconnectTimer);
  if (nativePort) return;
  try {
    const port = api.runtime.connectNative(HOST);
    nativePort = port;
    port.onMessage.addListener(handleNativeMessage);
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      nativePort = undefined;
      reconnectTimer = setTimeout(connectNative, 2_000);
    });
    port.postMessage({
      version: 1,
      type: "hello",
      family: browserFamily(),
      browser: browserName(),
      extensionVersion: api.runtime.getManifest().version
    });
  } catch {
    nativePort = undefined;
    reconnectTimer = setTimeout(connectNative, 2_000);
  }
}

function sendNative(message) {
  if (!nativePort) connectNative();
  try { nativePort?.postMessage(message); } catch { nativePort = undefined; }
}

async function activeTab() {
  const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

async function sendToPicker(tabId, message) {
  return api.tabs.sendMessage(tabId, message);
}

async function handleNativeMessage(message) {
  if (!message || message.version !== 1 || typeof message.requestId !== "string") return;
  if (message.type === "probe") {
    captureTabs.delete(message.requestId);
    const tab = await activeTab();
    if (!tab || typeof tab.id !== "number" || tab.incognito) {
      sendNative({ version: 1, type: "probe.result", requestId: message.requestId, available: false, reason: "No eligible active tab" });
      return;
    }
    try {
      const result = await sendToPicker(tab.id, { version: 1, type: "probe", requestId: message.requestId });
      if (result?.available === true) captureTabs.set(message.requestId, {
        tabId: tab.id,
        url: typeof result.url === "string" ? result.url.slice(0, 8192) : undefined
      });
      sendNative({
        version: 1, type: "probe.result", requestId: message.requestId,
        available: result?.available === true,
        ...(typeof result?.title === "string" ? { title: result.title.slice(0, 500) } : {}),
        ...(typeof result?.url === "string" ? { url: result.url.slice(0, 8192) } : {}),
        ...(typeof result?.reason === "string" ? { reason: result.reason.slice(0, 160) } : {})
      });
    } catch {
      sendNative({ version: 1, type: "probe.result", requestId: message.requestId, available: false, reason: "Site permission is required" });
    }
    return;
  }
  if (message.type === "capture.arm" || message.type === "capture.cancel") {
    const capture = captureTabs.get(message.requestId);
    if (!capture) {
      if (message.type === "capture.arm") sendNative({
        version: 1, type: "capture.error", requestId: message.requestId,
        reason: "The probed browser tab is no longer available"
      });
      return;
    }
    try {
      await sendToPicker(capture.tabId, message);
      if (message.type === "capture.cancel") captureTabs.delete(message.requestId);
    } catch {
      captureTabs.delete(message.requestId);
      if (message.type === "capture.arm") sendNative({
        version: 1, type: "capture.error", requestId: message.requestId,
        reason: "The page picker is unavailable on this tab"
      });
    }
  }
}

api.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.version !== 1) return undefined;
  if (message.type === "picker.result" || message.type === "picker.cancelled" || message.type === "picker.error") {
    const capture = typeof message.requestId === "string" ? captureTabs.get(message.requestId) : undefined;
    if (!capture || sender?.tab?.id !== capture.tabId || (sender.frameId !== undefined && sender.frameId !== 0))
      return Promise.resolve({ accepted: false });
    if (message.type === "picker.result" && capture.url !== undefined && message.url !== capture.url)
      return Promise.resolve({ accepted: false });
    captureTabs.delete(message.requestId);
    const type = message.type === "picker.result" ? "capture.result"
      : message.type === "picker.cancelled" ? "capture.cancelled" : "capture.error";
    sendNative({ ...message, type });
    return Promise.resolve({ accepted: true });
  }
  return undefined;
});

async function scriptId(origin) {
  const bytes = new TextEncoder().encode(origin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return SCRIPT_PREFIX + [...new Uint8Array(digest)].slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function registerOrigin(origin, tabIds) {
  const id = await scriptId(origin);
  try { await api.scripting.unregisterContentScripts({ ids: [id] }); } catch {}
  await api.scripting.registerContentScripts([{
    id,
    matches: [`${origin}/*`],
    js: ["picker.js"],
    runAt: "document_start",
    allFrames: false,
    persistAcrossSessions: true
  }]);
  const ids = Array.isArray(tabIds) ? tabIds : (typeof tabIds === "number" ? [tabIds] : []);
  for (const tabId of new Set(ids)) {
    try { await api.scripting.executeScript({ target: { tabId }, files: ["picker.js"] }); } catch {}
  }
  const stored = await api.storage.local.get("enabledOrigins");
  const origins = Array.isArray(stored.enabledOrigins) ? stored.enabledOrigins.filter((value) => typeof value === "string") : [];
  if (!origins.includes(origin)) origins.push(origin);
  await api.storage.local.set({ enabledOrigins: origins.slice(-200) });
}

function queueOriginRegistration(origin, tabIds) {
  const previous = registrationJobs.get(origin) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(() => registerOrigin(origin, tabIds));
  registrationJobs.set(origin, job);
  const cleanup = () => {
    if (registrationJobs.get(origin) === job) registrationJobs.delete(origin);
  };
  void job.then(cleanup, cleanup);
  return job;
}

function permissionPatternOrigin(pattern) {
  if (typeof pattern !== "string" || !pattern.endsWith("/*")) return undefined;
  try {
    const url = new URL(pattern.slice(0, -1));
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname.includes("*")) return undefined;
    return url.origin;
  } catch { return undefined; }
}

api.permissions.onAdded?.addListener((permissions) => {
  void (async () => {
    for (const pattern of permissions.origins ?? []) {
      const origin = permissionPatternOrigin(pattern);
      if (!origin) continue;
      const tabs = await api.tabs.query({ url: `${origin}/*` }).catch(() => []);
      const tabIds = tabs
        .filter((tab) => !tab.incognito && typeof tab.id === "number")
        .map((tab) => tab.id);
      await queueOriginRegistration(origin, tabIds);
    }
  })();
});

api.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "permission.register") return undefined;
  return (async () => {
    const tab = await activeTab();
    if (!tab || typeof tab.id !== "number" || tab.id !== message.tabId || typeof tab.url !== "string" || tab.incognito)
      return { ok: false, message: "This tab cannot be enabled." };
    let origin;
    try {
      const url = new URL(tab.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("restricted");
      origin = url.origin;
    } catch { return { ok: false, message: "Browser and extension pages cannot be enabled." }; }
    if (origin !== message.origin) return { ok: false, message: "The active page changed before it could be enabled." };
    const granted = await api.permissions.contains({ origins: [`${origin}/*`] });
    if (!granted) return { ok: false, message: "Site access was not granted." };
    await queueOriginRegistration(origin, tab.id);
    return { ok: true, origin };
  })();
});

api.runtime.onStartup?.addListener(connectNative);
api.runtime.onInstalled.addListener(() => {
  connectNative();
  void (async () => {
    const stored = await api.storage.local.get("enabledOrigins");
    const origins = Array.isArray(stored.enabledOrigins) ? stored.enabledOrigins.filter((value) => typeof value === "string") : [];
    for (const origin of origins) {
      if (await api.permissions.contains({ origins: [`${origin}/*`] })) await queueOriginRegistration(origin);
    }
  })();
});
connectNative();
