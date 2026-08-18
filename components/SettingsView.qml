import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Protocol.js" as Protocol

Item {
  id: root

  required property var backend
  property bool dangerousAutoApprove: false
  property var quickActions: []
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  readonly property var modeProviders: backend ? backend.providers : []
  readonly property var browserCompanion: backend ? backend.browserCompanionStatus : ({})
  readonly property bool browserCompanionConnected: backend && backend.browserCompanionConnected
  readonly property bool browserCompanionBusy: backend && backend.browserCompanionBusy
  readonly property bool popupOpen: providerPicker.popupOpen || modelPicker.popupOpen

  signal dangerousAutoApproveRequested(bool enabled)
  signal providerChanged(string provider)
  signal modelChanged(string provider, string model)
  signal quickActionsEdited(var actions)
  signal browserCompanionInstallRequested()
  signal browserCompanionRefreshRequested()
  signal recentChatsRequested()
  signal dismissed()

  implicitHeight: settingsContent.implicitHeight

  function closePopups(restoreFocus) {
    providerPicker.close()
    modelPicker.close()
    if (restoreFocus !== false)
      Qt.callLater(function() { backButton.forceActiveFocus() })
  }

  function forceInitialFocus() {
    backButton.forceActiveFocus()
  }

  Flickable {
    id: settingsScroll
    anchors.fill: parent
    contentWidth: width
    contentHeight: settingsContent.implicitHeight
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    ColumnLayout {
      id: settingsContent
      width: settingsScroll.width
      spacing: Style.spacing.xxl

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.md

        PanelActionButton {
          id: backButton
          iconText: "󰁍"
          tooltipText: "Back to conversation"
          foreground: root.foreground
          focusable: true
          Accessible.name: tooltipText
          onClicked: root.dismissed()
        }

        ColumnLayout {
          Layout.fillWidth: true
          spacing: 0

          Text {
            text: "OmaPilot settings"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            font.bold: true
          }

          Text {
            text: "Harness, browser context, permissions, and quick actions"
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }

      BorderSurface {
        Layout.fillWidth: true
        implicitHeight: settingsFields.implicitHeight + contentTopInset + contentBottomInset + Style.spacing.xxl * 2
        color: Style.normalFillFor(root.foreground, root.accent)
        borderSpec: Border.controlSpec("normal", root.foreground, root.accent)
        radius: Style.cornerRadius

        ColumnLayout {
          id: settingsFields
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.top: parent.top
          anchors.leftMargin: parent.contentLeftInset + Style.spacing.xxl
          anchors.rightMargin: parent.contentRightInset + Style.spacing.xxl
          anchors.topMargin: parent.contentTopInset + Style.spacing.xxl
          spacing: Style.spacing.lg

          Text {
            Layout.fillWidth: true
            text: "Permissions"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Text {
            Layout.fillWidth: true
            text: root.dangerousAutoApprove
              ? "OmaPilot auto-approves each exact, inspectable device request."
              : "Device changes stay behind an exact, inspectable approval."
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          Toggle {
            Layout.fillWidth: true
            label: "Dangerous auto-approve"
            description: "Approve each exact device action automatically instead of prompting."
            checked: root.dangerousAutoApprove
            enabled: root.backend && !root.backend.busy
            foreground: root.foreground
            accent: checked ? Color.urgent : root.accent
            fontFamily: root.fontFamily
            Accessible.name: label
            onClicked: root.dangerousAutoApproveRequested(!root.dangerousAutoApprove)
          }

          Text {
            Layout.fillWidth: true
            visible: root.dangerousAutoApprove
            text: "Approval prompts are skipped. Commands may read, change, or delete device data and use the network."
            color: Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          PanelSeparator {
            Layout.fillWidth: true
            Layout.topMargin: Style.spacing.md
            foreground: root.foreground
          }

          Text {
            Layout.fillWidth: true
            text: "Browser context"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Text {
            Layout.fillWidth: true
            text: "Select semantic page elements and choose Element, Text, or Screenshot before sharing context."
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.spacing.md

            Rectangle {
              Layout.preferredWidth: Style.space(8)
              Layout.preferredHeight: Style.space(8)
              radius: width / 2
              color: root.browserCompanionConnected ? root.accent
                : (root.browserCompanion.phase === "failed" ? Color.urgent : Color.muted)
            }

            ColumnLayout {
              Layout.fillWidth: true
              spacing: 0

              Text {
                Layout.fillWidth: true
                text: root.browserCompanionBusy ? "Enabling browser context…"
                  : (root.browserCompanionConnected ? "Browser companion connected"
                    : (root.browserCompanion.relayInstalled === true
                      ? "Relay installed · browser restart required"
                      : "Browser companion is off"))
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
                wrapMode: Text.Wrap
              }

              Text {
                Layout.fillWidth: true
                text: root.browserCompanionConnected
                  ? "Use the OmaPilot extension icon once per site to grant page access."
                  : (root.browserCompanion.relayInstalled === true
                    ? "Restart Chromium, then pin the OmaPilot extension and enable the current site."
                    : "Enable the user-local relay and bundled unpacked extension, then restart your browser.")
                color: Qt.darker(root.foreground, 1.45)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.Wrap
                Accessible.role: Accessible.StaticText
                Accessible.name: text
              }
            }
          }

          Text {
            Layout.fillWidth: true
            visible: root.browserCompanion.phase === "failed"
            text: root.browserCompanion.message || "Browser companion setup failed."
            color: Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.spacing.md

            Button {
              Layout.fillWidth: true
              visible: !root.browserCompanionConnected
              iconText: "󰖟"
              text: root.browserCompanion.relayInstalled === true ? "Repair browser setup" : "Enable browser context"
              tooltipText: "Register the native relay and enable the bundled browser extension"
              foreground: root.foreground
              background: root.background
              accent: root.accent
              active: true
              bordered: true
              focusable: true
              enabled: root.backend && !root.browserCompanionBusy
                && root.browserCompanion.setupAvailable === true
              Accessible.name: tooltipText
              onClicked: root.browserCompanionInstallRequested()
            }

            Button {
              iconText: "󰑓"
              text: "Refresh"
              tooltipText: "Refresh browser companion status"
              foreground: root.foreground
              background: root.background
              bordered: true
              focusable: true
              enabled: root.backend && !root.browserCompanionBusy
              Accessible.name: tooltipText
              onClicked: root.browserCompanionRefreshRequested()
            }
          }

          Text {
            Layout.fillWidth: true
            visible: !root.browserCompanionConnected
            text: "This explicit setup registers a native-messaging host and adds an unpacked extension to detected Omarchy Chromium-family browser flags. Firefox and Zen still require loading the temporary Firefox build."
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          PanelSeparator {
            Layout.fillWidth: true
            Layout.topMargin: Style.spacing.md
            foreground: root.foreground
          }

          Text {
            Layout.fillWidth: true
            text: "Harness"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Dropdown {
            id: providerPicker
            Layout.fillWidth: true
            showLabel: false
            options: root.modeProviders
            value: root.backend ? root.backend.provider : ""
            enabled: root.backend && !root.backend.busy && root.modeProviders.length > 0
            foreground: root.foreground
            background: root.background
            Accessible.name: "AI harness"
            onChanged: function(value) { root.providerChanged(value) }
          }

          Text {
            Layout.fillWidth: true
            text: "Model"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Dropdown {
            id: modelPicker
            Layout.fillWidth: true
            showLabel: false
            options: root.backend && root.backend.modelOptions.length > 0
              ? root.backend.modelOptions
              : [{ value: "", label: "Harness default" }]
            value: root.backend ? root.backend.model : ""
            enabled: root.backend && !root.backend.busy
            foreground: root.foreground
            background: root.background
            Accessible.name: "AI model"
            onChanged: function(value) {
              root.backend.model = value
              root.modelChanged(root.backend.provider, value)
            }
          }

          Text {
            Layout.fillWidth: true
            visible: root.backend
            text: !root.backend ? "" : Protocol.providerPolicyDescription(root.backend.provider, root.backend.providerPolicy)
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          Text {
            Layout.fillWidth: true
            visible: root.backend && root.backend.modelOptions.length === 0
            text: "Using the harness default. This harness did not expose a model catalog."
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          PanelSeparator {
            Layout.fillWidth: true
            Layout.topMargin: Style.spacing.md
            foreground: root.foreground
          }

          Text {
            Layout.fillWidth: true
            text: "Quick actions"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Text {
            Layout.fillWidth: true
            text: "Add, edit, remove, or reorder the prompts shown on an empty conversation."
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          QuickActionEditor {
            Layout.fillWidth: true
            actions: root.quickActions
            foreground: root.foreground
            background: root.background
            accent: root.accent
            fontFamily: root.fontFamily
            onActionsEdited: function(actions) { root.quickActionsEdited(actions) }
          }

          PanelSeparator {
            Layout.fillWidth: true
            Layout.topMargin: Style.spacing.md
            foreground: root.foreground
          }

          Text {
            Layout.fillWidth: true
            text: "Conversation"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Button {
            Layout.fillWidth: true
            iconText: "󰋚"
            text: "Recent chats"
            tooltipText: "Browse up to 30 completed answers"
            foreground: root.foreground
            background: root.background
            bordered: true
            focusable: true
            Accessible.name: tooltipText
            onClicked: root.recentChatsRequested()
          }
        }
      }
    }
  }
}
