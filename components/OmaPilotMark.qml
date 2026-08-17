import QtQuick
import QtQuick.Controls as QQC
import qs.Commons
import qs.Ui

Item {
  id: root

  property real size: Style.space(42)
  property color foreground: Color.popups.text
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property bool active: false
  property bool motionEnabled: true

  implicitWidth: size
  implicitHeight: size
  transformOrigin: Item.Center
  scale: active ? 0.975 : 1

  Behavior on scale {
    enabled: root.motionEnabled
    NumberAnimation { duration: 160; easing.type: Easing.OutCubic }
  }

  Rectangle {
    anchors.centerIn: parent
    width: root.size
    height: root.size
    radius: Style.cornerRadius
    color: root.accent
    opacity: root.active ? 0.10 : 0

    Behavior on opacity {
      enabled: root.motionEnabled
      NumberAnimation { duration: 180; easing.type: Easing.OutCubic }
    }
  }

  QQC.Button {
    id: mark
    anchors.fill: parent
    enabled: false
    opacity: 1
    focusPolicy: Qt.NoFocus
    padding: 0
    display: QQC.AbstractButton.IconOnly
    background: null
    icon.source: Qt.resolvedUrl("../assets/omapilot-mark.png")
    icon.width: Math.round(root.size)
    icon.height: Math.round(root.size)
    icon.color: root.accent
  }
}
