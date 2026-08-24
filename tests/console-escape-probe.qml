import QtQuick
import Quickshell
import "components" as OmaPilot

// Behavioral probe for the console's escape ladder: focus release before
// close, view dismissal before either, and the hard rule that a pending
// approval turns Escape into a rejection instead of a dismissal.
//
// The ladder is shared by two hosts that differ in one step. A surface that can
// hold the compositor's keyboard while staying open puts it down first; a real
// window has no keyboard to hand back — no protocol lets a client unfocus
// itself — so for that host the step is not skipped, it does not exist.
// `releasesFocus` is what separates them, and stages 0-5 below cover the host
// that releases while 6-7 cover the one that does not. Both are run against the
// same ConsoleContent, because that is the claim: one ladder, one component.
ShellRoot {
  id: root
  property bool failed: false
  property int stage: 0
  property int releaseCount: 0
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
    onReleaseFocusRequested: root.releaseCount++
    onCloseRequested: root.closeCount++
  }

  Timer {
    interval: 180
    running: true
    repeat: true
    onTriggered: {
      if (root.stage === 0) {
        // Focused and at rest: Escape releases the keyboard, nothing closes.
        content.handleEscape()
        if (root.releaseCount !== 1 || root.closeCount !== 0)
          root.fail("focused idle escape did not release focus")
      } else if (root.stage === 1) {
        // Unfocused: the same gesture closes the surface.
        content.focused = false
        content.handleEscape()
        if (root.closeCount !== 1 || root.releaseCount !== 1)
          root.fail("unfocused escape did not close")
        content.focused = true
      } else if (root.stage === 2) {
        // A full-screen lane dismisses back to chat before anything else.
        content.openSettings()
        content.handleEscape()
        if (content.viewMode !== "chat" || root.closeCount !== 1 || root.releaseCount !== 1)
          root.fail("settings escape did not return to chat")
      } else if (root.stage === 3) {
        // Busy outranks release: Escape cancels the turn.
        backendStub.state = "streaming"
        content.handleEscape()
        if (backendStub.cancelCount !== 1 || root.releaseCount !== 1)
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
        // The hard rule: with the approval in front, Escape is the rejection.
        content.handleEscape()
        if (backendStub.rejectedDecision !== "reject_once"
            || root.closeCount !== 1 || root.releaseCount !== 1)
          root.fail("pending approval escape did not reject")
      } else if (root.stage === 6) {
        // Same content, window host. The idle gesture that released the
        // keyboard in stage 0 closes instead, and releaseCount must not move:
        // a window that asked to be unfocused would be asking for something
        // the protocol cannot give it.
        backendStub.pendingPermission = null
        backendStub.rejectedDecision = ""
        content.releasesFocus = false
        content.handleEscape()
        if (root.closeCount !== 2 || root.releaseCount !== 1)
          root.fail("window-host idle escape did not close")
      } else if (root.stage === 7) {
        // The hard rule does not depend on the window type. An approval in
        // front is still answered rather than dismissed, so the close count
        // stays where stage 6 left it.
        backendStub.pendingPermission = {
          id: "perm-2", title: "Run a shell command", detail: "true",
          options: [{ id: "reject-once", decision: "reject_once", label: "Reject" }]
        }
        content.handleEscape()
        if (backendStub.rejectedDecision !== "reject_once" || root.closeCount !== 2)
          root.fail("window-host approval escape did not reject")
      } else {
        if (!root.failed) console.log("OMAPILOT_CONSOLE_ESCAPE_PROBE_OK")
        Qt.quit()
      }
      root.stage++
    }
  }
}
