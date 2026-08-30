import QtQuick
import QtQuick.Window
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui
import "components" as OmaPilot
import "components/QuickActions.js" as ActionCatalog
import "components/StatePhrases.js" as StatePhrases

ShellRoot {
  id: root
  readonly property string previewState: Quickshell.env("OMAPILOT_PREVIEW_STATE") || "empty"
  // Console states render ConsoleContent at the sidebar's own geometry.
  readonly property bool consoleState: previewState.indexOf("console-") === 0
  // Geometry overrides so one harness can render the same state at the wide
  // card size and at a narrow vertical width without editing the file.
  readonly property int previewWidth: Number(Quickshell.env("OMAPILOT_PREVIEW_WIDTH"))
    || (consoleState ? 440 : 860)
  readonly property int previewHeight: Number(Quickshell.env("OMAPILOT_PREVIEW_HEIGHT"))
    || (consoleState ? 900 : 0)
  readonly property bool holdOpen: Quickshell.env("OMAPILOT_PREVIEW_HOLD") === "1"
  readonly property int captureDelay: {
    const requested = Number(Quickshell.env("OMAPILOT_PREVIEW_DELAY"))
    return Number.isFinite(requested) && requested > 0 ? requested : 700
  }

  QtObject {
    id: backend
    property bool initialized: true
    property bool busy: false
    property bool canSubmit: true
    property bool providerReady: true
    property bool continuationBlocked: false
    property string continuationProvider: ""
    property bool canRetry: false
    property bool contextCaptureAvailable: true
    property bool desktopContextActive: false
    property string state: root.previewState === "waiting" ? "preparing"
      : (root.previewState === "streaming" || root.previewState === "console-streaming"
          || root.previewState === "console-permission" ? "streaming"
        : (root.previewState === "console-answer"
            || root.previewState === "console-thread" ? "complete"
          : (root.previewState === "error" || root.previewState === "error-details"
            ? "error" : "composing")))
    property string provider: "builtin"
    property string model: "openai-codex::gpt-5.4"
    property string transcript: ""
    property string statusMessage: root.previewState === "waiting" ? "Preparing Codex…"
      : (root.previewState === "error" || root.previewState === "error-details"
        ? "The harness stopped before completing the response." : "")
    property string question: root.previewState === "waiting"
      || root.previewState === "streaming"
      || root.previewState === "error"
      || root.previewState === "error-details"
      || root.previewState === "console-streaming"
      || root.previewState === "console-answer"
      || root.previewState === "console-permission"
      || root.previewState === "console-thread"
      ? "Find the current status and summarize what matters." : ""
    property string answerMarkdown: root.previewState === "console-answer"
      || root.previewState === "console-thread"
      ? "The **disk pressure** comes from three journal directories:\n\n"
        + "- `/var/log/journal` — 3.9 GB\n- `~/.cache/yay` — 2.2 GB\n"
        + "- `~/.local/share/Trash` — 1.4 GB\n\n"
        + "Running `journalctl --vacuum-size=500M` reclaims the largest share "
        + "without touching anything you have not already read." : ""
    property var images: []
    property string currentChatId: root.previewState === "console-answer" ? "chat-preview"
      : (root.previewState === "console-thread" ? "chat-live" : "")
    // Newest first, the order the store keeps. `console-thread` points
    // `currentChatId` at the newest of a shared `acpId`, which is what
    // `Protocol.threadBefore` walks back from — without an `acpId` there is no
    // thread and `console-answer` keeps rendering a single turn, unchanged.
    //
    // The harness changes partway down on purpose: per-turn provenance is only
    // worth painting if a thread can disagree with itself, and a preview where
    // every turn says the same thing would not show whether it works.
    property var history: [
      { id: "chat-live", acpId: "thread-1", title: "Reclaim the disk",
        provider: "builtin", model: "openai-codex::gpt-5.4",
        question: "Find the current status and summarize what matters.",
        answer: "", images: [], timestamp: "Today 14:06" },
      { id: "chat-2", acpId: "thread-1", title: "Draft a reply to this thread",
        provider: "codex", model: "gpt-5.4",
        question: "And which of those is safe to delete without asking me again?",
        answer: "Only `~/.local/share/Trash` — it is already a deletion you asked "
          + "for once.\n\nThe journal is a system log and `yay`'s cache is what makes "
          + "a rebuild fast, so both are worth a prompt.",
        images: [], timestamp: "Today 14:04" },
      { id: "chat-1", acpId: "thread-1", title: "Summarize the current window",
        provider: "builtin", model: "openai-codex::gpt-5.4",
        question: "What is taking up space on this machine?",
        answer: "Three directories account for most of it:\n\n"
          + "- `/var/log/journal` — 3.9 GB\n- `~/.cache/yay` — 2.2 GB\n"
          + "- `~/.local/share/Trash` — 1.4 GB",
        images: [], timestamp: "Today 14:03" }
    ]
    property string configuredSurface: "console"
    property int configuredSidebarWidth: 440
    property bool configuredDangerousAutoApprove: false
    property string configuredQuickActionsJson: ""
    property bool configuredShowSummarizeAction: true
    property bool configuredShowWorkInAppAction: true
    property var errorDetails: ({
      title: "Request failed",
      message: "The harness stopped before completing the response.",
      code: "provider_failed",
      retryable: true
    })
    property var pendingPermission: root.previewState === "console-permission" ? ({
      id: "perm-1",
      title: "Run a shell command",
      detail: "journalctl --vacuum-size=500M\n\nRequested by the builtin harness"
        + " with nonce 4f21c9. The command frees journal space and cannot touch"
        + " user files.",
      options: [
        { id: "allow-once", decision: "allow_once", label: "Allow once" },
        { id: "allow-session", decision: "allow_session", label: "Allow this session" },
        { id: "reject-once", decision: "reject_once", label: "Reject" }
      ]
    }) : null
    property var providers: [
      { value: "builtin", label: "Built-in", policy: { tools: "device-approval" } }
    ]
    property var modelOptions: [{ value: "openai-codex::gpt-5.4", label: "GPT-5.4 (openai-codex)" }]
    property var providerPolicy: ({ tools: "device-approval", web: "approved-command", hostReads: true })
    property var builtinAuthMethods: [
      { value: "openai-codex::oauth", label: "OpenAI (ChatGPT Plus/Pro)",
        description: "Use your OpenAI Codex subscription in OmaPilot." },
      { value: "openai::api_key", label: "OpenAI API key",
        description: "Store this credential only in OmaPilot's private configuration." },
      { value: "xai::oauth", label: "xAI (Grok/X subscription)",
        description: "Use your xAI subscription in OmaPilot." }
    ]
    property var customProviders: []
    property var customProviderSaved: null
    property string customProviderError: ""
    property var voxtypeOsd: ({ available: true, enabled: true, message: "" })
    property var voiceStatus: ({
      dictation: { available: true, message: "Voxtype is ready for dictation." },
      tts: [
        { id: "kokoro", name: "Kokoro", kind: "local", available: false, configured: false,
          message: "Kokoro is not installed.",
          models: [{ id: "kokoro-82m", name: "Kokoro 82M" }],
          voices: [{ id: "af_heart", name: "Heart (American female)" }] },
        { id: "elevenlabs", name: "ElevenLabs", kind: "cloud", available: false, configured: false,
          message: "Add an ElevenLabs API key to enable this provider.",
          models: [{ id: "eleven_multilingual_v2", name: "Multilingual v2" }],
          voices: [{ id: "wyWA56cQNU2KqUW4eCsI", name: "Clyde" }] },
        { id: "openai", name: "OpenAI", kind: "cloud", available: false, configured: false,
          message: "Add an OpenAI API key to enable this provider.",
          models: [{ id: "gpt-4o-mini-tts", name: "GPT-4o mini TTS" }],
          voices: [{ id: "coral", name: "Coral" }] }
      ]
    })
    property bool voiceStatusLoading: Quickshell.env("OMAPILOT_PREVIEW_VOICE_LOADING") === "1"
    property var ttsTest: null
    property string ttsTestError: ""
    property bool voiceEnabled: false
    property string ttsProvider: "elevenlabs"
    property string ttsModel: "eleven_multilingual_v2"
    property string ttsVoice: "wyWA56cQNU2KqUW4eCsI"
    property var browserCompanionStatus: ({
      phase: "ready", relayInstalled: false, setupAvailable: true,
      chromiumConnected: false, firefoxConnected: false,
      chromiumExtensionPath: "", firefoxExtensionPath: "", message: ""
    })
    property bool browserCompanionConnected: false
    property bool browserCompanionBusy: false
    property bool brokerCapabilityPacksSupported: true
    property string capabilityError: ""
    property var capabilities: [
      { id: "email", label: "Email", connector: "HEY", state: "ready", status: "Authenticated with HEY",
        enabled: true, description: "Read, search, and send email.", setupHint: "", operations: [
          { id: "search", label: "Search mail", risk: "inspect", available: true },
          { id: "send", label: "Send or reply", risk: "external_write", available: true }
        ] },
      { id: "calendar", label: "Calendar", connector: "HEY", state: "ready", status: "Authenticated with HEY",
        enabled: true, description: "Review events and manage personal to-dos.", setupHint: "", operations: [
          { id: "events", label: "Read events", risk: "inspect", available: true },
          { id: "todo_list", label: "Read to-dos", risk: "inspect", available: true },
          { id: "todo_create", label: "Create a to-do", risk: "external_write", available: true }
        ] },
      { id: "files", label: "Files", connector: "Local folder", state: "needs_configuration",
        status: "Choose a specific local or synced folder", enabled: true,
        description: "Work inside one explicitly selected folder.",
        setupHint: "Select a Dropbox folder or another bounded files root.", filesRoot: "", operations: [
          { id: "read", label: "Read text files", risk: "inspect", available: false },
          { id: "open", label: "Open a file", risk: "local_action", available: false }
        ] },
      { id: "projects", label: "Projects", connector: "Basecamp", state: "missing_connector",
        status: "Basecamp CLI is not installed", enabled: true, description: "Search and update Basecamp work.",
        setupHint: "Install the official basecamp-cli package, then run basecamp auth login.", operations: [] },
      { id: "messages", label: "Messages", connector: "Signal", state: "needs_setup",
        status: "Signal Desktop is not an automation connector", enabled: true,
        description: "Send Signal messages through a private bridge.",
        setupHint: "Pair a private signal-cli-rest-api service as a linked device.", operations: [] },
      { id: "meetings", label: "Meetings", connector: "Zoom", state: "ready",
        status: "Zoom links use the configured Omarchy handler", enabled: true,
        description: "Find and join Zoom meetings.", setupHint: "", operations: [
          { id: "join", label: "Join a Zoom meeting", risk: "local_action", available: true }
        ] }
    ]
    property var builtinAuth: ({ phase: "idle", flowId: "", methodId: "", message: "",
      url: "", verificationUri: "", userCode: "", prompt: null })
    property bool builtinAuthBusy: false
    property var contextAttachments: root.previewState === "context" ? [{
      id: "11111111-1111-4111-8111-111111111111",
      title: "Contextual cursor article",
      origin: { appId: "chromium", windowTitle: "OmaPilot design notes" },
      previewImage: { source: Qt.resolvedUrl("assets/omapilot-mark.png") },
      representations: [
        { id: "text", kind: "text", label: "Text", preview: "The magic comes from clipping the semantic object under the cursor.", confidence: 0.92 },
        { id: "image", kind: "image", label: "Screenshot", preview: "", confidence: 1 }
      ],
      selectedRepresentationIds: ["text"]
    }] : []

    signal focusComposerRequested()

    function submit(text) { return String(text || "").trim() !== "" }
    function selectProvider(value) { provider = String(value || "") }
    function startDictation() {}
    function stopDictation() {}
    function cancel() {}
    function retryBroker() {}
    function authenticateBuiltIn(methodId) {}
    function respondBuiltInAuth(value) {}
    function cancelBuiltInAuth() {}
    function activateLink(url) {}
    function copyText(text) {}
    function beginContextCapture() {}
    function setContextRepresentation(id, mode) {
      if (contextAttachments.length > 0) contextAttachments[0].selectedRepresentationIds = String(mode).split("+")
    }
    function removeContextAttachment(id) { contextAttachments = [] }
    function setCapabilityEnabled(id, enabled) {}
    function setCapabilityFilesRoot(path) {}
    function requestCapabilities() {}
    function respondPermission(decision, choiceId) {}
    function hasPermissionDecision(decision) { return true }
    function permissionChoiceId(decision) { return "reject-once" }
    function permissionOptionsWithoutDenyOnce() {
      return pendingPermission ? pendingPermission.options.filter(function(option) {
        return option.decision !== "reject_once"
      }) : []
    }
    function requestSettingsPersist(values) {}
    function requestHistory() {}
    function loadChat(chat) {}
    function deleteHistory(chatId) {}
    function clearHistory() {}
    function newChat() {}
    function continueInHerdr() {}
  }

  Window {
    id: previewWindow
    width: root.previewWidth
    height: root.previewHeight > 0 ? root.previewHeight
      : (root.previewState === "settings" || root.previewState === "skills-settings"
      || root.previewState === "voice-settings" || root.previewState === "desktop-settings"
      || root.previewState === "dangerous-settings"
      || root.previewState === "actions-settings" || root.previewState === "history" ? 760
      : (root.previewState === "error-details" ? 520
        : (root.previewState === "context" ? 430
          : (root.previewState === "setup-voice" || root.previewState === "setup-hotkeys" ? 420 : 320))))
    visible: true
    color: "transparent"
    flags: Qt.FramelessWindowHint
    title: "OmaPilot Visual Preview"

    BorderSurface {
      id: previewSurface
      anchors.fill: parent
      color: Color.popups.background
      borderSpec: Border.surfaceSpec(
        "popups", "border", Color.popups.border, Math.max(1, Style.normalBorderWidth))
      radius: Style.cornerRadius

      ColumnLayout {
        visible: root.previewState === "empty" || root.previewState === "dangerous"
          || root.previewState === "context" || root.previewState === "setup-voice"
          || root.previewState === "setup-hotkeys"
        anchors.fill: parent
        anchors.leftMargin: previewSurface.contentLeftInset + Style.spacing.popupPadding
        anchors.rightMargin: previewSurface.contentRightInset + Style.spacing.popupPadding
        anchors.topMargin: previewSurface.contentTopInset + Style.spacing.popupPadding
        anchors.bottomMargin: previewSurface.contentBottomInset + Style.spacing.popupPadding
        spacing: Style.spacing.lg

        OmaPilot.OmaPilotHeader {
          id: header
          Layout.fillWidth: true
          backend: backend
          dangerousAutoApprove: root.previewState === "dangerous"
          foreground: Color.popups.text
          background: Color.popups.background
          accent: Color.accent
          fontFamily: Style.font.family
        }

        OmaPilot.Composer {
          id: composer
          Layout.fillWidth: true
          backend: backend
          foreground: Color.popups.text
          background: Color.popups.background
          accent: Color.accent
          fontFamily: Style.font.family
        }

        OmaPilot.QuickActions {
          id: actions
          Layout.fillWidth: true
          visible: root.previewState !== "setup-voice" && root.previewState !== "setup-hotkeys"
          foreground: Color.popups.text
          background: Color.popups.background
          accent: Color.accent
          fontFamily: Style.font.family
        }

        OmaPilot.SetupGuide {
          Layout.fillWidth: true
          visible: root.previewState === "setup-voice" || root.previewState === "setup-hotkeys"
          stage: root.previewState === "setup-hotkeys" ? "hotkeys" : "voice"
          foreground: Color.popups.text
          background: Color.popups.background
          accent: Color.accent
          fontFamily: Style.font.family
        }
      }

      OmaPilot.SettingsView {
        id: settingsView
        visible: root.previewState === "settings"
          || root.previewState === "skills-settings"
          || root.previewState === "voice-settings"
          || root.previewState === "desktop-settings"
          || root.previewState === "dangerous-settings"
          || root.previewState === "actions-settings"
        anchors.fill: parent
        anchors.leftMargin: previewSurface.contentLeftInset + Style.spacing.popupPadding
        anchors.rightMargin: previewSurface.contentRightInset + Style.spacing.popupPadding
        anchors.topMargin: previewSurface.contentTopInset + Style.spacing.popupPadding
        anchors.bottomMargin: previewSurface.contentBottomInset + Style.spacing.popupPadding
        backend: backend
        selectedTab: root.previewState === "dangerous-settings" || root.previewState === "desktop-settings" ? "desktop"
          : (root.previewState === "skills-settings" ? "skills"
          : (root.previewState === "voice-settings" ? "voice"
          : (root.previewState === "actions-settings" ? "actions" : "agent")
          ))
        dangerousAutoApprove: root.previewState === "dangerous-settings"
        desktopContextEnabled: true
        voiceEnabled: false
        ttsProvider: "elevenlabs"
        ttsModel: "eleven_multilingual_v2"
        ttsVoice: "wyWA56cQNU2KqUW4eCsI"
        quickActions: root.previewState === "actions-settings"
          ? ActionCatalog.addAction(ActionCatalog.defaultActions(true, true),
            "Research this", "Research this topic using current sources.", 42)
          : ActionCatalog.defaultActions(true, true)
        foreground: Color.popups.text
        background: Color.popups.background
        accent: Color.accent
        fontFamily: Style.font.family
      }

      OmaPilot.HistoryView {
        id: historyView
        visible: root.previewState === "history"
        anchors.fill: parent
        anchors.leftMargin: previewSurface.contentLeftInset + Style.spacing.popupPadding
        anchors.rightMargin: previewSurface.contentRightInset + Style.spacing.popupPadding
        anchors.topMargin: previewSurface.contentTopInset + Style.spacing.popupPadding
        anchors.bottomMargin: previewSurface.contentBottomInset + Style.spacing.popupPadding
        history: [
          { id: "chat-1", title: "Summarize the current window", provider: "builtin",
            model: "gpt-5.4", timestamp: "Today 14:03" },
          { id: "chat-2", title: "Draft a reply to this thread", provider: "codex",
            model: "gpt-5.4", timestamp: "Today 11:40" },
          { id: "chat-3", title: "What is playing, and should I skip it?", provider: "opencode",
            model: "", timestamp: "Yesterday 19:12" }
        ]
        foreground: Color.popups.text
        background: Color.popups.background
        accent: Color.accent
        fontFamily: Style.font.family
      }

      ColumnLayout {
        id: responsePreview
        visible: root.previewState === "waiting"
          || root.previewState === "streaming"
          || root.previewState === "error"
        anchors.fill: parent
        anchors.leftMargin: previewSurface.contentLeftInset + Style.spacing.popupPadding
        anchors.rightMargin: previewSurface.contentRightInset + Style.spacing.popupPadding
        anchors.topMargin: previewSurface.contentTopInset + Style.spacing.popupPadding
        anchors.bottomMargin: previewSurface.contentBottomInset + Style.spacing.popupPadding
        spacing: Style.spacing.lg

        OmaPilot.OmaPilotHeader {
          Layout.fillWidth: true
          backend: backend
          foreground: Color.popups.text
          background: Color.popups.background
          accent: Color.accent
          fontFamily: Style.font.family
        }

        BorderSurface {
          id: responseSurface
          Layout.fillWidth: true
          Layout.fillHeight: true
          color: Style.normalFillFor(Color.popups.text, Color.accent)
          borderSpec: Border.controlSpec("normal", Color.popups.text, Color.accent)
          radius: Style.cornerRadius

          OmaPilot.ResponseActivityBorder {
            anchors.fill: parent
            z: 10
            active: root.previewState === "waiting" || root.previewState === "streaming"
            motionEnabled: true
            accent: Color.accent
            radius: responseSurface.radius
          }

          ColumnLayout {
            anchors.fill: parent
            anchors.margins: Style.spacing.xxl
            spacing: Style.spacing.lg

            RowLayout {
              Layout.fillWidth: true

              Text {
                Layout.fillWidth: true
                text: backend.question
                color: Qt.darker(Color.popups.text, 1.35)
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }

              Text {
                text: root.previewState === "waiting" || root.previewState === "streaming"
                  ? StatePhrases.thinkingAt(0) : backend.statusMessage
                color: Qt.darker(Color.popups.text, 1.25)
                font.family: Style.font.family
                font.pixelSize: Style.font.caption
                font.weight: Font.Medium
              }
            }

            OmaPilot.ErrorNotice {
              Layout.fillWidth: true
              visible: root.previewState === "error"
              message: backend.statusMessage
              foreground: Color.popups.text
              background: Color.popups.background
              accent: Color.accent
              fontFamily: Style.font.family
            }

            Text {
              Layout.fillWidth: true
              visible: root.previewState === "streaming"
              text: "I’m checking the latest available information and organizing the response…"
              color: Color.popups.text
              font.family: Style.font.family
              font.pixelSize: Style.font.body
              wrapMode: Text.Wrap
            }

            Item { Layout.fillHeight: true }
          }
        }
      }

      OmaPilot.ConsoleContent {
        id: consoleContent
        visible: root.consoleState
        anchors.fill: parent
        backend: backend
        focused: true
        viewMode: root.previewState === "console-history" ? "history"
          : (root.previewState === "console-settings" ? "settings" : "chat")
        foreground: Color.popups.text
        background: Color.popups.background
        accent: Color.accent
        fontFamily: Style.font.family
      }

      OmaPilot.ErrorDetailsView {
        id: errorDetailsView
        visible: root.previewState === "error-details"
        anchors.fill: parent
        anchors.leftMargin: previewSurface.contentLeftInset + Style.spacing.popupPadding
        anchors.rightMargin: previewSurface.contentRightInset + Style.spacing.popupPadding
        anchors.topMargin: previewSurface.contentTopInset + Style.spacing.popupPadding
        anchors.bottomMargin: previewSurface.contentBottomInset + Style.spacing.popupPadding
        backend: backend
        details: backend.errorDetails
        foreground: Color.popups.text
        background: Color.popups.background
        accent: Color.accent
        fontFamily: Style.font.family
      }
    }
  }

  Timer {
    interval: root.captureDelay
    running: true
    repeat: false
    onTriggered: {
      var invalidMain = (root.previewState === "empty" || root.previewState === "dangerous" || root.previewState === "context")
        && (header.implicitHeight <= 0 || composer.implicitHeight <= 0
          || actions.implicitHeight <= 0)
      var invalidSettings = (root.previewState === "settings"
          || root.previewState === "skills-settings"
          || root.previewState === "dangerous-settings"
          || root.previewState === "actions-settings")
        && settingsView.implicitHeight <= 0
      var invalidHistory = root.previewState === "history" && historyView.width <= 0
      var invalidResponse = (root.previewState === "waiting"
          || root.previewState === "streaming" || root.previewState === "error")
        && responsePreview.implicitHeight <= 0
      var invalidErrorDetails = root.previewState === "error-details"
        && errorDetailsView.implicitHeight <= 0
      var invalidConsole = root.consoleState && consoleContent.width <= 0
      if (invalidMain || invalidSettings || invalidHistory || invalidResponse
          || invalidErrorDetails || invalidConsole) {
        console.error("omapilot visual preview failed: invalid component geometry")
        Qt.quit()
        return
      }
      var output = Quickshell.env("OMAPILOT_PREVIEW_PATH")
      previewSurface.grabToImage(function(result) {
        if (!result || !result.saveToFile(output))
          console.error("omapilot visual preview failed: screenshot save")
        else console.log("OMAPILOT_PREVIEW_SAVED=" + output)
        if (!root.holdOpen) Qt.quit()
      }, Qt.size(previewSurface.width, previewSurface.height))
    }
  }
}
