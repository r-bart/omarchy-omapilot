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

  function beginActivityReveal() {
    activityReveal.stop()
    scale = 1
    mark.opacity = 1
    if (active && motionEnabled) {
      scale = 0.94
      mark.opacity = 0.58
      activityReveal.restart()
    }
  }

  onActiveChanged: beginActivityReveal()
  onMotionEnabledChanged: beginActivityReveal()

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

  ParallelAnimation {
    id: activityReveal
    loops: 1
    NumberAnimation {
      target: root
      property: "scale"
      to: 1
      duration: 240
      easing.type: Easing.OutBack
    }
    NumberAnimation {
      target: mark
      property: "opacity"
      to: 1
      duration: 180
      easing.type: Easing.OutCubic
    }
  }
}
