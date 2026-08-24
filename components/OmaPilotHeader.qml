import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Presentation.js" as Presentation
import "Protocol.js" as Protocol

Item {
  id: root

  required property var backend
  // At the console's 404px the approval notice starves the harness name to an
  // ellipsis — the part most worth reading. Stacked, each line gets the full
  // width. `false` keeps the panel's single meta row unchanged.
  property bool stackedMeta: false
  property bool dangerousAutoApprove: false
  property bool motionEnabled: true
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal settingsRequested()

  implicitHeight: headerContent.implicitHeight

  ColumnLayout {
    id: headerContent
    anchors.left: parent.left
    anchors.right: parent.right
    spacing: Style.spacing.md

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.lg

      OmaPilotMark {
        size: Style.space(42)
        foreground: root.foreground
        accent: root.accent
        fontFamily: root.fontFamily
        active: root.backend && root.backend.busy
        motionEnabled: root.motionEnabled
      }

      ColumnLayout {
        Layout.fillWidth: true
        spacing: 0

        Text {
          text: "OmaPilot"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.heading
          font.bold: true
        }

        Text {
          Layout.fillWidth: true
          text: "Ready to help with this desktop"
          color: Qt.darker(root.foreground, 1.45)
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          elide: Text.ElideRight
        }
      }

      PanelActionButton {
        iconText: "󰒓"
        tooltipText: "OmaPilot settings"
        foreground: root.foreground
        size: Style.space(34)
        bordered: true
        focusable: true
        Accessible.name: tooltipText
        onClicked: root.settingsRequested()
      }
    }

    // A grid with a conditional column count is one layout for both shapes:
    // two columns is exactly the old row, one column stacks the same children.
    GridLayout {
      Layout.fillWidth: true
      columns: root.stackedMeta ? 1 : 2
      columnSpacing: Style.spacing.md
      rowSpacing: Style.spacing.xs

      Text {
        Layout.fillWidth: true
        text: root.backend
          ? Protocol.providerLabel(root.backend.provider)
            + (root.backend.model ? " · " + root.backend.model : "")
          : ""
        color: Qt.darker(root.foreground, 1.55)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
        Accessible.role: Accessible.StaticText
        Accessible.name: text
      }

      Text {
        Layout.fillWidth: root.stackedMeta
        text: "\uebc1  " + Presentation.permissionNotice(root.dangerousAutoApprove)
        color: root.dangerousAutoApprove
          ? Color.urgent : Qt.darker(root.foreground, 1.45)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
        Accessible.role: Accessible.StaticText
        Accessible.name: Presentation.permissionNotice(root.dangerousAutoApprove)
      }
    }
  }
}
