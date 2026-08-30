import QtQuick

// The fake backend the console probes drive, in one place.
//
// It is a plain QtObject with every property and method ConsoleContent and
// Console read, and counters for the four things worth asserting: turns
// cancelled, permissions rejected, and the desktop-context latch taken and
// released. Two probes exercise different halves of the same component against
// it, and keeping one copy is what stops those halves drifting apart.
QtObject {
  id: root
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
  property bool textActionActive: false
  property bool selectionReplacing: false
  property bool selectionChoosing: false
  readonly property bool textActionReady: !busy && !selectionReplacing
  property string selectionText: ""
  property string selectionAction: ""
  property string selectionInstruction: ""
  property string textActionLanguage: "English"
  property string textActionDefault: "fix"
  property int runTextActionCount: 0
  property bool runTextActionAccepted: true
  property string notice: ""
  property var installedHotkeys: []
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
  // The desktop-context latch: taken when the console opens, released when it
  // closes. Held past a close it would attach a desktop that no longer exists
  // to the next question, so both halves are counted.
  property int latchCount: 0
  property int unlatchCount: 0
  property int cancelCount: 0
  property int submitCount: 0
  property string lastSubmitted: ""
  property int newChatCount: 0
  property string rejectedDecision: ""

  signal focusComposerRequested()

  property int replaceCount: 0
  property int dismissCount: 0
  property int regenerateCount: 0

  function submit(text) { submitCount++; lastSubmitted = String(text || ""); return true }
  function cancel() { cancelCount++ }
  function startDictation() {}
  function stopDictation() {}
  function retryBroker() {}
  function copyText(text) {}
  function activateLink(url) {}
  function newChat() { newChatCount++ }
  function continueInHerdr() {}
  function requestHistory() {}
  function requestCustomProviders() {}
  function requestVoxtypeOsd() {}
  function requestVoiceStatus() {}
  function requestBrowserCompanionStatus() {}
  function requestSettingsPersist(values) {}
  function latchDesktopContext() { latchCount++ }
  function clearDesktopContextLatch() { unlatchCount++ }
  function respondPermission(decision, choiceId) {
    rejectedDecision = decision
    pendingPermission = null
  }
  function hasPermissionDecision(decision) { return true }
  function permissionChoiceId(decision) { return "reject-once" }
  function permissionOptionsWithoutDenyOnce() { return [] }
  function replaceSelectionWithAnswer() { replaceCount++ }
  function submitFromComposer(text) { return submit(text) }
  function runTextAction(action, instruction, language) {
    runTextActionCount++
    selectionAction = String(action || "")
    selectionInstruction = String(instruction || "")
    if (runTextActionAccepted) selectionChoosing = false
    return runTextActionAccepted
  }
  function dismissTextAction() { dismissCount++ }
  function regenerateTextAction() { regenerateCount++ }
}
