import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "TextActions.js" as TextActions

// What the selection can become, offered before anything is sent.
//
// It shows the text the user selected and the three presets that can be run on
// it. The fourth action, a free prompt, is the composer below and has no chip
// here, because it is whatever the user types rather than a fixed thing.
//
// This emits which preset was picked and nothing else. What that runs, and
// what gets remembered, belongs to the store: a component that decides is a
// second place to keep the same rule, and both surfaces instantiate this one.
Item {
  id: root

  required property var backend
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal actionRequested(string action)

  readonly property bool choosing: backend && backend.selectionChoosing === true
  readonly property string defaultAction: backend ? String(backend.textActionDefault || "fix") : "fix"
  readonly property string language: backend ? String(backend.textActionLanguage || "English") : "English"
  readonly property bool ready: backend && backend.textActionReady === true

  visible: choosing
  implicitHeight: choosing ? column.implicitHeight : 0

  // Digits reach here from a focused chip, as keys the chip did not take. They
  // never arrive from the composer: there a digit is a digit, and a prompt
  // that starts with a number must not launch something instead.
  Keys.onPressed: function(event) {
    if (!root.choosing || !root.ready || event.modifiers !== Qt.NoModifier) return
    var index = event.key - Qt.Key_1
    if (index < 0 || index >= TextActions.actions.length) return
    root.actionRequested(String(TextActions.actions[index].id))
    event.accepted = true
  }

  ColumnLayout {
    id: column
    anchors.left: parent.left
    anchors.right: parent.right
    spacing: Style.spacing.md

    // The selection, quoted. Not editable: what a replacement is typed over is
    // the text still sitting in the other window, so an edited copy here would
    // be pasted across something it no longer matches. Six lines because the
    // selection can be eight thousand characters and this is a reminder of
    // what is about to be worked on, not a place to read it.
    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md

      Rectangle {
        Layout.preferredWidth: Style.space(3)
        Layout.fillHeight: true
        radius: width / 2
        color: root.accent
      }

      Text {
        Layout.fillWidth: true
        text: root.backend ? String(root.backend.selectionText || "") : ""
        color: Qt.darker(root.foreground, 1.2)
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        wrapMode: Text.Wrap
        maximumLineCount: 6
        elide: Text.ElideRight
        Accessible.role: Accessible.StaticText
        Accessible.name: "Selected text: " + text
      }
    }

    Flow {
      id: chipFlow
      Layout.fillWidth: true
      Layout.preferredHeight: chipFlow.implicitHeight
      spacing: Style.spacing.md

      Repeater {
        model: TextActions.actions

        delegate: Button {
          required property var modelData
          readonly property string action: String(modelData.id || "")
          // The one Enter runs wears the same weight Replace does; the others
          // are the quiet pair, like Regenerate. No new state, the contrast
          // that already means primary and secondary here.
          readonly property bool preferred: action === root.defaultAction
          width: Math.min(implicitWidth, chipFlow.width)
          text: TextActions.chipLabel(action, root.language)
          tooltipText: preferred ? text + " (Enter)" : text
          enabled: root.ready
          foreground: preferred ? root.foreground : Qt.darker(root.foreground, 1.4)
          background: root.background
          accent: root.accent
          fontFamily: root.fontFamily
          bordered: preferred
          focusable: true
          Accessible.name: tooltipText
          onClicked: root.actionRequested(action)
        }
      }
    }
  }
}
