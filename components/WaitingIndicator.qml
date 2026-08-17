import QtQuick
import QtQuick.Layouts
import qs.Commons

Item {
  id: root

  property bool active: false
  property bool streaming: false
  property int activityRevision: 0
  property bool motionEnabled: true
  property string message: streaming ? "Receiving response…" : "Waiting for a response…"
  property color foreground: Color.popups.text
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property bool pulseQueued: false
  readonly property int pulseDuration: streaming ? 360 : 480
  readonly property int pulseFadeInDuration: streaming ? 80 : 100
  readonly property int pulseFadeOutDuration: streaming ? 120 : 160
  readonly property int pulseHoldDuration: Math.max(0,
    pulseDuration - pulseFadeInDuration - pulseFadeOutDuration)
  readonly property bool pulseRunning: routePulse.running
  readonly property real pulseOffset: pulseTranslate.x

  implicitWidth: Style.space(196)
  implicitHeight: content.implicitHeight
  visible: active
  clip: true

  function settle() {
    pulseMarker.opacity = 0
    pulseTranslate.x = 0
    for (var i = 0; i < routeNodes.count; i++) {
      var node = routeNodes.itemAt(i)
      if (node) node.opacity = motionEnabled ? 0.46 : 0.72
    }
  }

  function stopAndSettle() {
    pulseQueued = false
    routePulse.stop()
    settle()
  }

  function startPulse() {
    if (!active || !motionEnabled) {
      stopAndSettle()
      return
    }
    pulseQueued = false
    pulseTranslate.x = 0
    pulseMarker.opacity = 0.18
    routePulse.restart()
  }

  function requestPulse() {
    if (!active || !motionEnabled) {
      stopAndSettle()
      return
    }
    if (routePulse.running) {
      pulseQueued = true
      return
    }
    startPulse()
  }

  onActiveChanged: active ? requestPulse() : stopAndSettle()
  // A first token changes the phase while the waiting sweep may still be in
  // flight. Queue the streaming pulse instead of snapping the marker home.
  onStreamingChanged: requestPulse()
  onMotionEnabledChanged: motionEnabled ? requestPulse() : stopAndSettle()
  onActivityRevisionChanged: {
    if (active && streaming && motionEnabled) requestPulse()
  }
  Component.onCompleted: active ? requestPulse() : settle()

  RowLayout {
    id: content
    anchors.fill: parent
    spacing: Style.spacing.md

    Item {
      id: route
      Layout.alignment: Qt.AlignVCenter
      implicitWidth: Style.space(46)
      implicitHeight: Style.space(14)

      Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        height: Math.max(1, Style.spacing.hairline)
        color: Style.normalBorderFor(root.foreground, root.accent)
      }

      Repeater {
        id: routeNodes
        model: 3

        Rectangle {
          required property int index
          width: Style.spacing.sm
          height: width
          x: index * (route.width - width) / 2
          anchors.verticalCenter: route.verticalCenter
          radius: Style.cornerRadius > 0 ? Math.min(Style.cornerRadius, width / 2) : 0
          color: root.accent
          opacity: 0.46
        }
      }

      Rectangle {
        id: pulseMarker
        width: Style.space(12)
        height: Style.spacing.sm
        anchors.verticalCenter: parent.verticalCenter
        radius: Style.cornerRadius > 0 ? Math.min(Style.cornerRadius, height / 2) : 0
        color: root.accent
        opacity: 0

        transform: Translate {
          id: pulseTranslate
          objectName: "pulseTranslate"
        }
      }
    }

    Text {
      Layout.alignment: Qt.AlignVCenter
      Layout.fillWidth: true
      Layout.minimumWidth: 0
      text: root.message
      color: root.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
      elide: Text.ElideRight
      maximumLineCount: 1
      Accessible.role: Accessible.StaticText
      Accessible.name: text
    }
  }

  SequentialAnimation {
    id: routePulse
    objectName: "routePulse"
    loops: 1

    ScriptAction {
      script: {
        pulseTranslate.x = 0
        pulseMarker.opacity = 0.18
      }
    }
    ParallelAnimation {
      NumberAnimation {
        target: pulseTranslate
        property: "x"
        from: 0
        to: Math.max(0, route.width - pulseMarker.width)
        duration: root.pulseDuration
        easing.type: Easing.OutCubic
      }
      SequentialAnimation {
        NumberAnimation {
          target: pulseMarker
          property: "opacity"
          to: 0.92
          duration: root.pulseFadeInDuration
          easing.type: Easing.OutCubic
        }
        PauseAnimation { duration: root.pulseHoldDuration }
        NumberAnimation {
          target: pulseMarker
          property: "opacity"
          to: 0
          duration: root.pulseFadeOutDuration
          easing.type: Easing.OutCubic
        }
      }
    }
    onFinished: {
      root.settle()
      if (root.pulseQueued && root.active && root.motionEnabled)
        Qt.callLater(root.startPulse)
    }
  }
}
