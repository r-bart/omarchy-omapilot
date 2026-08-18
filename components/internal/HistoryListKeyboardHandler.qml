import QtQuick

Item {
  id: root

  required property var list
  property var history: []
  property bool confirmingClear: false

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
