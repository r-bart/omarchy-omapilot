import QtQuick
import QtTest
import "../components/internal" as QuickchatInternal

Item {
  id: root
  width: 640
  height: 420

  property bool confirmingClear: false

  ListView {
    id: historyList
    anchors.fill: parent
    model: 3
    activeFocusOnTab: true
    currentIndex: 0
    Keys.onPressed: function(event) { historyKeyboard.handleKey(event) }
    delegate: Rectangle { required property int index; width: 200; height: 40 }

    QuickchatInternal.HistoryListKeyboardHandler {
      id: historyKeyboard
      list: historyList
      confirmingClear: root.confirmingClear
    }
  }

  TestCase {
    name: "OmaPilotHistoryKeyboard"
    when: windowShown

    function test_confirmationKeepsListSelectionStable() {
      root.confirmingClear = false
      historyList.currentIndex = 0
      historyList.forceActiveFocus()
      wait(0)
      verify(historyList.activeFocus)
      compare(historyList.currentIndex, 0)

      keyClick(Qt.Key_Down)
      compare(historyList.currentIndex, 1)

      root.confirmingClear = true
      var guardedKeys = [Qt.Key_Up, Qt.Key_K, Qt.Key_Down, Qt.Key_J]
      for (var i = 0; i < guardedKeys.length; i++) {
        keyClick(guardedKeys[i])
        compare(historyList.currentIndex, 1)
        verify(historyList.activeFocus)
      }
    }
  }
}
