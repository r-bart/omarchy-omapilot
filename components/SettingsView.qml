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
  readonly property bool popupOpen: providerPicker.popupOpen || modelPicker.popupOpen

  signal dangerousAutoApproveRequested(bool enabled)
  signal providerChanged(string provider)
  signal modelChanged(string provider, string model)
  signal quickActionsEdited(var actions)
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
            text: "Harness, permissions, and quick actions"
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
