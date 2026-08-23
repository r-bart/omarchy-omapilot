import QtQuick
import QtQuick.Controls
import QtTest
import "../components/internal" as OmaPilotInternal

Item {
  width: 320
  height: 120

  Button { id: denyButton; text: "Deny" }
  Button { id: allowButton; text: "Allow once"; x: 140 }

  OmaPilotInternal.PermissionFocusGuard {
    id: guard
    defaultTarget: denyButton
  }

  TestCase {
    name: "OmaPilotPermissionFocus"
    when: windowShown

    function test_eachQueuedPermissionDefaultsBackToDeny() {
      guard.permissionId = "permission-a"
      wait(0)
      verify(denyButton.activeFocus)

      allowButton.forceActiveFocus()
      verify(allowButton.activeFocus)

      guard.permissionId = "permission-b"
      wait(0)
      verify(denyButton.activeFocus)
      verify(!allowButton.activeFocus)
    }
  }
}
