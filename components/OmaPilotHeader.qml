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
  signal historyRequested()

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

      // An explicit spacer, not `Layout.fillWidth` on the title column. A
      // nested layout only stretches if one of its own children stretches, so
      // the column stopped taking the slack the moment the tagline went hidden
      // and the whole cluster bunched up against the title.
      Item { Layout.fillWidth: true }

      // Everything that is a control, in one cluster hard against the right
      // edge: the three surfaces first, then the two lanes. Spread across the
      // header they read as decoration between the title and the gear.
      Row {
        Layout.alignment: Qt.AlignRight | Qt.AlignVCenter
        spacing: Style.spacing.xs

        Repeater {
          model: Protocol.surfaceOrder()

          PanelActionButton {
            readonly property string surfaceName: String(modelData)
            readonly property bool current: root.currentSurface === surfaceName

            iconText: Presentation.surfaceIcon(surfaceName)
            tooltipText: Presentation.surfaceTooltip(surfaceName)
            // The accent marks the current one. A border would, too, but the
            // gear beside it is already bordered and two borders read as one
            // control.
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
      }

      // The two lanes you enter and leave. Settings has always had a button
      // here; history had only a keyboard hint and a line of small print, which
      // is a strange asymmetry for the lane that holds every past conversation.
      PanelActionButton {
        iconText: "󰋚"
        tooltipText: "History"
        foreground: root.foreground
        size: Style.space(34)
        bordered: true
        focusable: true
        Accessible.name: tooltipText
        onClicked: root.historyRequested()
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

    // Identity used to sit here as static text. It is a choice, not a label —
    // which harness and which model answer the next question — so it lives in
    // the console footer as two pickers, and this row keeps the one thing that
    // is genuinely just a statement.
    Text {
      Layout.fillWidth: true
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
