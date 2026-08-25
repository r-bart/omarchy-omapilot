import QtQuick

Item {
  id: root

  required property var list
  property var history: []
  property bool confirmingClear: false
  // A per-chat delete is armed on the current row. Unlike the clear-all
  // confirmation, which is answered on its own control, this one is answered
  // here: a second Delete confirms, and anything else backs out.
  property bool confirmingDelete: false

  signal chatSelected(var chat)
  signal deleteRequested(string chatId)
  signal closeRequested()
  signal confirmationCancelled()

  function handleKey(event) {
    if (event.modifiers !== Qt.NoModifier
        && event.modifiers !== Qt.KeypadModifier) return
    var directional = event.key === Qt.Key_Down || event.key === Qt.Key_J
      || event.key === Qt.Key_Up || event.key === Qt.Key_K
    var action = directional
      || event.key === Qt.Key_Return || event.key === Qt.Key_Enter
      || event.key === Qt.Key_Delete || event.key === Qt.Key_Escape
    if (root.confirmingClear && action) {
      if (event.key === Qt.Key_Escape) root.confirmationCancelled()
      event.accepted = true
    } else if (root.confirmingDelete && action) {
      // Two presses means two presses. Held past the repeat delay, the first
      // physical press armed the row and the first auto-repeat arrived here
      // and confirmed it — one finger on one key deleting a chat through a
      // confirmation designed to stop exactly that. Repeats are swallowed
      // while armed, so the answer has to come from a key that was released
      // and pressed again.
      if (event.isAutoRepeat) {
        event.accepted = true
        return
      }
      // One keystroke, one effect: Delete answers the question, everything
      // else withdraws it and stops there. Moving off the row with the arrows
      // would disarm anyway — doing it here as well means the keypress that
      // disarms never also selects or closes, so nothing happens by accident
      // while a destructive question is on screen.
      if (event.key === Qt.Key_Delete && root.list.currentIndex >= 0)
        root.deleteRequested(String(root.history[root.list.currentIndex].id))
      else root.confirmationCancelled()
      event.accepted = true
    } else if (event.key === Qt.Key_Down || event.key === Qt.Key_J) {
      root.list.currentIndex = Math.min(
        root.list.count - 1, root.list.currentIndex + 1)
      event.accepted = true
    } else if (event.key === Qt.Key_Up || event.key === Qt.Key_K) {
      root.list.currentIndex = Math.max(0, root.list.currentIndex - 1)
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      if (root.list.currentIndex >= 0)
        root.chatSelected(root.history[root.list.currentIndex])
      event.accepted = true
    } else if (event.key === Qt.Key_Delete && root.list.currentIndex >= 0) {
      root.deleteRequested(String(root.history[root.list.currentIndex].id))
      event.accepted = true
    } else if (event.key === Qt.Key_Escape) {
      root.closeRequested()
      event.accepted = true
    }
  }
}
