import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import qs.Commons
import "components" as OmaPilot

// OmaPilot's ambient overlay root.
//
// This is the plugin's `overlay` entry point, and because the manifest sets
// `keepLoaded`, Omarchy keeps it live from shell start. It owns every desktop
// surface: the voice node, the answer curtain, and the pre-existing explicit
// context-capture overlay.
//
// It is the orchestrator, not a view. The node and the curtain are presentational
// and receive a derived phase; all state derivation, dictation handoff, and
// dismissal policy live here.
Item {
  id: root

  // Injected by the host's panel/overlay loader.
  property var shell: null
  property var manifest: null
  property string omarchyPath: ""
  property var pluginRegistry: null
  property var barWidgetRegistry: null

  readonly property string pluginId: (manifest && manifest.id)
    || "io.github.spencerbull.omapilot"

  // Quattro and Qt 6.11 expose no system reduced-motion preference. Keep motion
  // injectable so a future host signal or setting can switch it off.
  property bool motionEnabled: true

  // ------------------------------------------------------------ placement
  // The output Hyprland has focused — where the user actually is. Every surface
  // follows it, so the light lands on the screen being worked on. Hyprland
  // reports nothing briefly at startup, so fall back rather than render nowhere;
  // this mirrors the caveat the first-party bar documents.
  readonly property string focusedScreenName:
    Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name || "") : ""
  readonly property var activeScreen: {
    var screens = Quickshell.screens || []
    for (var i = 0; i < screens.length; i++)
      if (String(screens[i].name || "") === root.focusedScreenName) return screens[i]
    return screens.length > 0 ? screens[0] : null
  }

  // ------------------------------------------------------------- settings
  // The overlay loader injects `shell`, `manifest`, `pluginRegistry`, and
  // `barWidgetRegistry`, but *not* `settings` — that is a bar-widget-only
  // injection. An overlay-only plugin is enabled by an entry in `shell.json`
  // `plugins[]`, so read our own entry from there and keep writing through
  // `shell.updateEntryInline`, which already has a `plugins[]` branch.
  // Null, not {}, when there is no `plugins[]` entry. That distinction matters
  // during the staged migration: while the bar widget still exists the plugin is
  // enabled through `bar.layout`, the bar widget owns settings injection, and
  // configuring the store from an empty object here would reset the user's
  // provider and model to defaults on every shell load.
  readonly property var ownSettings: {
    var config = root.shell ? root.shell.shellConfig : null
    if (!config || !Array.isArray(config.plugins)) return null
    for (var i = 0; i < config.plugins.length; i++) {
      var entry = config.plugins[i]
      if (entry && String(entry.id || "") === root.pluginId) return entry
    }
    return null
  }

  function persistSettings(values) {
    var entry = { id: root.pluginId }
    for (var existing in root.ownSettings)
      if (existing !== "id") entry[existing] = root.ownSettings[existing]
    for (var key in values) entry[key] = values[key]
    if (root.shell && typeof root.shell.updateEntryInline === "function")
      root.shell.updateEntryInline(root.pluginId, entry)
  }

  // Only claim settings authority once we actually own an entry, so the bar
  // widget stays authoritative until it is removed.
  function applyOwnSettings() {
    if (!root.ownSettings) return
    OmaPilot.QuickchatStore.configure(root.ownSettings)
  }

  onOwnSettingsChanged: applyOwnSettings()
  Component.onCompleted: {
    applyOwnSettings()
    storeState = OmaPilot.QuickchatStore.state
  }

  // ---------------------------------------------------------------- phase
  // Keep an imperative mirror instead of a binding to the singleton's `state`.
  // The overlay's own derived phase feeds surfaces that participate in shell
  // loading, which made a direct cross-singleton binding loop during updates.
  property string storeState: ""
  readonly property bool hasAnswer: OmaPilot.QuickchatStore.answerMarkdown !== ""
    || OmaPilot.QuickchatStore.images.length > 0
  readonly property bool failed: storeState === "error" || storeState === "unavailable"

  Connections {
    target: OmaPilot.QuickchatStore
    function onStateChanged() { root.storeState = OmaPilot.QuickchatStore.state }
  }

  // True from the moment a voice turn is armed until its answer is dismissed.
  // Without this the node would light up for panel-initiated turns too, which
  // would make the ambient layer noisy rather than intentional.
  property bool voiceEngaged: false

  readonly property bool curtainShown:
    voiceEngaged && (failed || hasAnswer)

  readonly property string phase: {
    if (!voiceEngaged) return "dormant"
    if (voiceNotice !== "") return "error"
    if (failed) return "error"
    if (storeState === "dictating") return "listening"
    if (storeState === "preparing" || storeState === "streaming") return "thinking"
    if (storeState === "complete") return "answering"
    return "dormant"
  }

  // The caption shows the live transcript while listening, and nothing after —
  // once the curtain carries the question, repeating it below is noise.
  readonly property string captionText: voiceNotice !== "" ? voiceNotice
    : (phase === "listening" ? OmaPilot.QuickchatStore.transcript : "")

  // Shown under the caption while listening. Without it the only way to learn
  // how to finish is to be told, and the surface deliberately has no controls.
  readonly property string captionHint:
    phase === "listening" ? "Super+A to send \u00b7 Super+Alt+X to cancel" : ""

  // ---------------------------------------------------------- voice control
  // Set while a talk gesture is waiting for a preempted turn to unwind.
  property bool voiceStartPending: false
  // Why the node is lit in its error state, shown as the caption.
  property string voiceNotice: ""

  function voiceStart() {
    // Holding the talk key is an unambiguous "I am speaking now". The first
    // version bailed out whenever the store was busy and still answered "ok" to
    // IPC, so a held key during an in-flight turn did nothing at all, with no
    // feedback — indistinguishable from the feature being broken.
    if (OmaPilot.QuickchatStore.state === "dictating") return "already listening"

    voiceNotice = ""
    voiceEngaged = true

    if (!OmaPilot.QuickchatStore.voiceEnabled) {
      voiceNotice = "Enable voice in OmaPilot Settings"
      return "disabled"
    }

    if (!OmaPilot.QuickchatStore.initialized) {
      // Light the node instead of failing invisibly, so a hotkey press always
      // produces something on screen.
      voiceNotice = OmaPilot.QuickchatStore.statusMessage !== ""
        ? OmaPilot.QuickchatStore.statusMessage
        : "OmaPilot is not ready yet"
      return "not ready"
    }

    if (!OmaPilot.QuickchatStore.providerReady || OmaPilot.QuickchatStore.continuationBlocked) {
      voiceNotice = OmaPilot.QuickchatStore.statusMessage !== ""
        ? OmaPilot.QuickchatStore.statusMessage
        : "Choose an available harness in OmaPilot Settings"
      return "not ready"
    }

    OmaPilot.QuickchatStore.latchDesktopContext()

    if (OmaPilot.QuickchatStore.busy) {
      // Dictation cannot start while the broker is mid-response, and the broker
      // clears busy asynchronously, so arm the start and let the state change
      // below run it once the previous turn has unwound.
      voiceStartPending = true
      OmaPilot.QuickchatStore.cancel()
      return "preempting"
    }

    if (!OmaPilot.QuickchatStore.startDictation()) {
      voiceNotice = OmaPilot.QuickchatStore.statusMessage !== ""
        ? OmaPilot.QuickchatStore.statusMessage : "Voice input is not available right now"
      return "not ready"
    }
    return "listening"
  }

  function voiceStop() {
    if (OmaPilot.QuickchatStore.state !== "dictating") return
    OmaPilot.QuickchatStore.stopDictation()
  }

  // Toggle is the default gesture because nothing can detect end-of-speech for
  // us: Voxtype's VAD only discards silence-only recordings before
  // transcription, it never ends a recording. So the user has to say when they
  // are done, and holding a key through a whole sentence is worse than tapping
  // twice. `voiceStart`/`voiceStop` remain separately bindable for anyone who
  // prefers true push-to-talk.
  function voiceToggle() {
    if (OmaPilot.QuickchatStore.state === "dictating") {
      OmaPilot.QuickchatStore.stopDictation()
      return "finishing"
    }
    return voiceStart()
  }

  function voiceCancel() {
    OmaPilot.QuickchatStore.cancel()
    dismiss()
  }

  function dismiss() {
    voiceStartPending = false
    voiceNotice = ""
    // Releasing the surfaces must also release the microphone. Dismissing while
    // dictation is still live would leave a hot mic with no indicator on screen,
    // which is the one failure mode an invisible ambient layer must never have.
    if (OmaPilot.QuickchatStore.state === "dictating")
      OmaPilot.QuickchatStore.cancel()
    voiceEngaged = false
    OmaPilot.QuickchatStore.clearDesktopContextLatch()
  }

  // Dictation ends in "composing" with the transcript populated. In the voice
  // flow that is the submit signal: the user already spoke their intent, so
  // making them confirm it in a text box would defeat the gesture.
  onStoreStateChanged: {
    if (voiceStartPending && !OmaPilot.QuickchatStore.busy) {
      voiceStartPending = false
      if (voiceEngaged && !OmaPilot.QuickchatStore.startDictation()) {
        voiceNotice = OmaPilot.QuickchatStore.statusMessage !== ""
          ? OmaPilot.QuickchatStore.statusMessage : "Voice input is not available right now"
      }
      return
    }
    if (!voiceEngaged) return
    if (storeState !== "composing") return
    var spoken = String(OmaPilot.QuickchatStore.transcript || "").trim()
    if (spoken === "") { dismiss(); return }
    if (!OmaPilot.QuickchatStore.submit(spoken)) {
      voiceNotice = OmaPilot.QuickchatStore.statusMessage !== ""
        ? OmaPilot.QuickchatStore.statusMessage : "The selected harness cannot accept this request"
    }
  }

  // ------------------------------------------------------------- dismissal
  // Scaled to how much there is to read rather than a flat timeout, because a
  // fixed delay eats a long answer mid-sentence. Roughly 240ms per word over a
  // floor, clamped so a one-liner still lingers and an essay cannot camp on the
  // desktop.
  readonly property int dismissDelay: {
    var words = String(OmaPilot.QuickchatStore.answerMarkdown || "")
      .split(/\s+/).filter(function(w) { return w !== "" }).length
    return Math.max(6000, Math.min(40000, 4500 + words * 240))
  }

  // A "not ready" notice is transient feedback, not a failure to act on, so it
  // clears itself rather than leaving the node lit indefinitely.
  Timer {
    id: noticeTimer
    interval: 4000
    repeat: false
    running: root.voiceNotice !== ""
    onTriggered: root.dismiss()
  }

  Timer {
    id: dismissTimer
    interval: root.dismissDelay
    repeat: false
    // Only armed once the answer has settled, so streaming never races it.
    // Errors stay until dismissed: a failure the user missed is worse than a
    // surface that lingers.
    running: root.phase === "answering"
    onTriggered: root.dismiss()
  }

  // ------------------------------------------------------------------- IPC
  // The voice gesture cannot be a surface keybinding, because the ambient
  // surfaces never take keyboard focus by design. It has to arrive over IPC from
  // a compositor binding. Hyprland 0.56's `hl.bind` supports `long_press` and
  // `release`, so one key carries hold-to-talk and tap-for-panel.
  IpcHandler {
    target: "io.github.spencerbull.omapilot"
    function voiceStart(): string {
      var result = root.voiceStart()
      return result ? String(result) : "listening"
    }
    function voiceStop(): string { root.voiceStop(); return "ok" }
    function voiceToggle(): string {
      var result = root.voiceToggle()
      return result ? String(result) : "ok"
    }
    function voiceCancel(): string { root.voiceCancel(); return "ok" }
    function dismiss(): string { root.dismiss(); return "ok" }
    function status(): string {
      return "phase=" + root.phase
        + " store=" + root.storeState
        + " screen=" + (root.activeScreen ? root.activeScreen.name : "none")
        + " dismissMs=" + root.dismissDelay
    }
  }

  // --------------------------------------------------------------- surfaces
  OmaPilot.VoiceNode {
    phase: root.phase
    transcript: root.captionText
    hint: root.captionHint
    targetScreen: root.activeScreen
    motionEnabled: root.motionEnabled
  }

  OmaPilot.AnswerCurtain {
    shown: root.curtainShown
    question: OmaPilot.QuickchatStore.question
    markdown: OmaPilot.QuickchatStore.answerMarkdown
    images: OmaPilot.QuickchatStore.images
    failed: root.failed
    provenance: root.failed
      ? String(OmaPilot.QuickchatStore.statusMessage || "could not answer")
      : (OmaPilot.QuickchatStore.provider
         + (OmaPilot.QuickchatStore.model !== "" ? " · " + OmaPilot.QuickchatStore.model : ""))
    targetScreen: root.activeScreen
    motionEnabled: root.motionEnabled
    onLinkActivated: function(url) { OmaPilot.QuickchatStore.activateLink(url) }
  }

  // The explicit context-capture overlay is unchanged and still owns the
  // host's summon payload contract.
  ContextCaptureOverlay {
    id: capture
    shell: root.shell
    manifest: root.manifest
  }

  // Host contract: `shell.summon(id, payload)` calls open() and `shell.hide(id)`
  // calls close(). Context capture is the only flow that carries a payload, so
  // route a payload-bearing summon to it and treat a bare summon as a dismissal
  // of the ambient surfaces.
  function open(payloadJson) {
    var payload = {}
    try { payload = JSON.parse(String(payloadJson || "{}")) || {} } catch (error) { payload = {} }
    if (payload && payload.id) {
      capture.open(payloadJson)
      return
    }
    dismiss()
  }

  function close() {
    capture.close()
    dismiss()
  }

  readonly property bool opened: capture.opened === true || root.voiceEngaged
}
