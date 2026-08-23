import QtQuick
import QtQuick.Controls
import QtTest
import "../components/internal" as OmaPilotInternal
import "../components/QuickActions.js" as ActionCatalog

Item {
  id: root
  width: 420
  height: 400
  focus: true

  property bool popupOpen: false
  property bool permissionPending: false
  property bool confirmationOpen: false
  property bool panelActive: true
  property bool busy: false
  readonly property bool modalInteractionActive: popupOpen
    || permissionPending
    || confirmationOpen
  property int workInAppRequests: 0
  property int submissions: 0
  property string draft: ""
  property var quickActionItems: [{
    id: "work-in-app",
    label: "Work in active app",
    prompt: "In the active app, "
  }]

  Keys.onPressed: function(event) { navigation.handleKey(event) }

  Button {
    id: topButton
    x: 20
    y: 20
    width: 120
    text: "Top"
  }

  Button {
    id: rightButton
    x: 180
    y: 20
    width: 120
    text: "Right"
  }

  Button {
    id: downButton
    x: 20
    y: 80
    width: 120
    text: "Down"
  }

  TextField {
    id: lineEditor
    x: 20
    y: 140
    width: 280
  }

  TextArea {
    id: multilineEditor
    x: 20
    y: 200
    width: 280
    height: 90
  }

  TextArea {
    id: readOnlyEditor
    x: 310
    y: 140
    width: 100
    height: 150
    readOnly: true
    text: "read\nonly"
  }

  OmaPilotInternal.PanelKeyboardNavigation {
    id: navigation
    focusRoot: root
    activeFocusItem: root.Window.window
      ? root.Window.window.activeFocusItem : null
    panelActive: root.panelActive
    modalInteractionActive: root.modalInteractionActive
    workInAppShortcutEnabled:
      ActionCatalog.promptFor(root.quickActionItems, "work-in-app") !== ""
      && !root.busy
    onWorkInAppRequested: {
      var prompt = ActionCatalog.promptFor(root.quickActionItems, "work-in-app")
      if (prompt === "") return
      root.workInAppRequests += 1
      root.draft = prompt
      lineEditor.text = root.draft
      lineEditor.forceActiveFocus()
    }
  }

  TestCase {
    name: "OmaPilotPanelKeyboardNavigation"
    when: windowShown

    function init() {
      root.popupOpen = false
      root.permissionPending = false
      root.confirmationOpen = false
      root.panelActive = true
      root.busy = false
      root.workInAppRequests = 0
      root.submissions = 0
      root.draft = ""
      root.quickActionItems = [{
        id: "work-in-app",
        label: "Work in active app",
        prompt: "In the active app, "
      }]
      lineEditor.clear()
      multilineEditor.clear()
      readOnlyEditor.text = "read\nonly"
      readOnlyEditor.cursorPosition = readOnlyEditor.length
      topButton.forceActiveFocus()
      wait(0)
    }

    function test_arrowsAndVimKeysMoveSpatiallyOutsideEditors() {
      keyClick(Qt.Key_L)
      verify(rightButton.activeFocus)
      keyClick(Qt.Key_H)
      verify(topButton.activeFocus)
      keyClick(Qt.Key_J)
      verify(downButton.activeFocus)
      keyClick(Qt.Key_K)
      verify(topButton.activeFocus)
      keyClick(Qt.Key_Right)
      verify(rightButton.activeFocus)
      keyClick(Qt.Key_Left)
      verify(topButton.activeFocus)
      keyClick(Qt.Key_Down)
      verify(downButton.activeFocus)
      keyClick(Qt.Key_Up)
      verify(topButton.activeFocus)
    }

    function test_editorsKeepVimTextAndArrowEditing() {
      lineEditor.forceActiveFocus()
      keyClick(Qt.Key_H)
      keyClick(Qt.Key_J)
      keyClick(Qt.Key_K)
      keyClick(Qt.Key_L)
      compare(lineEditor.text, "hjkl")
      lineEditor.cursorPosition = 2
      keyClick(Qt.Key_Left)
      compare(lineEditor.cursorPosition, 1)
      keyClick(Qt.Key_Right)
      compare(lineEditor.cursorPosition, 2)

      var arrows = [Qt.Key_Up, Qt.Key_Down, Qt.Key_Left, Qt.Key_Right]
      for (var i = 0; i < arrows.length; i++)
        verify(!navigation.shouldHandleNavigationKey(
          arrows[i], Qt.NoModifier, lineEditor))

      multilineEditor.forceActiveFocus()
      keyClick(Qt.Key_H)
      keyClick(Qt.Key_J)
      keyClick(Qt.Key_K)
      keyClick(Qt.Key_L)
      compare(multilineEditor.text, "hjkl")
      verify(!navigation.shouldHandleNavigationKey(
        Qt.Key_Up, Qt.NoModifier, multilineEditor))
      verify(!navigation.shouldHandleNavigationKey(
        Qt.Key_Down, Qt.NoModifier, multilineEditor))
    }

    function test_readOnlyEditorKeepsVimKeysAndArrows() {
      readOnlyEditor.forceActiveFocus()
      var navigationKeys = [
        Qt.Key_H, Qt.Key_J, Qt.Key_K, Qt.Key_L,
        Qt.Key_Up, Qt.Key_Down, Qt.Key_Left, Qt.Key_Right
      ]
      for (var i = 0; i < navigationKeys.length; i++) {
        verify(!navigation.shouldHandleNavigationKey(
          navigationKeys[i], Qt.NoModifier, readOnlyEditor))
        keyClick(navigationKeys[i])
        verify(readOnlyEditor.activeFocus)
      }

      compare(readOnlyEditor.text, "read\nonly")
    }

    function test_dropdownAndModalStatesSuppressPanelHandling() {
      root.popupOpen = true
      topButton.forceActiveFocus()
      keyClick(Qt.Key_L)
      verify(topButton.activeFocus)
      keyClick(Qt.Key_A, Qt.ControlModifier | Qt.ShiftModifier)
      compare(root.workInAppRequests, 0)
      compare(root.draft, "")

      root.popupOpen = false
      root.permissionPending = true
      keyClick(Qt.Key_A, Qt.ControlModifier | Qt.ShiftModifier)
      compare(root.workInAppRequests, 0)

      root.permissionPending = false
      root.confirmationOpen = true
      keyClick(Qt.Key_A, Qt.ControlModifier | Qt.ShiftModifier)
      compare(root.workInAppRequests, 0)
    }

    function test_inactivePanelDoesNotHandleKeysOrShortcut() {
      root.panelActive = false
      topButton.forceActiveFocus()
      keyClick(Qt.Key_L)
      verify(topButton.activeFocus)
      keyClick(Qt.Key_A, Qt.ControlModifier | Qt.ShiftModifier)
      compare(root.workInAppRequests, 0)
    }

    function test_nativeTabAndShiftTabRemainAvailable() {
      topButton.forceActiveFocus()
      keyClick(Qt.Key_Tab)
      verify(rightButton.activeFocus)
      keyClick(Qt.Key_Tab, Qt.ShiftModifier)
      verify(topButton.activeFocus)
    }

    function test_oldAltChordDoesNotTriggerFromEditor() {
      root.draft = "Keep this draft"
      readOnlyEditor.text = root.draft
      readOnlyEditor.forceActiveFocus()
      keySequence("Ctrl+Alt+A")
      compare(root.workInAppRequests, 0)
      compare(root.draft, "Keep this draft")
      compare(readOnlyEditor.text, root.draft)
      verify(readOnlyEditor.activeFocus)
      compare(root.submissions, 0)
    }

    function test_busyDisablesWorkInAppShortcut() {
      root.draft = "Busy draft"
      lineEditor.text = root.draft
      lineEditor.forceActiveFocus()
      root.busy = true
      keyClick(Qt.Key_A, Qt.ControlModifier | Qt.ShiftModifier)
      compare(root.workInAppRequests, 0)
      compare(root.draft, "Busy draft")
      compare(lineEditor.text, root.draft)
      verify(lineEditor.activeFocus)
      compare(root.submissions, 0)
    }

    function test_workInAppUsesCustomizedPromptWithoutSubmitting() {
      root.quickActionItems = [{
        id: "work-in-app",
        label: "Inspect active app",
        prompt: "Inspect the active app, then help me edit: ",
      }]
      root.draft = "Replace this draft"
      lineEditor.text = root.draft
      lineEditor.forceActiveFocus()
      keyClick(Qt.Key_A, Qt.ControlModifier | Qt.ShiftModifier)
      compare(root.workInAppRequests, 1)
      compare(root.draft, "Inspect the active app, then help me edit: ")
      compare(lineEditor.text, root.draft)
      verify(lineEditor.activeFocus)
      compare(root.submissions, 0)
    }
  }
}
