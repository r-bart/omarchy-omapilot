import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui

BorderSurface {
  id: root

  property string message: "OmaPilot could not complete that request."
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  signal detailsRequested()

  activeFocusOnTab: true
  Keys.onReturnPressed: root.detailsRequested()
  Keys.onEnterPressed: root.detailsRequested()
  Keys.onSpacePressed: root.detailsRequested()

  implicitHeight: content.implicitHeight + contentTopInset + contentBottomInset
    + Style.spacing.xl * 2
  color: Style.controlFill(activeFocus, pointer.containsMouse, Color.urgent, Color.urgent)
  borderSpec: Border.controlSpec(
    activeFocus ? "focus" : (pointer.containsMouse ? "hover-cursor" : "normal"),
    Color.urgent, Color.urgent)
  radius: Style.cornerRadius
  Accessible.role: Accessible.Button
  Accessible.name: "View error details: " + message

  Behavior on color { ColorAnimation { duration: 100 } }

  RowLayout {
    id: content
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.leftMargin: parent.contentLeftInset + Style.spacing.xl
    anchors.rightMargin: parent.contentRightInset + Style.spacing.xl
    anchors.topMargin: parent.contentTopInset + Style.spacing.xl
    spacing: Style.spacing.md

    Text {
      text: "󰅚"
      color: Color.urgent
      font.family: root.fontFamily
      font.pixelSize: Style.font.icon
      Layout.alignment: Qt.AlignTop
    }

    ColumnLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.xs

      Text {
        Layout.fillWidth: true
        text: root.message
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
        wrapMode: Text.Wrap
      }

      Text {
        Layout.fillWidth: true
        text: "View error details"
        color: Color.urgent
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Text {
      text: "󰅂"
      color: Color.urgent
      font.family: root.fontFamily
      font.pixelSize: Style.font.icon
      Layout.alignment: Qt.AlignVCenter
    }
  }

  MouseArea {
    id: pointer
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: {
      root.forceActiveFocus()
      root.detailsRequested()
    }
  }
}
