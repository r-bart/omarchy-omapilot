(() => {
  if (globalThis.__omapilotPickerInstalled) return;
  globalThis.__omapilotPickerInstalled = true;
  const api = globalThis.browser ?? globalThis.chrome;
  let active;
  let highlight;
  let label;
  let lastSelection = "";
  const editableSelector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]';

  function cleanText(value, max = 4_000) {
    const text = String(value ?? "").replace(/\s+/gu, " ").trim();
    return text ? text.slice(0, max) : undefined;
  }

  function safePageUrl() {
    try {
      const url = new URL(location.href);
      url.username = ""; url.password = ""; url.search = ""; url.hash = "";
      return url.toString().slice(0, 8_192);
    } catch { return `${location.origin}${location.pathname}`.slice(0, 8_192); }
  }

  function explicitRole(element) {
    const role = cleanText(element.getAttribute?.("role"), 80);
    if (role) return role;
    const roles = { A: "link", BUTTON: "button", NAV: "navigation", MAIN: "main", ARTICLE: "article", ASIDE: "complementary", HEADER: "banner", FOOTER: "contentinfo", FORM: "form", TABLE: "table", TR: "row", TH: "columnheader", TD: "cell", CODE: "code", PRE: "code", IMG: "img", INPUT: "textbox", SELECT: "combobox", TEXTAREA: "textbox" };
    return roles[element.tagName];
  }

  function accessibleName(element) {
    if (containsSensitive(element)) return undefined;
    const labelledBy = cleanText(element.getAttribute?.("aria-labelledby"), 300);
    if (labelledBy) {
      const labels = labelledBy.split(/\s+/u).map((id) => document.getElementById(id))
        .filter((labelElement) => labelElement && !containsSensitive(labelElement))
        .map((labelElement) => labelElement.innerText).filter(Boolean).join(" ");
      const value = cleanText(labels, 500);
      if (value) return value;
    }
    const candidates = [element.getAttribute?.("aria-label"), element.getAttribute?.("alt"), element.getAttribute?.("title")];
    if (!containsSensitive(element)) candidates.push(element.innerText);
    for (const value of candidates) {
      const name = cleanText(value, 500);
      if (name) return name;
    }
    return undefined;
  }

  function safeAttributes(element) {
    const result = {};
    const allow = sensitive(element) ? ["type"] : containsSensitive(element)
      ? [] : ["aria-label", "aria-description", "alt", "title", "type", "placeholder"];
    for (const name of allow) {
      const value = cleanText(element.getAttribute?.(name), 500);
      if (value) result[name] = value;
    }
    if (element.tagName === "A") {
      try {
        const href = new URL(element.href);
        href.username = ""; href.password = ""; href.search = ""; href.hash = "";
        if (href.protocol === "http:" || href.protocol === "https:") result.href = href.toString().slice(0, 2_000);
      } catch {}
    }
    return Object.keys(result).length ? result : undefined;
  }

  function sensitive(element) {
    return element?.closest?.(editableSelector) != null;
  }

  function containsSensitive(element) {
    return sensitive(element) || element?.querySelector?.(editableSelector) != null;
  }

  function safeSelection() {
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount < 1) return "";
    const container = selection.getRangeAt(0).commonAncestorContainer;
    const element = container instanceof Element ? container : container?.parentElement;
    return element && containsSensitive(element) ? "" : (cleanText(selection.toString(), 12_000) ?? "");
  }

  function semanticNode(element, depth, state) {
    state.count++;
    const node = { tag: element.tagName.toLowerCase() };
    const isSensitive = sensitive(element);
    const role = explicitRole(element); const name = isSensitive ? undefined : accessibleName(element);
    const text = isSensitive ? "[redacted editable content]" : cleanText(element.childElementCount === 0 ? element.textContent : "", 4_000);
    const attributes = safeAttributes(element);
    if (role) node.role = role;
    if (name) node.name = name;
    if (text) node.text = text;
    if (attributes) node.attributes = attributes;
    if (!isSensitive && depth < 4 && state.count < 80) {
      const children = [...element.children].slice(0, 20).filter((child) => {
        const style = getComputedStyle(child);
        return style.display !== "none" && style.visibility !== "hidden";
      }).map((child) => semanticNode(child, depth + 1, state));
      if (children.length) node.children = children;
    }
    return node;
  }

  function chooseTarget(target) {
    if (!(target instanceof Element)) return document.body;
    return target.closest("a,button,input,select,textarea,code,pre,img,svg,canvas,video,tr,li,[role]") ?? target;
  }

  function chooseContext(element) {
    if (!(element instanceof Element)) return document.body;
    const container = element.closest("article,section,form,fieldset,figure,blockquote,li,tr,[role=article],[role=region],[role=dialog],[role=group]");
    if (container) return container;
    return element.closest("main,[role=main]") ?? element;
  }

  function visibleText(element, max = 12_000) {
    return containsSensitive(element) ? undefined : cleanText(element.innerText || element.textContent, max);
  }

  function contextSnapshot(element) {
    const rect = element.getBoundingClientRect();
    const value = {
      tag: element.tagName.toLowerCase(),
      tree: semanticNode(element, 0, { count: 0 }),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
    const role = explicitRole(element); const name = accessibleName(element);
    const text = visibleText(element);
    if (role) value.role = role;
    if (name) value.name = name;
    if (text) value.text = text;
    return value;
  }

  function snapshot(element, context) {
    const rect = element.getBoundingClientRect();
    const ancestors = [];
    for (let current = element.parentElement; current && ancestors.length < 8; current = current.parentElement) {
      const entry = { tag: current.tagName.toLowerCase() };
      const role = explicitRole(current); const name = accessibleName(current);
      if (role) entry.role = role;
      if (name) entry.name = name;
      ancestors.push(entry);
    }
    const value = {
      tag: element.tagName.toLowerCase(),
      ancestors,
      tree: semanticNode(element, 0, { count: 0 }),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      ...(context === element ? {} : { context: contextSnapshot(context) })
    };
    const role = explicitRole(element); const name = accessibleName(element);
    const text = visibleText(element);
    const attributes = safeAttributes(element);
    if (role) value.role = role;
    if (name) value.name = name;
    if (text) value.text = text;
    if (attributes) value.attributes = attributes;
    return value;
  }

  function ensureOverlay() {
    if (highlight) return;
    highlight = document.createElement("div");
    highlight.id = "omapilot-browser-picker-highlight";
    Object.assign(highlight.style, { position: "fixed", pointerEvents: "none", zIndex: "2147483647", border: "2px solid #8b5cf6", background: "rgba(139,92,246,.12)", borderRadius: "4px", boxSizing: "border-box", transition: "all 60ms linear" });
    label = document.createElement("div");
    Object.assign(label.style, { position: "fixed", pointerEvents: "none", zIndex: "2147483647", padding: "5px 8px", borderRadius: "5px", background: "#18181b", color: "#fafafa", font: "12px/1.2 system-ui,sans-serif", boxShadow: "0 4px 14px rgba(0,0,0,.28)", maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    document.documentElement.append(highlight, label);
  }

  function updateOverlay(element) {
    ensureOverlay();
    const context = chooseContext(element);
    const rect = context.getBoundingClientRect();
    Object.assign(highlight.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const targetLabel = visibleText(element, 80) ?? accessibleName(element) ?? element.tagName.toLowerCase();
    const contextLabel = accessibleName(context) ?? context.tagName.toLowerCase();
    label.textContent = `OmaPilot · ${contextLabel} · target ${targetLabel} · click to clip · Esc to cancel`;
    const top = rect.top >= 32 ? rect.top - 28 : Math.min(innerHeight - 28, rect.bottom + 4);
    Object.assign(label.style, { left: `${Math.max(4, Math.min(innerWidth - 324, rect.left))}px`, top: `${Math.max(4, top)}px` });
  }

  function cleanup() {
    removeEventListener("pointermove", onMove, true);
    removeEventListener("click", onClick, true);
    removeEventListener("keydown", onKey, true);
    highlight?.remove(); label?.remove(); highlight = undefined; label = undefined; active = undefined;
  }

  function onMove(event) { updateOverlay(chooseTarget(event.target)); }
  function onClick(event) {
    event.preventDefault(); event.stopImmediatePropagation();
    const requestId = active; const element = chooseTarget(event.target); const context = chooseContext(element);
    cleanup();
    if (!requestId) return;
    api.runtime.sendMessage({
      version: 1, type: "picker.result", requestId,
      title: document.title.slice(0, 500), url: safePageUrl(),
      ...(lastSelection ? { selection: lastSelection } : {}),
      element: snapshot(element, context)
    });
  }
  function onKey(event) {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopImmediatePropagation();
    const requestId = active; cleanup();
    if (requestId) api.runtime.sendMessage({ version: 1, type: "picker.cancelled", requestId });
  }

  function arm(requestId) {
    cleanup();
    active = requestId;
    lastSelection = safeSelection();
    ensureOverlay();
    addEventListener("pointermove", onMove, true);
    addEventListener("click", onClick, true);
    addEventListener("keydown", onKey, true);
    updateOverlay(chooseTarget(document.elementFromPoint(innerWidth / 2, innerHeight / 2)));
  }

  api.runtime.onMessage.addListener((message) => {
    if (!message || message.version !== 1) return undefined;
    if (message.type === "probe") return Promise.resolve({
      available: location.protocol === "http:" || location.protocol === "https:",
      title: document.title.slice(0, 500), url: safePageUrl()
    });
    if (message.type === "capture.arm") { arm(message.requestId); return Promise.resolve({ armed: true }); }
    if (message.type === "capture.cancel" && active === message.requestId) { cleanup(); return Promise.resolve({ cancelled: true }); }
    return undefined;
  });
})();
