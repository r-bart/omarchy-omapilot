import QtQuick
import Quickshell
import "components" as OmaPilot

// Behavioral probe for the console's escape ladder: view dismissal before the
// close, cancelling a turn before either, and the hard rule that a pending
// approval turns Escape into a rejection instead of a dismissal.
//
// There is one ladder and one terminal step. A sixth rung used to sit above the
// close — hand the compositor's keyboard back and stay open — and only a
// layer-shell surface could do it: no protocol lets a real window unfocus
// itself. Both hosts are ordinary windows now, so Escape at rest closes, and
// the stages below say so from every lane it can be pressed in.
ShellRoot {
  id: root
  property bool failed: false
  property int stage: 0
  property int closeCount: 0

  function fail(message) {
    failed = true
    console.error("omapilot console escape probe failed: " + message)
  }

  QtObject {
    id: backendStub
    property bool initialized: true
    readonly property bool busy: state === "preparing" || state === "dictating"
      || state === "streaming" || state === "stopping"
    property bool canSubmit: true
    property bool providerReady: true
    property bool continuationBlocked: false
    property bool canRetry: false
    property bool contextCaptureAvailable: false
    property bool desktopContextActive: false
    property bool desktopContextEnabled: true
    property bool voiceEnabled: false
    property string state: "composing"
    property string statusMessage: ""
    property string provider: "builtin"
    property string model: ""
    property string question: ""
    property string answerMarkdown: ""
    property string transcript: ""
    property string currentChatId: ""
    property string webHandoffProvider: "duckduckgo"
    property string ttsProvider: "elevenlabs"
    property string ttsModel: ""
    property string ttsVoice: ""
    property var images: []
    property var history: []
    property var providers: [{ value: "builtin" }]
    property var modelOptions: []
    property var builtinAuthMethods: []
    property var builtinAuth: ({ phase: "idle", prompt: null })
    property bool builtinAuthBusy: false
    property var browserCompanionStatus: ({
      phase: "ready", relayInstalled: false, setupAvailable: false,
      chromiumConnected: false, firefoxConnected: false,
      chromiumExtensionPath: "", firefoxExtensionPath: "", message: ""
    })
    property bool browserCompanionConnected: false
    property bool browserCompanionBusy: false
    property var voxtypeOsd: ({ available: false, enabled: true, message: "" })
    property var voiceStatus: ({ dictation: { available: false, message: "" }, tts: [] })
    property var ttsTest: null
    property string ttsTestError: ""
    property var customProviders: []
    property var customProviderSaved: null
    property string customProviderError: ""
    property var customProviderTest: null
    property string customProviderTestError: ""
    property var capabilities: []
    property string capabilityError: ""
    property var contextAttachments: []
    property var pendingPermission: null
    property var errorDetails: null
    property string configuredSurface: "console"
    property int configuredSidebarWidth: 440
    property bool configuredDangerousAutoApprove: false
    property string configuredQuickActionsJson: ""
    property bool configuredShowSummarizeAction: false
    property bool configuredShowWorkInAppAction: false
    property int cancelCount: 0
    property string rejectedDecision: ""

    signal focusComposerRequested()

    function submit(text) { return true }
    function cancel() { cancelCount++ }
    function startDictation() {}
    function stopDictation() {}
    function retryBroker() {}
    function copyText(text) {}
    function activateLink(url) {}
    function newChat() {}
    function continueInHerdr() {}
    function requestHistory() {}
    function requestCustomProviders() {}
    function requestVoxtypeOsd() {}
    function requestVoiceStatus() {}
    function requestBrowserCompanionStatus() {}
    function requestSettingsPersist(values) {}
    function respondPermission(decision, choiceId) {
      rejectedDecision = decision
      pendingPermission = null
    }
    function hasPermissionDecision(decision) { return true }
    function permissionChoiceId(decision) { return "reject-once" }
    function permissionOptionsWithoutDenyOnce() { return [] }
  }

  OmaPilot.ConsoleContent {
    id: content
    width: 440
    height: 900
    backend: backendStub
    focused: true
    motionEnabled: false
    onCloseRequested: root.closeCount++
  }

  Timer {
    interval: 180
    running: true
    repeat: true
    onTriggered: {
      if (root.stage === 0) {
        // Focused and at rest: Escape closes. This is the rung that used to
        // release the keyboard instead, and the reason the probe exists.
        content.handleEscape()
        if (root.closeCount !== 1)
          root.fail("focused idle escape did not close")
      } else if (root.stage === 1) {
        // Unfocused, the same. The shortcut cannot fire without the keyboard,
        // but nothing in the ladder itself depends on holding it.
        content.focused = false
        content.handleEscape()
        if (root.closeCount !== 2)
          root.fail("unfocused escape did not close")
        content.focused = true
      } else if (root.stage === 2) {
        // A full-screen lane dismisses back to chat before anything else.
        content.openSettings()
        content.handleEscape()
        if (content.viewMode !== "chat" || root.closeCount !== 2)
          root.fail("settings escape did not return to chat")
      } else if (root.stage === 3) {
        // Busy outranks the close: Escape cancels the turn.
        backendStub.state = "streaming"
        content.handleEscape()
        if (backendStub.cancelCount !== 1 || root.closeCount !== 2)
          root.fail("busy escape did not cancel")
        backendStub.state = "composing"
      } else if (root.stage === 4) {
        // An approval pending behind another lane: the ladder unwinds to the
        // chat lane first, and nothing is rejected sight unseen.
        backendStub.pendingPermission = {
          id: "perm-1", title: "Run a shell command", detail: "true",
          options: [{ id: "reject-once", decision: "reject_once", label: "Reject" }]
        }
        content.openSettings()
        content.handleEscape()
        if (content.viewMode !== "chat" || backendStub.rejectedDecision !== "")
          root.fail("hidden approval escape rejected or stayed in settings")
      } else if (root.stage === 5) {
        // The hard rule: with the approval in front, Escape is the rejection
        // and nothing closes.
        content.handleEscape()
        if (backendStub.rejectedDecision !== "reject_once" || root.closeCount !== 2)
          root.fail("pending approval escape did not reject")
      } else if (root.stage === 6) {
        // And once answered, the ladder is ordinary again.
        backendStub.pendingPermission = null
        backendStub.rejectedDecision = ""
        content.handleEscape()
        if (root.closeCount !== 3)
          root.fail("escape after the approval did not close")
      } else {
        if (!root.failed) console.log("OMAPILOT_CONSOLE_ESCAPE_PROBE_OK")
        Qt.quit()
      }
      root.stage++
    }
  }
}
