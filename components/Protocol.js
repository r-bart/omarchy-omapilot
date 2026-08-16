.pragma library

// UI-facing Quickchat protocol, version 1. The broker owns harness details,
// policy, persistence, URL opening, clipboard writes, and Herdr control. QML
// only sends typed commands and renders normalized events.

var protocolVersion = 2
var validStates = [
  "idle", "composing", "preparing", "dictating", "streaming",
  "complete", "canceled", "error", "unavailable", "history"
]

function command(type, values) {
  var result = { type: String(type || "") }
  var source = values || {}
  for (var key in source) result[key] = source[key]
  return result
}

function submitCommand(id, question, provider, model, desktopContext) {
  var payload = command("submit", {
    id: String(id || ""),
    question: String(question || ""),
    provider: normalizedProvider(provider) || "codex"
  })
  var selectedModel = String(model || "").trim()
  if (selectedModel !== "") payload.model = selectedModel
  var context = normalizedDesktopContext(desktopContext)
  if (context !== null) payload.desktopContext = context
  return payload
}

function safeContextText(value, limit) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
}

function isShellAppId(value) {
  var appId = safeContextText(value, 160).toLowerCase()
  return appId.indexOf("quickshell") >= 0 || appId.indexOf("omarchy-shell") >= 0
}

function normalizedDesktopWindow(raw) {
  var source = raw && typeof raw === "object" ? raw : {}
  var result = {}
  var appId = safeContextText(source.appId, 160)
  var title = safeContextText(source.title, 240)
  var monitor = safeContextText(source.monitor, 120)
  var workspace = Number(source.workspace)
  if (appId !== "") result.appId = appId
  if (title !== "") result.title = title
  if (Number.isFinite(workspace) && Math.floor(workspace) === workspace
      && workspace >= -100000 && workspace <= 100000) result.workspace = workspace
  if (monitor !== "") result.monitor = monitor
  return Object.keys(result).length > 0 ? result : null
}

function normalizedDesktopApp(raw) {
  var source = raw && typeof raw === "object" ? raw : {}
  var appId = safeContextText(source.appId, 160)
  if (appId === "") return null
  var workspaces = []
  var sourceWorkspaces = Array.isArray(source.workspaces) ? source.workspaces : []
  for (var i = 0; i < sourceWorkspaces.length && workspaces.length < 12; i++) {
    var workspace = Number(sourceWorkspaces[i])
    if (!Number.isFinite(workspace) || Math.floor(workspace) !== workspace
        || workspace < -100000 || workspace > 100000 || workspaces.indexOf(workspace) >= 0) continue
    workspaces.push(workspace)
  }
  workspaces.sort(function(left, right) { return left - right })
  var windowCount = Math.floor(Number(source.windowCount))
  return {
    appId: appId,
    workspaces: workspaces,
    windowCount: Number.isFinite(windowCount) && windowCount > 0 && windowCount <= 64 ? windowCount : 1
  }
}

function normalizedDesktopMedia(raw) {
  var source = raw && typeof raw === "object" ? raw : {}
  var result = {}
  var player = safeContextText(source.player, 160)
  var title = safeContextText(source.title, 240)
  var artist = safeContextText(source.artist, 200)
  if (player !== "") result.player = player
  if (title !== "") result.title = title
  if (artist !== "") result.artist = artist
  return Object.keys(result).length > 0 ? result : null
}

function normalizedDesktopContext(raw) {
  var source = raw && typeof raw === "object" ? raw : {}
  var activeWindow = normalizedDesktopWindow(source.activeWindow)
  if (activeWindow !== null && activeWindow.appId && isShellAppId(activeWindow.appId)) activeWindow = null
  var appMap = {}
  var workspaceMap = {}
  var sourceWindows = Array.isArray(source.windows) ? source.windows : []
  for (var i = 0; i < sourceWindows.length; i++) {
    var window = normalizedDesktopWindow(sourceWindows[i])
    if (window === null) continue
    if (window.appId && isShellAppId(window.appId)) continue
    if (window.workspace !== undefined) workspaceMap[String(window.workspace)] = window.workspace
    if (!window.appId) continue
    var appKey = String(window.appId).toLowerCase()
    if (!appMap[appKey]) appMap[appKey] = { appId: window.appId, workspaces: [], windowCount: 0 }
    appMap[appKey].windowCount += 1
    if (window.workspace !== undefined && appMap[appKey].workspaces.indexOf(window.workspace) < 0)
      appMap[appKey].workspaces.push(window.workspace)
  }
  var sourceApps = Array.isArray(source.apps) ? source.apps : []
  for (var a = 0; a < sourceApps.length; a++) {
    var app = normalizedDesktopApp(sourceApps[a])
    if (app === null) continue
    if (isShellAppId(app.appId)) continue
    var key = app.appId.toLowerCase()
    if (!appMap[key]) appMap[key] = app
    for (var aw = 0; aw < app.workspaces.length; aw++) workspaceMap[String(app.workspaces[aw])] = app.workspaces[aw]
  }
  var sourceWorkspaceIds = Array.isArray(source.workspaces) ? source.workspaces : []
  for (var sw = 0; sw < sourceWorkspaceIds.length; sw++) {
    var workspaceId = Number(sourceWorkspaceIds[sw])
    if (Number.isFinite(workspaceId) && Math.floor(workspaceId) === workspaceId
        && workspaceId >= -100000 && workspaceId <= 100000) workspaceMap[String(workspaceId)] = workspaceId
  }
  var apps = []
  var appKeys = Object.keys(appMap).sort()
  for (var k = 0; k < appKeys.length && apps.length < 12; k++) apps.push(normalizedDesktopApp(appMap[appKeys[k]]))
  var workspaces = []
  var workspaceKeys = Object.keys(workspaceMap)
  for (var w = 0; w < workspaceKeys.length; w++) workspaces.push(workspaceMap[workspaceKeys[w]])
  workspaces.sort(function(left, right) { return left - right })
  workspaces = workspaces.slice(0, 12)
  var media = []
  var sourceMedia = Array.isArray(source.media) ? source.media : []
  for (var j = 0; j < sourceMedia.length && media.length < 4; j++) {
    var player = normalizedDesktopMedia(sourceMedia[j])
    if (player !== null) media.push(player)
  }
  if (activeWindow === null && apps.length === 0 && workspaces.length === 0 && media.length === 0) return null
  var result = { version: 1, apps: apps, workspaces: workspaces, media: media }
  if (activeWindow !== null) result.activeWindow = activeWindow
  return result
}

function desktopContextWithLatchedActive(raw, latchedActiveWindow) {
  var context = normalizedDesktopContext(raw)
  var latched = normalizedDesktopWindow(latchedActiveWindow)
  if (context === null) {
    if (latched === null) return null
    context = { version: 1, apps: [], workspaces: [], media: [] }
  }
  if (!context.activeWindow && latched !== null) context.activeWindow = latched
  return normalizedDesktopContext(context)
}

function hasFeature(features, feature) {
  var values = Array.isArray(features) ? features : []
  return values.indexOf(String(feature || "")) >= 0
}

function parseLine(line) {
  try {
    var value = JSON.parse(String(line || ""))
    return value && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch (error) {
    return null
  }
}

function isCompatibleEvent(event) {
  return event && Number(event.protocolVersion) === protocolVersion
}

function normalizedState(value, fallback) {
  var state = String(value || "")
  return validStates.indexOf(state) >= 0 ? state : (fallback || "idle")
}

function normalizedProvider(value) {
  var provider = String(value || "").toLowerCase()
  return ["codex", "claude", "opencode"].indexOf(provider) >= 0 ? provider : ""
}

function providerLabel(value) {
  var provider = normalizedProvider(value)
  if (provider === "codex") return "Codex"
  if (provider === "claude") return "Claude"
  if (provider === "opencode") return "OpenCode"
  return String(value || "")
}

function normalizeProviders(input) {
  var source = Array.isArray(input) ? input : []
  var result = []
  for (var i = 0; i < source.length; i++) {
    var raw = source[i]
    var id = normalizedProvider(raw && typeof raw === "object" ? raw.id : raw)
    if (!id || (raw && typeof raw === "object" && raw.ready === false)) continue
    var models = raw && typeof raw === "object" && Array.isArray(raw.models) ? raw.models : []
    var normalizedModels = []
    for (var j = 0; j < models.length; j++) {
      var model = models[j]
      var modelId = String(model && typeof model === "object" ? model.id || model.value || "" : model)
      if (!modelId) continue
      normalizedModels.push({
        value: modelId,
        label: String(model && typeof model === "object" ? model.label || model.name || modelId : modelId)
      })
    }
    result.push({
      value: id,
      label: String(raw && typeof raw === "object" ? raw.label || raw.name || providerLabel(id) : providerLabel(id)),
      models: normalizedModels,
      defaultModel: String(raw && typeof raw === "object" ? raw.defaultModel || "" : ""),
      policy: normalizedProviderPolicy(raw && typeof raw === "object" ? raw.policy : null)
    })
  }
  return result
}

function normalizedProviderPolicy(raw) {
  var value = raw && typeof raw === "object" ? raw : {}
  var tools = ["device-approval", "sandboxed", "blocked"].indexOf(value.tools) >= 0
    ? String(value.tools) : "blocked"
  var web = ["approved-command", "search", "blocked"].indexOf(value.web) >= 0
    ? String(value.web) : "blocked"
  return { tools: tools, web: web, hostReads: value.hostReads === true }
}

function providerPolicy(providers, provider) {
  var rows = Array.isArray(providers) ? providers : []
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].value === provider) return rows[i].policy
  }
  return normalizedProviderPolicy(null)
}

function providerPolicyDescription(provider, rawPolicy) {
  var label = providerLabel(provider) || "This harness"
  var policy = normalizedProviderPolicy(rawPolicy)
  if (policy.tools === "sandboxed") {
    var searchClause = policy.web === "search" ? " and can search the web" : ""
    return label + " uses tools in disposable scratch" + searchClause
      + ". Host files, credentials, direct command network access, and outside writes stay blocked."
  }
  if (policy.tools === "blocked") {
    return policy.web === "search"
      ? label + " can search the web. Device commands stay blocked until its harness can present an exact approval."
      : label + " runs without web or device tools."
  }
  var skillsClause = " It can load relevant installed skills automatically."
  if (policy.hostReads) {
    return policy.web === "approved-command"
      ? label + " uses device tools when useful. It may read user-readable files; network access and broader commands require Allow once." + skillsClause
      : label + " uses device tools when useful. It may read user-readable files; broader commands require Allow once." + skillsClause
  }
  return label + " can use safe local tools" + (policy.web === "search" ? " and web search" : "")
    + ". Host files and device changes require Allow once." + skillsClause
}

function modelOptions(providers, provider) {
  var rows = Array.isArray(providers) ? providers : []
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].value === provider) return rows[i].models || []
  }
  return []
}

function normalizedPermission(raw, currentRequestId) {
  var value = raw && typeof raw === "object" ? raw : {}
  var id = String(value.id || "")
  var requestId = String(value.requestId || "")
  var kind = String(value.kind || "")
  if (!id || requestId !== String(currentRequestId || "") || kind !== "execute") return null
  return {
    id: id,
    requestId: requestId,
    title: String(value.title || "Tool request").slice(0, 120),
    kind: kind,
    authority: value.authority === "device" || value.authority === "sandboxed"
      ? String(value.authority) : "device",
    detail: String(value.detail || "").slice(0, 3000),
    allowOnce: value.allowOnce === true
  }
}

function isSafeExternalUrl(url) {
  var value = String(url || "").trim()
  return /^(https?:\/\/|mailto:)/i.test(value)
}

function isImageLink(url) {
  return String(url || "").indexOf("quickchat-image:") === 0
}

function imageUrl(url) {
  if (!isImageLink(url)) return ""
  try { return decodeURIComponent(String(url).slice("quickchat-image:".length)) }
  catch (error) { return "" }
}

function sanitizeMarkdown(markdown) {
  var value = String(markdown || "")
  var definitions = {}
  var imageReferences = {}
  var imageReferenceMatcher = /!\[[^\]]*\]\[([^\]]+)\]/g
  var imageReference
  while ((imageReference = imageReferenceMatcher.exec(value)) !== null)
    imageReferences[String(imageReference[1] || "").toLowerCase()] = true
  var definitionMatcher = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+["'(][^\n]*["')])?\s*$/gmi
  var definition
  while ((definition = definitionMatcher.exec(value)) !== null)
    definitions[String(definition[1] || "").toLowerCase()] = String(definition[2] || "")
  // Qt Markdown may resolve images on its own. Replace image syntax with an
  // inert custom link so the broker can validate and fetch only after click.
  value = value.replace(/!\[([^\]]*)\]\(([^\s\)]+)(?:\s+["'][^"']*["'])?\)/g,
    function(_, alt, url) {
      var target = String(url || "")
      if (!/^https:\/\//i.test(target)) return "Image blocked: " + (alt || "unnamed image")
      return "[Image: " + (alt || "remote image") + " — click to load](quickchat-image:" + encodeURIComponent(target) + ")"
    })
  value = value.replace(/!\[([^\]]*)\]\[([^\]]+)\]/g,
    function(_, alt, id) {
      var target = definitions[String(id || "").toLowerCase()] || ""
      if (!/^https:\/\//i.test(target)) return "Image blocked: " + (alt || "unnamed image")
      return "[Image: " + (alt || "remote image") + " — click to load](quickchat-image:" + encodeURIComponent(target) + ")"
    })
  value = value.replace(definitionMatcher, function(line, id) {
    return imageReferences[String(id || "").toLowerCase()] ? "" : line
  })
  // Raw HTML images bypass Markdown's image syntax entirely; never let their
  // src reach Text.MarkdownText.
  value = value.replace(/<img\b[^>]*>/gi, "Image blocked: embedded HTML image")
  // Text.MarkdownText does not execute script, but stripping active/embed
  // HTML keeps the rendered subset explicit and deterministic.
  value = value.replace(/<\/?(?:script|iframe|object|embed|style|link|meta)[^>]*>/gi, "")
  // CommonMark has several image forms (inline, full/collapsed/shortcut
  // references, nested labels, and escaped label text). After converting the
  // forms we understand into broker-owned quickchat-image links, remove the
  // image opener itself from every remaining form. Encoding the exclamation
  // mark is deliberately structural: Markdown parses the entity as display
  // text only, so Text.MarkdownText never receives an image token or URL to
  // resolve on its own.
  value = value.replace(/!\[/g, "&#33;[")
  return value
}

function markdownBlocks(markdown) {
  var value = String(markdown || "")
  var result = []
  var matcher = /```([^\n`]*)\n([\s\S]*?)```/g
  var cursor = 0
  var match
  while ((match = matcher.exec(value)) !== null) {
    if (match.index > cursor)
      result.push({ kind: "markdown", text: sanitizeMarkdown(value.slice(cursor, match.index)) })
    result.push({ kind: "code", language: String(match[1] || "").trim(), text: String(match[2] || "").replace(/\n$/, "") })
    cursor = matcher.lastIndex
  }
  if (cursor < value.length)
    result.push({ kind: "markdown", text: sanitizeMarkdown(value.slice(cursor)) })
  if (result.length === 0) result.push({ kind: "markdown", text: sanitizeMarkdown(value) })
  return result
}

function normalizedImage(raw) {
  var value = raw && typeof raw === "object" ? raw : {}
  var state = String(value.state || (value.source || value.localUrl || value.url ? "ready" : "placeholder"))
  if (["placeholder", "loading", "ready", "error", "expired"].indexOf(state) < 0) state = "placeholder"
  return {
    id: String(value.id || ""),
    state: state,
    source: String(value.source || value.localUrl || ""),
    remoteUrl: String(value.remoteUrl || value.sourceUrl || value.url || ""),
    alt: String(value.alt || "AI response image"),
    host: String(value.host || ""),
    error: String(value.error || "")
  }
}

function mergeImageEvent(images, event, currentRequestId) {
  var source = Array.isArray(images) ? images : []
  var raw = event && event.image ? event.image : event
  var incoming = normalizedImage(raw)
  var eventId = String(event && event.id || "")
  var remoteKey = incoming.remoteUrl || (/^https:\/\//i.test(eventId) ? eventId : "")
  var result = []
  var replaced = false
  for (var i = 0; i < source.length; i++) {
    var existing = normalizedImage(source[i])
    if (!replaced && remoteKey && existing.remoteUrl === remoteKey) {
      result.push(incoming)
      replaced = true
    } else result.push(source[i])
  }
  if (!replaced && (eventId === "" || eventId === String(currentRequestId || "") || remoteKey))
    result.push(incoming)
  return result
}

function herdrOutcome(event) {
  var value = event || {}
  var state = String(value.state || "")
  if (state === "opening") return { state: "preparing", message: String(value.message || "Opening in Herdr…"), toast: false }
  if (state === "continued") return {
    state: "complete",
    message: value.mode === "native" ? "Continued native session in Herdr" : "Continued from transcript in Herdr",
    toast: true
  }
  if (state === "unavailable" || state === "failed")
    return { state: "error", message: String(value.message || "Could not continue in Herdr."), toast: false }
  return null
}

function normalizedHistory(input) {
  var source = Array.isArray(input) ? input : []
  var result = []
  for (var i = 0; i < source.length && result.length < 30; i++) {
    var row = source[i] || {}
    if (!row.id) continue
    result.push({
      id: String(row.id),
      title: String(row.title || row.question || "Untitled question"),
      question: String(row.question || ""),
      answer: String(row.answer || row.markdown || ""),
      provider: normalizedProvider(row.provider) || "codex",
      model: String(row.model || ""),
      timestamp: String(row.createdAt || row.timestamp || ""),
      images: Array.isArray(row.images) ? row.images : [],
      resumable: row.resumable === true || (row.session && row.session.resumable === true)
    })
  }
  return result
}
