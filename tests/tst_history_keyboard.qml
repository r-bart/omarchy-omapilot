import QtQuick
import QtTest
import "../components/internal" as OmaPilotInternal

Item {
  id: root
  width: 640
  height: 420

  property bool confirmingClear: false
  property var historyItems: [
    { id: "chat-1", title: "First" },
    { id: "chat-2", title: "Second" },
    { id: "chat-3", title: "Third" }
  ]
  property int selectedCount: 0
  property string selectedChatId: ""
  property int deletedCount: 0
  property string deletedChatId: ""
  property int closeCount: 0
  property int cancelledCount: 0

  ListView {
    id: historyList
    anchors.fill: parent
    model: root.historyItems
    activeFocusOnTab: true
    currentIndex: 0
    Keys.onPressed: function(event) { historyKeyboard.handleKey(event) }
    delegate: Rectangle { required property int index; width: 200; height: 40 }

    OmaPilotInternal.HistoryListKeyboardHandler {
      id: historyKeyboard
      list: historyList
      history: root.historyItems
      confirmingClear: root.confirmingClear
      onChatSelected: function(chat) {
        root.selectedCount += 1
        root.selectedChatId = String(chat.id || "")
      }
      onDeleteRequested: function(chatId) {
        root.deletedCount += 1
        root.deletedChatId = chatId
      }
      onCloseRequested: root.closeCount += 1
      onConfirmationCancelled: {
        root.cancelledCount += 1
        root.confirmingClear = false
      }
    }
  }

  TestCase {
    name: "OmaPilotHistoryKeyboard"
    when: windowShown

    function init() {
      root.confirmingClear = false
      root.selectedCount = 0
      root.selectedChatId = ""
      root.deletedCount = 0
      root.deletedChatId = ""
      root.closeCount = 0
      root.cancelledCount = 0
      historyList.currentIndex = 0
      historyList.forceActiveFocus()
      wait(0)
      verify(historyList.activeFocus)
    }

    function test_confirmationKeepsListSelectionStable() {
      compare(historyList.currentIndex, 0)

      keyClick(Qt.Key_Down)
      compare(historyList.currentIndex, 1)

      root.confirmingClear = true
      var guardedKeys = [
        Qt.Key_Up, Qt.Key_K, Qt.Key_Down, Qt.Key_J,
        Qt.Key_Return, Qt.Key_Enter, Qt.Key_Delete
      ]
      for (var i = 0; i < guardedKeys.length; i++) {
        keyClick(guardedKeys[i])
        compare(historyList.currentIndex, 1)
        verify(historyList.activeFocus)
        compare(root.selectedCount, 0)
        compare(root.deletedCount, 0)
        compare(root.closeCount, 0)
      }

      keyClick(Qt.Key_Escape)
      compare(root.cancelledCount, 1)
      verify(!root.confirmingClear)
      compare(root.closeCount, 0)
    }

    function test_keypadModifierRemainsSupported() {
      var event = {
        key: Qt.Key_Down,
        modifiers: Qt.KeypadModifier,
        accepted: false
      }
      historyKeyboard.handleKey(event)
      verify(event.accepted)
      compare(historyList.currentIndex, 1)
    }

    function test_modifiedKeysRemainUnacceptedAndInert() {
      historyList.currentIndex = 1
      var modifiedKeys = [
        Qt.Key_Up, Qt.Key_Down, Qt.Key_J, Qt.Key_K,
        Qt.Key_Return, Qt.Key_Enter, Qt.Key_Delete, Qt.Key_Escape
      ]
      var modifiedStates = [
        Qt.ShiftModifier, Qt.ControlModifier, Qt.AltModifier,
        Qt.ControlModifier | Qt.ShiftModifier
      ]
      for (var m = 0; m < modifiedStates.length; m++) {
        for (var i = 0; i < modifiedKeys.length; i++) {
          var event = {
            key: modifiedKeys[i],
            modifiers: modifiedStates[m],
            accepted: false
          }
          historyKeyboard.handleKey(event)
          verify(!event.accepted)
          compare(historyList.currentIndex, 1)
          compare(root.selectedCount, 0)
          compare(root.deletedCount, 0)
          compare(root.closeCount, 0)
        }
      }
    }

    function test_plainActionKeysEmitExactSignals() {
      keyClick(Qt.Key_Down)
      compare(historyList.currentIndex, 1)

      keyClick(Qt.Key_Return)
      compare(root.selectedCount, 1)
      compare(root.selectedChatId, "chat-2")

      keyClick(Qt.Key_Enter)
      compare(root.selectedCount, 2)
      compare(root.selectedChatId, "chat-2")

      keyClick(Qt.Key_Delete)
      compare(root.deletedCount, 1)
      compare(root.deletedChatId, "chat-2")

      keyClick(Qt.Key_Escape)
      compare(root.closeCount, 1)
    }
  }
}
