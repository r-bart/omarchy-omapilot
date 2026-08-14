.pragma library

// UI-facing Quickchat protocol, version 1. The broker owns harness details,
// policy, persistence, URL opening, clipboard writes, and Herdr control. QML
// only sends typed commands and renders normalized events.

var protocolVersion = 1
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

function submitCommand(id, question, provider, model, capability) {
  var payload = command("submit", {
    id: String(id || ""),
    question: String(question || ""),
    provider: normalizedProvider(provider) || "codex",
    capability: normalizedCapability(capability)
  })
  var selectedModel = String(model || "").trim()
  if (selectedModel !== "") payload.model = selectedModel
  return payload
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

function normalizedCapability(value) {
  var capability = String(value || "").toLowerCase()
  return ["answer", "web", "tools"].indexOf(capability) >= 0 ? capability : "answer"
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
      web: raw && typeof raw === "object" && Array.isArray(raw.capabilities)
        ? raw.capabilities.indexOf("web") >= 0
        : !(raw && typeof raw === "object" && raw.web === false),
      tools: raw && typeof raw === "object" && Array.isArray(raw.capabilities)
        ? raw.capabilities.indexOf("tools") >= 0
        : false
    })
  }
  return result
}

function modelOptions(providers, provider) {
  var rows = Array.isArray(providers) ? providers : []
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].value === provider) return rows[i].models || []
  }
  return []
}

function providerSupportsWeb(providers, provider) {
  var rows = Array.isArray(providers) ? providers : []
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].value === provider) return rows[i].web !== false
  }
  return false
}

function providerSupportsTools(providers, provider) {
  var rows = Array.isArray(providers) ? providers : []
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].value === provider) return rows[i].tools === true
  }
  return false
}

function normalizedPermission(raw, currentRequestId) {
  var value = raw && typeof raw === "object" ? raw : {}
  var id = String(value.id || "")
  var requestId = String(value.requestId || "")
  var kind = String(value.kind || "")
  if (!id || requestId !== String(currentRequestId || "")
      || (kind !== "execute" && kind !== "local_action")) return null
  return {
    id: id,
    requestId: requestId,
    title: String(value.title || (kind === "local_action" ? "Local action" : "Tool request")).slice(0, 120),
    kind: kind,
    authority: value.authority === "device" || value.authority === "sandboxed" || value.authority === "local_action"
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
      capability: normalizedCapability(row.capability),
      timestamp: String(row.createdAt || row.timestamp || ""),
      images: Array.isArray(row.images) ? row.images : [],
      resumable: row.resumable === true || (row.session && row.session.resumable === true)
    })
  }
  return result
}
