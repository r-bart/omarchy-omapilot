import QtQuick

Item {
  id: root
  width: 0
  height: 0
  visible: false

  property string permissionId: ""
  property var defaultTarget: null

  onPermissionIdChanged: {
    if (permissionId === "" || !defaultTarget) return
    Qt.callLater(function() {
      if (root.permissionId !== "" && root.defaultTarget)
        root.defaultTarget.forceActiveFocus()
    })
  }
}
