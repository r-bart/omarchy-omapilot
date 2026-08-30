import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Protocol.js" as Protocol
import "." as OmaPilot

// One finished turn of the conversation, above the one being typed.
//
// The console is the deliberate surface, and until now it showed exactly one
// question and one answer — the same as the bar panel, in a column ten times
// as tall. This is what the height was for.
//
// It renders a past turn and not the live one on purpose. The live turn carries
// the activity border, the approval card, the retry and the rest of a turn that
// can still change; a finished one can only be read and copied. Sharing the
// bubble, the plate and the markdown view is what keeps them looking like the
// same conversation rather than two components that happen to be stacked.
//
// That sharing used to stop at the question. The bubble came here, the plate
// did not, on the reasoning that a plate exists to hold what only a live turn
// has — provenance, the Herdr handoff, retry. The reasoning was wrong: a plate
// is not a container for controls, it is the shape of an answer. Questions keep
// their bubble whether they are live or past, so a column of turns read bubble,
// loose text, bubble, loose text, and then one boxed answer at the bottom — the
// newest reply looking like a different kind of object from every reply above
// it. Now every answer wears the plate and only the live-turn controls are left
// out.
Item {
  id: root

  required property var backend
  required property var turn

  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal previewRequested(string source, string alt)

  readonly property string answerText: String(root.turn.answer || "")

  implicitHeight: layout.implicitHeight

  ColumnLayout {
    id: layout
    anchors.left: parent.left
    anchors.right: parent.right
    spacing: Style.space(10)

    // The user's turn: the same accent bubble the live turn uses, with the same
    // tail toward the composer it came from.
    Item {
      Layout.fillWidth: true
      implicitHeight: bubble.height
      visible: String(root.turn.question || "") !== ""

      Rectangle {
        id: bubble
        anchors.right: parent.right
        width: Math.min(bubbleText.implicitWidth + Style.space(28), parent.width * 0.86)
        height: bubbleText.implicitHeight + Style.space(20)
        radius: Style.space(10)
        bottomRightRadius: Style.space(4)
        color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.10)
        border.width: Style.normalBorderWidth
        border.color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.22)

        Text {
          id: bubbleText
          anchors.fill: parent
          // 14/14 and 10/10, matching the live bubble below exactly — the
          // width above reserves space(28) horizontally, so a flat margin of
          // 10 spent only 20 of it and left the remaining 8 stacked on the
          // right. Two bubbles in the same column, one padded evenly and the
          // one above it leaning left.
          anchors.leftMargin: Style.space(14)
          anchors.rightMargin: Style.space(14)
          anchors.topMargin: Style.space(10)
          anchors.bottomMargin: Style.space(10)
          text: String(root.turn.question || "")
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
          Accessible.role: Accessible.StaticText
          Accessible.name: text
        }
      }
    }

    // The answer plate, in the same tint, radius, border and padding as the
    // live one — deliberately not a second set of numbers, because the whole
    // point is that a reader cannot tell which answer is which by its shape.
    Rectangle {
      Layout.fillWidth: true
      visible: root.answerText !== ""
      implicitHeight: plateColumn.implicitHeight + Style.space(30)
      radius: Style.space(10)
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.035)
      border.width: Style.normalBorderWidth
      border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)

      ColumnLayout {
        id: plateColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: Style.space(14)
        anchors.rightMargin: Style.space(14)
        anchors.topMargin: Style.space(15)
        spacing: Style.spacing.lg

        OmaPilot.MarkdownView {
          Layout.fillWidth: true
          markdown: root.answerText
          images: Array.isArray(root.turn.images) ? root.turn.images : []
          foreground: root.foreground
          background: root.background
          accent: root.accent
          fontFamily: root.fontFamily
          onLinkActivated: function(url) { root.backend.activateLink(url) }
          onImageLoadRequested: function(image) {
            if (root.backend && typeof root.backend.requestImage === "function")
              root.backend.requestImage(image)
          }
          onImagePreviewRequested: function(source, alt) { root.previewRequested(source, alt) }
          onCopyRequested: function(text) { root.backend.copyText(text) }
        }

        // Per turn, not per conversation, and that is the point of showing it
        // at all: a thread can change harness or model partway through, and
        // the record carries what answered each turn. Same line, same tone and
        // same place as the live plate's.
        Text {
          Layout.fillWidth: true
          elide: Text.ElideRight
          visible: text !== ""
          text: {
            var provider = String(root.turn.provider || "")
            if (provider === "") return ""
            var model = String(root.turn.model || "")
            return Protocol.providerShortLabel(provider) + (model !== "" ? " · " + model : "")
          }
          color: Qt.darker(root.foreground, 1.4)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          Accessible.role: Accessible.StaticText
          Accessible.name: text
        }

        // A finished turn can be read and copied, and that is all: retrying,
        // cancelling and the Herdr handoff belong to the turn still running.
        // The button keeps the live plate's left-hand position rather than
        // drifting to the right just because it is alone on its row.
        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.md

          OmaPilot.CopyButton {
            idleTooltip: "Copy answer"
            doneTooltip: "Answer copied"
            sourceText: root.answerText
            idleForeground: Qt.darker(root.foreground, 1.4)
            doneForeground: root.accent
            onCopyRequested: function(text) { root.backend.copyText(text) }
          }

          Item { Layout.fillWidth: true }
        }
      }
    }
  }
}
