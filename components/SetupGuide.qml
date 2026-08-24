import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui

BorderSurface {
  id: root

  required property string stage
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  readonly property bool voiceStage: stage === "voice"
  readonly property string progressText: voiceStage ? "STEP 2 OF 3" : "STEP 3 OF 3"
  readonly property string titleText: voiceStage ? "Set up voice" : "Add global keybinds"
  readonly property string detailText: voiceStage
    ? "Enable voice and connect ElevenLabs for spoken replies. Listening uses Voxtype."
    : "Open Desktop settings, then press Install global hotkeys. Existing shortcut chords are preserved."
  readonly property string actionText: voiceStage ? "Set up voice" : "Open global keybinds"

  signal actionRequested()

  implicitHeight: content.implicitHeight + contentTopInset + contentBottomInset
    + Style.spacing.xl * 2
  color: Style.normalFillFor(root.foreground, root.accent)
  borderSpec: Border.controlSpec("normal", root.foreground, root.accent)
  radius: Style.cornerRadius
  Accessible.role: Accessible.Grouping
  Accessible.name: titleText + ". " + detailText

  ColumnLayout {
    id: content
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.leftMargin: parent.contentLeftInset + Style.spacing.xl
    anchors.rightMargin: parent.contentRightInset + Style.spacing.xl
    anchors.topMargin: parent.contentTopInset + Style.spacing.xl
    spacing: Style.spacing.md

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md

      Text {
        Layout.fillWidth: true
        text: "Finish setting up OmaPilot"
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
      }

      Text {
        text: root.progressText
        color: root.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
        font.letterSpacing: 0.7
      }
    }

    Text {
      Layout.fillWidth: true
      text: root.titleText
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.subtitle
      font.bold: true
      wrapMode: Text.Wrap
    }

    Text {
      Layout.fillWidth: true
      text: root.detailText
      color: Qt.darker(root.foreground, 1.35)
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.Wrap
    }

    Button {
      Layout.alignment: Qt.AlignLeft
      text: root.actionText
      iconText: root.voiceStage ? "󰍬" : "󰌌"
      foreground: root.foreground
      background: root.background
      accent: root.accent
      active: true
      bordered: true
      focusable: true
      Accessible.name: text
      onClicked: root.actionRequested()
    }
  }
}
