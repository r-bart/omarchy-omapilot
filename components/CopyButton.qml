import QtQuick
import qs.Commons
import qs.Ui

// Copy, with an answer.
//
// Writing to the clipboard is the one action in the console that leaves no
// trace: the button looks identical before and after, the text goes somewhere
// the user cannot see, and the only way to find out whether it worked is to
// paste somewhere and look. The reflex in between is to click again — which is
// harmless here and still tells the user nothing.
//
// So the glyph becomes a tick in the accent for a beat and then goes back. The
// button keeps its box and its size across the swap, because a confirmation
// that moves the row it lives in is a worse answer than none.
PanelActionButton {
  id: root

  // The text handed to `copyRequested`. Kept as a property rather than read
  // from the caller's closure so the tick and the payload cannot disagree.
  property string sourceText: ""
  property string idleTooltip: "Copy"
  property string doneTooltip: "Copied"

  // `foreground` is bound below, so callers set these two instead. Overwriting
  // `foreground` from outside would silently take the confirmation with it.
  property color idleForeground: Color.popups.text
  property color doneForeground: Color.accent

  readonly property bool copied: resetTimer.running

  signal copyRequested(string text)

  iconText: copied ? "󰄬" : "󰆏"
  tooltipText: copied ? doneTooltip : idleTooltip
  foreground: copied ? doneForeground : idleForeground
  focusable: true
  Accessible.name: tooltipText

  onClicked: {
    root.copyRequested(root.sourceText)
    resetTimer.restart()
  }

  // Long enough to be read after the eye comes back to the button, short
  // enough that a second copy of something else is never mistaken for the
  // first one's confirmation.
  Timer {
    id: resetTimer
    interval: 1500
  }
}
