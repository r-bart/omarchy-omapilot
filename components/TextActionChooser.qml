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
    // The keypad sends its own modifier and is still an unmodified digit,
    // which is how PanelKeyboardNavigation reads its own keys too.
    var plain = event.modifiers === Qt.NoModifier || event.modifiers === Qt.KeypadModifier
    if (!root.choosing || !root.ready || !plain) return
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
      spacing: Style.spacing.controlGap

      Repeater {
        model: TextActions.actions

        delegate: Button {
          required property var modelData
          readonly property string action: String(modelData.id || "")
          // Which one Enter runs. Not a hierarchy: these three are peers, and
          // the first version borrowed the primary/secondary contrast that
          // Replace and Regenerate use, where one action is the answer and the
          // other is a fallback. Here it left two of the three drawn as plain
          // dimmed words, so they read as unavailable rather than as choices.
          readonly property bool preferred: action === root.defaultAction
          readonly property string description: TextActions.questionLabel(action, "", root.language)
          width: Math.min(implicitWidth, chipFlow.width)
          text: TextActions.chipLabel(action, root.language)
          enabled: root.ready
          // Colour carries every state, so nothing here changes the metrics:
          // the row must not shuffle when the remembered action moves. The
          // shell's Button paints no disabled state of its own, so an
          // unavailable chip has to say so here or it looks live and does
          // nothing. The border colour follows the foreground, which is what
          // marks the preferred chip without giving it a shape of its own.
          foreground: !root.ready ? Qt.darker(root.foreground, 2.2)
            : preferred ? root.accent
            : root.foreground
          background: root.background
          accent: root.accent
          fontFamily: root.fontFamily
          // All three, so a chip looks like a chip before the cursor is on it.
          bordered: true
          focusable: true
          // The shell's control height is 32, under the 40 a desktop pointer
          // target wants. Three chips shown once per invocation can afford the
          // extra four pixels a side that a bar full of buttons cannot.
          verticalPadding: Style.spacing.controlPaddingY + Style.spacing.sm
          // No hover tip on a chip. Button draws one above the control, and
          // the control sits directly under the quote, so it covers the very
          // text being decided about. It also composes its background from the
          // theme background, which on this surface is the colour already
          // behind it, so it reads as text fading in over text. The chip is a
          // word and the composer below already asks the question; the long
          // form stays below, where it costs nothing.
          Accessible.name: description + (preferred ? " (Enter)" : "")
          onClicked: root.actionRequested(action)
        }
      }
    }
  }
}
