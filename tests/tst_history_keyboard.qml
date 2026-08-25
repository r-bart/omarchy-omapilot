import QtQuick
import QtTest
import "../components/internal" as OmaPilotInternal

Item {
  id: root
  width: 640
  height: 420

  property bool confirmingClear: false
  property bool confirmingDelete: false
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
      confirmingDelete: root.confirmingDelete
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
      root.confirmingDelete = false
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

    // Deleting one chat is irreversible — the record, its images and its Pi
    // session all go — so Delete arms first and deletes second, the same two
    // steps "Clear all" has always taken. The view owns the arming; what the
    // handler owes is that a second Delete gets through, and that no other key
    // does anything except withdraw the question.
    //
    // Said plainly: only the second of these two discriminates. Deleting the
    // armed row passes with the armed branch removed as well, because Delete
    // then falls through to the idle path and emits the same signal. It is a
    // regression guard, not evidence.
    function test_armedDeleteConfirmsOnSecondDelete() {
      root.confirmingDelete = true
      keyClick(Qt.Key_Delete)
      compare(root.deletedCount, 1)
      compare(root.deletedChatId, "chat-1")
      compare(root.cancelledCount, 0)
    }

    function test_armedDeleteWithdrawsOnAnythingElse() {
      var withdrawing = [
        Qt.Key_Escape, Qt.Key_Down, Qt.Key_Up, Qt.Key_J, Qt.Key_K,
        Qt.Key_Return, Qt.Key_Enter
      ]
      for (var i = 0; i < withdrawing.length; i++) {
        root.confirmingDelete = true
        historyList.currentIndex = 1
        var event = { key: withdrawing[i], modifiers: Qt.NoModifier, accepted: false }
        historyKeyboard.handleKey(event)
        verify(event.accepted)
        compare(root.cancelledCount, i + 1)
        // The keypress that withdraws does nothing else: it does not move the
        // cursor off the row, open the chat, or close the view.
        compare(historyList.currentIndex, 1)
        compare(root.deletedCount, 0)
        compare(root.selectedCount, 0)
        compare(root.closeCount, 0)
      }
    }

    // Two presses means two presses. Held past the repeat delay, the first
    // physical press arms and the first auto-repeat used to arrive armed and
    // confirm — one finger on one key deleting a chat through a confirmation
    // built to stop that.
    function test_armedDeleteIgnoresAutoRepeat() {
      root.confirmingDelete = true
      var event = {
        key: Qt.Key_Delete, modifiers: Qt.NoModifier,
        isAutoRepeat: true, accepted: false
      }
      historyKeyboard.handleKey(event)
      verify(event.accepted)
      compare(root.deletedCount, 0)
      // And it does not withdraw either: a held key must leave the question
      // exactly as it found it, so releasing and pressing again still answers.
      compare(root.cancelledCount, 0)
    }

    // A modified Delete is inert armed as well as idle, so a stray
    // Ctrl+Delete cannot answer a question the user has not read.
    function test_armedDeleteIgnoresModifiedKeys() {
      root.confirmingDelete = true
      var event = { key: Qt.Key_Delete, modifiers: Qt.ControlModifier, accepted: false }
      historyKeyboard.handleKey(event)
      verify(!event.accepted)
      compare(root.deletedCount, 0)
      compare(root.cancelledCount, 0)
    }
  }
}
