import QtQuick
import QtQuick.Controls
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

  signal actionRequested(string action, string instruction, string language)
  signal languageRequested(string language)

  property bool _languagePopupOpen: false
  property bool customExpanded: false
  property string customDraft: ""
  readonly property bool popupOpen: _languagePopupOpen
  readonly property bool customInputFocused: customEditor.activeFocus

  readonly property bool choosing: backend && backend.selectionChoosing === true
  readonly property string defaultAction: backend ? String(backend.textActionDefault || "fix") : "fix"
  readonly property string language: backend ? String(backend.textActionLanguage || "English") : "English"
  readonly property var languageOptions: {
    var values = ["English", "Spanish", "French", "German", "Italian", "Portuguese",
      "Catalan", "Dutch", "Polish", "Russian", "Arabic", "Chinese", "Japanese", "Korean"]
    if (values.indexOf(language) < 0) values.unshift(language)
    return values
  }
  readonly property bool ready: backend && backend.textActionReady === true

  function requestAction(action, instruction) {
    var id = TextActions.normalizedAction(action)
    if (!root.choosing || !root.ready || id === "") return false
    var ask = String(instruction === undefined ? "" : instruction).trim()
    if (id === "custom" && ask === "") return false
    root.actionRequested(id, ask, root.language)
    return true
  }

  function expandCustom() {
    if (!root.ready) return
    root.customExpanded = true
    Qt.callLater(function() { customEditor.forceActiveFocus() })
  }

  function collapseCustom() {
    if (!root.customExpanded) return false
    root.customExpanded = false
    Qt.callLater(function() { customDisclosure.forceActiveFocus() })
    return true
  }

  function closePopup() {
    for (var i = 0; i < actionsRepeater.count; i++) {
      var row = actionsRepeater.itemAt(i)
      if (row && typeof row.closePopup === "function") row.closePopup()
    }
  }

  visible: choosing
  implicitHeight: choosing ? column.implicitHeight : 0

  onChoosingChanged: if (!choosing) customExpanded = false

  Connections {
    target: root.backend
    function onTextActionActiveChanged() {
      if (root.backend && root.backend.textActionActive) return
      root.customExpanded = false
      root.customDraft = ""
    }
  }

  // Digits reach here from a focused chip, as keys the chip did not take. They
  // never arrive from the composer: there a digit is a digit, and a prompt
  // that starts with a number must not launch something instead.
  Keys.onPressed: function(event) {
    // The keypad sends its own modifier and is still an unmodified digit,
    // which is how PanelKeyboardNavigation reads its own keys too.
    var plain = event.modifiers === Qt.NoModifier || event.modifiers === Qt.KeypadModifier
    if (!root.choosing || !root.ready || root.customInputFocused || !plain) return
    var index = event.key - Qt.Key_1
    if (index < 0 || index >= TextActions.actions.length) return
    root.requestAction(String(TextActions.actions[index].id))
    event.accepted = true
  }

  ColumnLayout {
    id: column
    anchors.left: parent.left
    anchors.right: parent.right
    spacing: Style.spacing.md

    Rectangle {
      Layout.fillWidth: true
      implicitHeight: cardColumn.implicitHeight + Style.spacing.lg * 2
      radius: Style.cornerRadius
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.035)
      border.width: Style.normalBorderWidth
      border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.16)

      ColumnLayout {
        id: cardColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.leftMargin: Style.spacing.lg
        anchors.rightMargin: Style.spacing.lg
        spacing: Style.spacing.md

        Text {
          Layout.fillWidth: true
          text: "What do you want to do with this selection?"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          font.bold: true
          wrapMode: Text.Wrap
        }

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

        ColumnLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.xxs

          Repeater {
            id: actionsRepeater
            model: TextActions.actions

            delegate: Rectangle {
              required property var modelData
              required property int index
              readonly property string action: String(modelData.id || "")
          // Which one Enter runs. Not a hierarchy: these three are peers, and
          // the first version borrowed the primary/secondary contrast that
          // Replace and Regenerate use, where one action is the answer and the
          // other is a fallback. Here it left two of the three drawn as plain
          // dimmed words, so they read as unavailable rather than as choices.
              readonly property bool preferred: action === root.defaultAction
              readonly property string description: TextActions.questionLabel(action, "", root.language)
              readonly property color foreground: !root.ready
                ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.4)
                : preferred ? root.accent : root.foreground
              function closePopup() { languagePicker.close() }
              Layout.fillWidth: true
              implicitHeight: action === "translate" ? Style.space(58) : Style.space(52)
              radius: Style.cornerRadius
              color: rowHover.hovered || activeFocus
                ? Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.09)
                : "transparent"
              border.width: activeFocus ? Style.normalBorderWidth : 0
              border.color: root.accent
              enabled: root.ready
              activeFocusOnTab: action !== "translate"
          // Colour carries every state, so nothing here changes the metrics:
          // the row must not shuffle when the remembered action moves. The
          // shell's Button paints no disabled state of its own, so an
          // unavailable chip has to say so here or it looks live and does
          // nothing. The border colour follows the foreground, which is what
          // marks the preferred chip without giving it a shape of its own.
          //
          // Fading toward the surface, not toward black. `Qt.darker` is what
          // this file reaches for elsewhere, and it is wrong for a state that
          // has to recede: on a light theme it walks dark text further from
          // the background, so the chip that cannot be pressed would be drawn
          // stronger than the ones that can. Measured on this theme pair:
          // contrast 15.4 -> 3.4 on dark, and 16.2 -> 18.2 on light.
              RowLayout {
                anchors.fill: parent
                anchors.leftMargin: Style.spacing.md
                anchors.rightMargin: Style.spacing.md
                spacing: Style.spacing.md

                Text {
                  Layout.preferredWidth: Style.space(24)
                  text: action === "fix" ? "✓" : action === "rewrite" ? "↗" : "文"
                  color: root.accent
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  horizontalAlignment: Text.AlignHCenter
                }

                ColumnLayout {
                  Layout.fillWidth: true
                  spacing: 0
                  Text {
                    Layout.fillWidth: true
                    text: action === "fix" ? "Fix" : action === "rewrite" ? "Rewrite" : "Translate"
                    color: parent.parent.parent.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                  }
                  Text {
                    Layout.fillWidth: true
                    text: action === "fix" ? "Grammar and syntax, without changing the tone"
                      : action === "rewrite" ? "Clearer, while preserving the meaning"
                      : "Choose the destination language"
                    color: Qt.darker(root.foreground, 1.35)
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }

                Dropdown {
                  id: languagePicker
                  visible: action === "translate"
                  Layout.preferredWidth: Style.space(132)
                  showLabel: false
                  options: root.languageOptions
                  value: root.language
                  enabled: root.ready
                  foreground: root.foreground
                  background: root.background
                  accent: root.accent
                  Accessible.name: "Translate to"
                  onPopupOpenChanged: root._languagePopupOpen = popupOpen
                  onChanged: function(value) { root.languageRequested(value) }
                }

                Button {
                  visible: action === "translate"
                  text: "Run"
                  enabled: root.ready
                  foreground: root.foreground
                  background: root.background
                  accent: root.accent
                  bordered: true
                  focusable: true
                  Accessible.name: "Translate to " + root.language
                  onClicked: root.requestAction("translate", "")
                }

                Text {
                  visible: action !== "translate"
                  text: String(index + 1)
                  color: Qt.darker(root.foreground, 1.65)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }
          // No hover tip on a chip. Button draws one above the control, and
          // the control sits directly under the quote, so it covers the very
          // text being decided about. It also composes its background from the
          // theme background, which on this surface is the colour already
          // behind it, so it reads as text fading in over text. The chip is a
          // word and the composer below already asks the question; the long
          // form stays below, where it costs nothing.
              HoverHandler { id: rowHover }
              TapHandler {
                enabled: action !== "translate"
                onTapped: root.requestAction(action)
              }
              Keys.onPressed: function(event) {
                if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter
                    || event.key === Qt.Key_Space)) {
                  root.requestAction(action)
                  event.accepted = true
                }
              }
              Accessible.role: action === "translate" ? Accessible.Grouping : Accessible.Button
              Accessible.name: description + (preferred ? " (Enter)" : "")
            }
          }

          Rectangle {
            id: customRow
            readonly property color rowForeground: root.ready ? root.foreground
              : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.4)
            Layout.fillWidth: true
            implicitHeight: customColumn.implicitHeight + Style.spacing.md * 2
            radius: Style.cornerRadius
            color: customHover.hovered || customDisclosure.activeFocus
              ? Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.09)
              : "transparent"
            border.width: customDisclosure.activeFocus ? Style.normalBorderWidth : 0
            border.color: root.accent

            ColumnLayout {
              id: customColumn
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.leftMargin: Style.spacing.md
              anchors.rightMargin: Style.spacing.md
              spacing: Style.spacing.md

              Item {
                id: customDisclosure
                Layout.fillWidth: true
                implicitHeight: Style.space(44)
                activeFocusOnTab: true
                enabled: root.ready
                Accessible.role: Accessible.Button
                Accessible.name: "Custom instruction"
                Accessible.expanded: root.customExpanded

                RowLayout {
                  anchors.fill: parent
                  spacing: Style.spacing.md

                  Text {
                    Layout.preferredWidth: Style.space(24)
                    text: "󰅂"
                    color: root.ready ? root.accent : customRow.rowForeground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    horizontalAlignment: Text.AlignHCenter
                  }

                  ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    Text {
                      Layout.fillWidth: true
                      text: "Custom instruction"
                      color: customRow.rowForeground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                    }
                    Text {
                      Layout.fillWidth: true
                      text: "Describe another transformation"
                      color: Qt.darker(root.foreground, 1.35)
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }

                  Text {
                    text: root.customExpanded ? "󰅃" : "󰅀"
                    color: Qt.darker(root.foreground, 1.2)
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                  }
                }

                HoverHandler { id: customHover }
                TapHandler {
                  onTapped: root.customExpanded ? root.collapseCustom() : root.expandCustom()
                }
                Keys.onPressed: function(event) {
                  if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter
                      || event.key === Qt.Key_Space) {
                    root.customExpanded ? root.collapseCustom() : root.expandCustom()
                    event.accepted = true
                  }
                }
              }

              ColumnLayout {
                Layout.fillWidth: true
                visible: root.customExpanded
                spacing: Style.spacing.sm

                Text {
                  Layout.fillWidth: true
                  text: "Instruction"
                  color: Qt.darker(root.foreground, 1.2)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                }

                Rectangle {
                  Layout.fillWidth: true
                  implicitHeight: Style.space(92)
                  radius: Math.max(0, Style.cornerRadius - Style.spacing.sm)
                  color: root.background
                  border.width: Style.normalBorderWidth
                  border.color: customEditor.activeFocus ? root.accent
                    : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.18)

                  TextArea {
                    id: customEditor
                    anchors.fill: parent
                    anchors.margins: Style.spacing.sm
                    text: root.customDraft
                    enabled: root.ready
                    placeholderText: "Make it more formal…"
                    color: root.foreground
                    placeholderTextColor: Qt.darker(root.foreground, 1.6)
                    selectionColor: Style.selectionFillFor(root.foreground, root.accent)
                    selectedTextColor: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: TextEdit.Wrap
                    background: null
                    padding: 0
                    Accessible.name: "Instruction"
                    onTextChanged: if (root.customDraft !== text) root.customDraft = text
                    Keys.onPressed: function(event) {
                      var submitModifier = event.modifiers & (Qt.ControlModifier | Qt.MetaModifier)
                      if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                          && submitModifier) {
                        if (root.requestAction("custom", text)) event.accepted = true
                      } else if (event.key === Qt.Key_Escape) {
                        root.collapseCustom()
                        event.accepted = true
                      }
                    }
                  }
                }

                RowLayout {
                  Layout.fillWidth: true
                  Item { Layout.fillWidth: true }
                  Button {
                    text: "Run instruction"
                    enabled: root.ready && root.customDraft.trim() !== ""
                    foreground: root.accent
                    background: root.background
                    accent: root.accent
                    bordered: true
                    focusable: true
                    verticalPadding: Style.spacing.controlPaddingY + Style.spacing.sm
                    Accessible.name: "Run custom instruction"
                    onClicked: root.requestAction("custom", root.customDraft)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
