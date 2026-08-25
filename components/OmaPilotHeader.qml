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
  // Which surface is showing, so the row below can mark it. The header only
  // exists in the console, which is why the panel keeps its own copy of this
  // row in the composer — see Composer.qml.
  property string currentSurface: "console"
  property bool motionEnabled: true
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal settingsRequested()
  signal surfaceRequested(string name)

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
          // The first thing to go when the row is tight. Three surface buttons
          // and a gear plus this sentence do not fit the docked column, and at
          // 587px it was eliding to "Ready to help with this de…" — a decorative
          // line, half-said, crowding out the controls. The same flag that
          // stacks the meta below decides it.
          visible: !root.stackedMeta
          Layout.fillWidth: true
          text: "Ready to help with this desktop"
          color: Qt.darker(root.foreground, 1.45)
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          elide: Text.ElideRight
        }
      }

      // The three surfaces, beside the gear rather than down in the composer's
      // action row. This is the console's own chrome and it has the room; the
      // composer row had five glyphs and the switch was competing with the
      // microphone for a glance.
      Repeater {
        model: Protocol.surfaceOrder()

        PanelActionButton {
          readonly property string surfaceName: String(modelData)
          readonly property bool current: root.currentSurface === surfaceName

          iconText: Presentation.surfaceIcon(surfaceName)
          tooltipText: Presentation.surfaceTooltip(surfaceName)
          // The accent marks the current one. A border would, too, but the gear
          // beside it is already bordered and two borders read as one control.
          foreground: current ? root.accent : Qt.darker(root.foreground, 1.4)
          size: Style.space(34)
          focusable: true
          // Moving surfaces mid-turn would tear the answer out from under the
          // user; the settings dropdown holds the same line.
          enabled: root.backend && !root.backend.busy
          Accessible.name: current ? tooltipText + " (current)" : tooltipText
          onClicked: root.surfaceRequested(surfaceName)
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
          ? Protocol.harnessMeta(root.backend.provider, root.backend.model) : ""
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
