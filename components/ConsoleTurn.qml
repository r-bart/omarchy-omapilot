import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
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
// bubble and the markdown view is what keeps them looking like the same
// conversation rather than two components that happen to be stacked.
Item {
  id: root

  required property var backend
  required property var turn

  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal previewRequested(string source, string alt)

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
          anchors.margins: Style.space(10)
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

    OmaPilot.MarkdownView {
      Layout.fillWidth: true
      visible: String(root.turn.answer || "") !== ""
      markdown: String(root.turn.answer || "")
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

    // A finished turn can be read and copied, and that is all: retrying or
    // cancelling belongs to the turn that is still running.
    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md

      Item { Layout.fillWidth: true }

      PanelActionButton {
        iconText: "󰆏"
        tooltipText: "Copy answer"
        foreground: Qt.darker(root.foreground, 1.5)
        size: Style.space(26)
        focusable: true
        visible: String(root.turn.answer || "") !== ""
        Accessible.name: tooltipText
        onClicked: root.backend.copyText(String(root.turn.answer || ""))
      }
    }

    // The seam between turns. Quieter than the answer plate's own rule, because
    // it separates two things that are already separated by their shapes.
    Rectangle {
      Layout.fillWidth: true
      implicitHeight: 1
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.06)
    }
  }
}
