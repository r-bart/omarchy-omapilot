pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io
import "Protocol.js" as Protocol

// One process and one ephemeral UI model for every screen. The broker is the
// only durable authority; this singleton merely normalizes its NDJSON stream
// into renderable presentation state.
Scope {
  id: root

  readonly property int protocolVersion: Protocol.protocolVersion
  readonly property string bundledBrokerPath: {
    var url = String(Qt.resolvedUrl("../runtime/bin/quickchat-broker"))
    if (url.indexOf("file://") === 0) {
      try { return decodeURIComponent(url.slice("file://".length)) }
      catch (error) { return url.slice("file://".length) }
    }
    return url
  }
  readonly property string brokerPath: Quickshell.env("QUICKCHAT_BROKER_PATH") || bundledBrokerPath

  property string state: "preparing"
  property string statusMessage: "Starting OmaPilot…"
  property string currentId: ""
  property string currentChatId: ""
  property string question: ""
  property string answerMarkdown: ""
  property int activityRevision: 0
  property var errorDetails: null
  property var images: []
  property var providers: []
  property var history: []
  property string provider: "codex"
  property string model: ""
  property var pendingPermission: null
  property var permissionQueue: []
  property string transcript: ""
  property string dictationPhase: ""
  property bool initialized: false
  property bool processStarted: false
  property var queuedCommands: []
  property string stderrTail: ""
  property string configuredProvider: "codex"
  property string configuredCodexModel: ""
  property string configuredClaudeModel: ""
  property string configuredOpencodeModel: ""
  property bool configuredDangerousAutoApprove: false
  property bool desktopContextEnabled: true
  property bool brokerDesktopContextSupported: false
  property var latchedActiveWindow: null

  readonly property bool busy: state === "preparing" || state === "dictating" || state === "streaming" || state === "stopping"
  readonly property bool canSubmit: initialized && providers.length > 0 && !busy
  readonly property bool canRetry: !processStarted && !broker.running && state === "unavailable"
  readonly property var modelOptions: Protocol.modelOptions(providers, provider)
  readonly property var providerPolicy: Protocol.providerPolicy(providers, provider)
  readonly property bool desktopContextActive: desktopContextEnabled && brokerDesktopContextSupported

  signal answerChanged()
  signal focusComposerRequested()
  signal toastRequested(string message)
  signal herdrContinued()
  signal ipcOpenRequested()
  signal ipcCloseRequested()
  signal ipcToggleRequested()
  signal ipcHistoryRequested()

  function routeIpc(method) {
    if (method === "open" || method === "show") ipcOpenRequested()
    else if (method === "close" || method === "hide") ipcCloseRequested()
    else if (method === "toggle") ipcToggleRequested()
    else if (method === "history") ipcHistoryRequested()
    else if (method === "newChat") { newChat(); ipcOpenRequested() }
  }

  function configure(settings) {
    var source = settings || {}
    var desiredProvider = Protocol.normalizedProvider(source.provider) || "codex"
    var desiredCodexModel = String(source.codexModel || "")
    var desiredClaudeModel = String(source.claudeModel || "")
    var desiredOpencodeModel = String(source.opencodeModel || "")
    var desiredDangerousAutoApprove = source.dangerousAutoApprove === true
    var desiredDesktopContext = String(source.desktopContext || "On") !== "Off"
    var changed = desiredProvider !== configuredProvider
      || desiredCodexModel !== configuredCodexModel
      || desiredClaudeModel !== configuredClaudeModel
      || desiredOpencodeModel !== configuredOpencodeModel
      || desiredDangerousAutoApprove !== configuredDangerousAutoApprove
      || desiredDesktopContext !== desktopContextEnabled
    if (!changed) return
    configuredProvider = desiredProvider
    configuredCodexModel = desiredCodexModel
    configuredClaudeModel = desiredClaudeModel
    configuredOpencodeModel = desiredOpencodeModel
    configuredDangerousAutoApprove = desiredDangerousAutoApprove
    desktopContextEnabled = desiredDesktopContext
    if (!desktopContextEnabled) latchedActiveWindow = null
    if (providers.length === 0 || providerAvailable(desiredProvider)) provider = desiredProvider
    var desiredModel = desiredProvider === "claude" ? desiredClaudeModel
      : desiredProvider === "opencode" ? desiredOpencodeModel : desiredCodexModel
    model = desiredModel
    if (providers.length > 0) selectProvider(provider)
  }

  function providerAvailable(value) {
    for (var i = 0; i < providers.length; i++) if (providers[i].value === value) return true
    return false
  }

  function selectProvider(value) {
    var desired = Protocol.normalizedProvider(value)
    if (!providerAvailable(desired)) return
    provider = desired
    var options = Protocol.modelOptions(providers, provider)
    var found = false
    for (var i = 0; i < options.length; i++) if (options[i].value === model) found = true
    if (!found) {
      var preferred = ""
      for (var p = 0; p < providers.length; p++)
        if (providers[p].value === provider) preferred = String(providers[p].defaultModel || "")
      model = preferred || (options.length > 0 ? options[0].value : "")
    }
  }

  function sendCommand(payload) {
    if (!payload || !payload.type) return
    if (!broker.running || !processStarted) {
      var queued = queuedCommands.slice()
      queued.push(payload)
      queuedCommands = queued
      if (!broker.running) broker.running = true
      return
    }
    broker.write(JSON.stringify(payload) + "\n")
  }

  function flushQueue() {
    var queued = queuedCommands
    queuedCommands = []
    for (var i = 0; i < queued.length; i++) broker.write(JSON.stringify(queued[i]) + "\n")
  }

  function initialize() {
    sendCommand(Protocol.command("initialize", {
      protocolVersion: protocolVersion,
      client: "omarchy-quickchat"
    }))
  }

  function latchDesktopContext() {
    if (!desktopContextEnabled) return
    var context = DesktopContext.snapshot()
    latchedActiveWindow = context && context.activeWindow ? context.activeWindow : null
  }

  function clearDesktopContextLatch() {
    latchedActiveWindow = null
  }

  function desktopContextForSubmit() {
    if (!desktopContextActive) return null
    var context = DesktopContext.snapshot()
    return Protocol.desktopContextWithLatchedActive(context, latchedActiveWindow)
  }

  function submit(text) {
    var prompt = String(text || "").trim()
    if (!prompt || !canSubmit) return false
    currentId = "qml-" + Date.now() + "-" + Math.floor(Math.random() * 100000)
    currentChatId = ""
    question = prompt
    answerMarkdown = ""
    activityRevision = 0
    errorDetails = null
    images = []
    pendingPermission = null
    permissionQueue = []
    state = "preparing"
    statusMessage = "Preparing " + Protocol.providerLabel(provider) + "…"
    var context = desktopContextForSubmit()
    var autoApprove = configuredDangerousAutoApprove
    sendCommand(Protocol.submitCommand(
      currentId, prompt, provider, model, context, autoApprove))
    answerChanged()
    return true
  }

  function cancel() {
    if (dictationPhase !== "") {
      sendCommand(Protocol.command("dictation_cancel"))
      return
    }
    if (state !== "preparing" && state !== "streaming") return
    sendCommand(Protocol.command("cancel", { id: currentId }))
  }

  function respondPermission(decision) {
    if (!pendingPermission || !currentId) return
    var selected = decision === "allow_once" ? "allow_once" : "reject_once"
    sendCommand(Protocol.command("permission_response", {
      id: currentId,
      permissionId: String(pendingPermission.id || ""),
      decision: selected
    }))
  }

  function closePermission(permissionId) {
    var id = String(permissionId || "")
    var queued = []
    for (var i = 0; i < permissionQueue.length; i++)
      if (String(permissionQueue[i].id || "") !== id) queued.push(permissionQueue[i])
    permissionQueue = queued
    if (pendingPermission && String(pendingPermission.id || "") === id)
      pendingPermission = queued.length > 0 ? queued[0] : null
  }

  function newChat() {
    currentId = ""
    currentChatId = ""
    question = ""
    answerMarkdown = ""
    activityRevision = 0
    errorDetails = null
    images = []
    pendingPermission = null
    permissionQueue = []
    transcript = ""
    state = initialized ? "composing" : "preparing"
    statusMessage = initialized ? "" : "Starting OmaPilot…"
    focusComposerRequested()
    answerChanged()
  }

  function startDictation() {
    if (!initialized || busy) return
    transcript = ""
    sendCommand(Protocol.command("dictation_start"))
  }

  function stopDictation() {
    if (state === "dictating") sendCommand(Protocol.command("dictation_stop"))
  }

  function requestHistory() { sendCommand(Protocol.command("history_list")) }
  function deleteHistory(chatId) { sendCommand(Protocol.command("history_delete", { chatId: String(chatId) })) }
  function clearHistory() { sendCommand(Protocol.command("history_clear")) }
  function copyText(text) { sendCommand(Protocol.command("copy", { text: String(text || "") })) }

  function retryBroker() {
    if (!canRetry) return
    state = "preparing"
    statusMessage = "Restarting OmaPilot…"
    errorDetails = null
    stderrTail = ""
    broker.running = true
  }

  function activateLink(url) {
    var value = String(url || "")
    if (Protocol.isImageLink(value)) {
      var target = Protocol.imageUrl(value)
      if (target) sendCommand(Protocol.command("load_image", { url: target }))
      return
    }
    if (Protocol.isSafeExternalUrl(value))
      sendCommand(Protocol.command("open_link", { url: value }))
  }

  function requestImage(value) {
    var image = Protocol.normalizedImage(value)
    if (image.remoteUrl) sendCommand(Protocol.command("load_image", { id: image.id, url: image.remoteUrl }))
  }

  function continueInHerdr() {
    if (!currentChatId) return
    state = "preparing"
    statusMessage = "Opening in Herdr…"
    sendCommand(Protocol.command("continue_in_herdr", { chatId: currentChatId }))
  }

  function loadChat(chat) {
    if (!chat) return
    currentChatId = String(chat.id || "")
    currentId = ""
    question = String(chat.question || "")
    answerMarkdown = String(chat.answer || chat.markdown || "")
    activityRevision = 0
    errorDetails = null
    images = Array.isArray(chat.images) ? chat.images : []
    provider = Protocol.normalizedProvider(chat.provider) || provider
    model = String(chat.model || "")
    pendingPermission = null
    state = "complete"
    statusMessage = ""
    answerChanged()
  }

  function applyProviders(raw) {
    providers = Protocol.normalizeProviders(raw)
    if (providers.length === 0) {
      state = "unavailable"
      statusMessage = "Sign in to Codex, Claude, or OpenCode to begin."
      errorDetails = Protocol.normalizedError({
        unavailable: true,
        code: "provider_unavailable",
        message: statusMessage,
        retryable: false
      })
      return
    }
    if (!providerAvailable(provider)) provider = providers[0].value
    selectProvider(provider)
  }

  function prependHistory(chat) {
    if (!chat || !chat.id) return
    var items = [chat]
    for (var i = 0; i < history.length && items.length < 30; i++) {
      if (String(history[i].id) !== String(chat.id)) items.push(history[i])
    }
    history = Protocol.normalizedHistory(items)
  }

  function applyEvent(event) {
    if (!event || !event.type) return
    var type = String(event.type)
    if (type === "ready") {
      if (!Protocol.isCompatibleEvent(event)) {
        initialized = false
        state = "unavailable"
        statusMessage = "OmaPilot protocol mismatch. Update the plugin and try again."
        errorDetails = Protocol.normalizedError({
          unavailable: true,
          code: "protocol_mismatch",
          message: statusMessage,
          retryable: false
        })
        return
      }
      initialized = true
      brokerDesktopContextSupported = Protocol.hasFeature(event.features, "desktop-context")
      applyProviders(event.providers || [])
      history = Protocol.normalizedHistory(event.history || [])
      if (providers.length > 0 && (state === "preparing" || state === "unavailable")) {
        state = "composing"
        statusMessage = ""
        errorDetails = null
      }
      return
    }
    if (type === "providers") {
      applyProviders(event.providers || [])
      return
    }
    if (type === "state") {
      if (event.id && currentId && String(event.id) !== currentId) return
      if (String(event.state || "") === "idle" && currentChatId !== "") {
        state = "complete"
        statusMessage = ""
        return
      }
      state = String(event.state || "") === "stopping" ? "stopping" : Protocol.normalizedState(event.state, state)
      statusMessage = String(event.message || "")
      if (state === "error" || state === "unavailable") errorDetails = Protocol.normalizedError({
        unavailable: state === "unavailable",
        code: String(event.code || "state_" + state),
        message: statusMessage,
        retryable: event.retryable === true
      })
      return
    }
    if (type === "content") {
      if (event.id && currentId && String(event.id) !== currentId) return
      answerMarkdown += String(event.delta || event.text || "")
      activityRevision++
      errorDetails = null
      state = "streaming"
      statusMessage = ""
      answerChanged()
      return
    }
    if (type === "permission") {
      var permission = Protocol.normalizedPermission(event.permission, currentId)
      if (!permission) return
      var queued = permissionQueue.slice()
      for (var permissionIndex = 0; permissionIndex < queued.length; permissionIndex++)
        if (String(queued[permissionIndex].id || "") === permission.id) return
      queued.push(permission)
      permissionQueue = queued
      if (!pendingPermission) pendingPermission = permission
      state = "streaming"
      statusMessage = "Waiting for tool approval…"
      return
    }
    if (type === "permission_closed") {
      if (String(event.id || "") !== currentId) return
      closePermission(event.permissionId)
      if (String(event.reason || "") === "expired")
        toastRequested("Tool approval expired")
      return
    }
    if (type === "image") {
      var eventId = String(event.id || "")
      var sourceUrl = String(event.image && event.image.sourceUrl || "")
      var isRemoteLoad = /^https:\/\//i.test(eventId) || /^https:\/\//i.test(sourceUrl)
      if (!isRemoteLoad && eventId && currentId && eventId !== currentId) return
      images = Protocol.mergeImageEvent(images, event, currentId)
      answerChanged()
      return
    }
    if (type === "complete") {
      if (event.id && currentId && String(event.id) !== currentId) return
      if (event.answer !== undefined) answerMarkdown = String(event.answer)
      if (event.chat) {
        currentChatId = String(event.chat.id || currentChatId)
        question = String(event.chat.question || question)
        answerMarkdown = String(event.chat.answer || event.chat.markdown || answerMarkdown)
        if (Array.isArray(event.chat.images)) images = event.chat.images
        prependHistory(event.chat)
      } else if (event.chatId) currentChatId = String(event.chatId)
      if (event.history) history = Protocol.normalizedHistory(event.history)
      state = "complete"
      errorDetails = null
      pendingPermission = null
      permissionQueue = []
      statusMessage = ""
      answerChanged()
      return
    }
    if (type === "error") {
      if (event.id && currentId && String(event.id) !== currentId) return
      if (!event.id && String(event.code || "").indexOf("image_") === 0) {
        toastRequested(String(event.message || "Could not load that image"))
        return
      }
      if (String(event.code || "").toLowerCase() === "cancelled") {
        state = "canceled"
        pendingPermission = null
        permissionQueue = []
        statusMessage = String(event.message || "Stopped")
        errorDetails = null
        answerChanged()
        return
      }
      state = event.unavailable === true ? "unavailable" : "error"
      pendingPermission = null
      permissionQueue = []
      statusMessage = String(event.message || "OmaPilot could not complete that request.")
      errorDetails = Protocol.normalizedError(event, statusMessage)
      return
    }
    if (type === "dictation") {
      var dictationState = String(event.state || "")
      transcript = String(event.text || transcript)
      if (dictationState === "recording") {
        dictationPhase = "recording"
        state = "dictating"
        statusMessage = "Listening…"
      } else if (dictationState === "transcribing") {
        dictationPhase = "transcribing"
        state = "preparing"
        statusMessage = "Transcribing…"
      } else if (dictationState === "idle" || dictationState === "complete" || dictationState === "canceled") {
        dictationPhase = ""
        state = "composing"
        statusMessage = ""
      } else if (dictationState === "unavailable" || dictationState === "error") {
        dictationPhase = ""
        state = "error"
        statusMessage = String(event.message || "Dictation is unavailable.")
        errorDetails = Protocol.normalizedError({
          code: "dictation_" + dictationState,
          message: statusMessage,
          retryable: dictationState === "unavailable",
          unavailable: dictationState === "unavailable"
        })
      }
      return
    }
    if (type === "history") {
      history = Protocol.normalizedHistory(event.items || event.history || [])
      return
    }
    if (type === "herdr") {
      var outcome = Protocol.herdrOutcome(event)
      if (!outcome) { console.warn("quickchat: unknown Herdr state " + String(event.state || "")); return }
      state = outcome.state
      statusMessage = outcome.message
      if (outcome.state === "error") errorDetails = Protocol.normalizedError({
        code: String(event.errorCode || "herdr_" + String(event.state || "failed")),
        message: statusMessage,
        retryable: true
      })
      if (outcome.toast) toastRequested(statusMessage)
      if (String(event.state || "") === "continued") herdrContinued()
      return
    }
    if (type === "copied") {
      toastRequested(event.copied === true ? "Copied" : "Could not copy")
      return
    }
    if (type === "link" && event.opened === false) {
      toastRequested("Could not open that link")
    }
  }

  IpcHandler {
    target: "io.github.spencerbull.quickchat"
    function open() { root.routeIpc("open") }
    function close() { root.routeIpc("close") }
    function show() { root.routeIpc("show") }
    function hide() { root.routeIpc("hide") }
    function toggle() { root.routeIpc("toggle") }
    function newChat() { root.routeIpc("newChat") }
    function history() { root.routeIpc("history") }
  }

  Process {
    id: broker
    command: [root.brokerPath]
    stdinEnabled: true
    running: true

    onStarted: {
      root.processStarted = true
      root.stderrTail = ""
      root.pendingPermission = null
      root.permissionQueue = []
      root.initialize()
      root.flushQueue()
    }

    onExited: function(exitCode, exitStatus) {
      root.processStarted = false
      root.initialized = false
      root.pendingPermission = null
      root.permissionQueue = []
      if (root.state !== "canceled") root.state = "unavailable"
      root.statusMessage = root.stderrTail || "OmaPilot is unavailable."
      root.errorDetails = Protocol.normalizedError({
        unavailable: true,
        code: "broker_unavailable",
        message: root.statusMessage,
        retryable: true
      })
    }

    stdout: SplitParser {
      onRead: function(line) {
        var event = Protocol.parseLine(line)
        if (event) root.applyEvent(event)
        else if (String(line || "").trim() !== "") console.warn("quickchat: invalid broker event")
      }
    }

    stderr: SplitParser {
      onRead: function(line) {
        var message = String(line || "").trim()
        if (message) root.stderrTail = message.slice(0, 240)
      }
    }
  }
}
