import QtQuick
import QtQuick.Window
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui
import "components" as OmaPilot
import "components/QuickActions.js" as ActionCatalog

ShellRoot {
  id: root
  readonly property string previewState: Quickshell.env("OMAPILOT_PREVIEW_STATE") || "empty"

  QtObject {
    id: backend
    property bool initialized: true
    property bool busy: false
    property bool canSubmit: true
    property bool canRetry: false
    property string state: root.previewState === "waiting" ? "preparing"
      : (root.previewState === "streaming" ? "streaming"
        : (root.previewState === "error" || root.previewState === "error-details"
          ? "error" : "composing"))
    property string provider: "codex"
    property string model: "gpt-5.4"
    property string transcript: ""
    property string statusMessage: root.previewState === "waiting" ? "Preparing Codex…"
      : (root.previewState === "error" || root.previewState === "error-details"
        ? "The harness stopped before completing the response." : "")
    property string question: root.previewState === "waiting"
      || root.previewState === "streaming"
      || root.previewState === "error"
      || root.previewState === "error-details"
      ? "Find the current status and summarize what matters." : ""
    property int activityRevision: root.previewState === "streaming" ? 4 : 0
    property var errorDetails: ({
      title: "Request failed",
      message: "The harness stopped before completing the response.",
      code: "provider_failed",
      retryable: true
    })
    property var pendingPermission: null
    property var providers: [
      { value: "codex", label: "Codex", policy: { tools: "device-approval" } },
      { value: "claude", label: "Claude", policy: { tools: "device-approval" } },
      { value: "opencode", label: "OpenCode", policy: { tools: "device-approval" } }
    ]
    property var modelOptions: [{ value: "gpt-5.4", label: "gpt-5.4" }]
    property var providerPolicy: ({ tools: "device-approval", web: "approved-command", hostReads: true })

    signal focusComposerRequested()

    function submit(text) { return String(text || "").trim() !== "" }
    function selectProvider(value) { provider = String(value || "") }
    function startDictation() {}
    function stopDictation() {}
    function cancel() {}
    function retryBroker() {}
    function copyText(text) {}
  }

  Window {
    id: previewWindow
    width: 860
    height: root.previewState === "settings" || root.previewState === "dangerous-settings"
      || root.previewState === "actions-settings" ? 760
      : (root.previewState === "error-details" ? 520 : 320)
    visible: true
    color: "transparent"
    flags: Qt.FramelessWindowHint

    BorderSurface {
      id: previewSurface
      anchors.fill: parent
      color: Color.popups.background
      borderSpec: Border.surfaceSpec(
        "popups", "border", Color.popups.border, Math.max(1, Style.normalBorderWidth))
      radius: Style.cornerRadius

      ColumnLayout {
        visible: root.previewState === "empty" || root.previewState === "dangerous"
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
          foreground: Color.popups.text
          background: Color.popups.background
          accent: Color.accent
          fontFamily: Style.font.family
        }
      }

      OmaPilot.SettingsView {
        id: settingsView
        visible: root.previewState === "settings"
          || root.previewState === "dangerous-settings"
          || root.previewState === "actions-settings"
        anchors.fill: parent
        anchors.leftMargin: previewSurface.contentLeftInset + Style.spacing.popupPadding
        anchors.rightMargin: previewSurface.contentRightInset + Style.spacing.popupPadding
        anchors.topMargin: previewSurface.contentTopInset + Style.spacing.popupPadding
        anchors.bottomMargin: previewSurface.contentBottomInset + Style.spacing.popupPadding
        backend: backend
        dangerousAutoApprove: root.previewState === "dangerous-settings"
        quickActions: root.previewState === "actions-settings"
          ? ActionCatalog.addAction(ActionCatalog.defaultActions(true, true),
            "Research this", "Research this topic using current sources.", 42)
          : ActionCatalog.defaultActions(true, true)
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
          Layout.fillWidth: true
          Layout.fillHeight: true
          color: Style.normalFillFor(Color.popups.text, Color.accent)
          borderSpec: Border.controlSpec("normal", Color.popups.text, Color.accent)
          radius: Style.cornerRadius

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

              OmaPilot.WaitingIndicator {
                active: root.previewState === "waiting" || root.previewState === "streaming"
                streaming: root.previewState === "streaming"
                activityRevision: backend.activityRevision
                message: streaming ? "Receiving response…" : backend.statusMessage
                foreground: Color.popups.text
                accent: Color.accent
                fontFamily: Style.font.family
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
    interval: 700
    running: true
    repeat: false
    onTriggered: {
      var invalidMain = (root.previewState === "empty" || root.previewState === "dangerous")
        && (header.implicitHeight <= 0 || composer.implicitHeight <= 0
          || actions.implicitHeight <= 0)
      var invalidSettings = (root.previewState === "settings"
          || root.previewState === "dangerous-settings"
          || root.previewState === "actions-settings")
        && settingsView.implicitHeight <= 0
      var invalidResponse = (root.previewState === "waiting"
          || root.previewState === "streaming" || root.previewState === "error")
        && responsePreview.implicitHeight <= 0
      var invalidErrorDetails = root.previewState === "error-details"
        && errorDetailsView.implicitHeight <= 0
      if (invalidMain || invalidSettings || invalidResponse || invalidErrorDetails) {
        console.error("omapilot visual preview failed: invalid component geometry")
        Qt.quit()
        return
      }
      var output = Quickshell.env("OMAPILOT_PREVIEW_PATH")
      previewSurface.grabToImage(function(result) {
        if (!result || !result.saveToFile(output))
          console.error("omapilot visual preview failed: screenshot save")
        else console.log("OMAPILOT_PREVIEW_SAVED=" + output)
        Qt.quit()
      }, Qt.size(previewSurface.width, previewSurface.height))
    }
  }
}
