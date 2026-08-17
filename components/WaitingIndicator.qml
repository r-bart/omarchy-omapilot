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
  property real signalPhase: 0
  property real signalSpeed: streaming ? 0.78 : 0.55
  property bool componentReady: false
  property string displayedMessage: message
  property string pendingMessage: message
  readonly property bool pulseRunning: signalClock.running
  readonly property real pulseProgress: signalPhase
  readonly property real settledNodeOpacity: motionEnabled ? 0.46 : 0.72
  readonly property real signalEnvelope: edgeEnvelope()
  readonly property real routeEnergy: Math.max(nodeEnergy(0.25),
    nodeEnergy(0.5), nodeEnergy(0.75))

  implicitWidth: Style.space(204)
  implicitHeight: content.implicitHeight
  visible: active || opacity > 0
  opacity: active ? 1 : 0
  clip: true

  Behavior on opacity {
    enabled: root.motionEnabled
    NumberAnimation { duration: 140; easing.type: Easing.OutCubic }
  }

  Behavior on signalSpeed {
    enabled: root.motionEnabled
    NumberAnimation { duration: 240; easing.type: Easing.OutCubic }
  }

  function edgeEnvelope() {
    var edge = Math.min(1, signalPhase / 0.18, (1 - signalPhase) / 0.18)
    edge = Math.max(0, edge)
    return edge * edge * (3 - 2 * edge)
  }

  function nodeEnergy(position) {
    // The frame-clock beam crosses each fixed route node at constant velocity.
    // It is fully transparent at the route edge before phase wraps, so the
    // reset cannot flash or teleport on a compositor frame.
    var distance = Math.abs(signalPhase - position)
    var strength = Math.max(0, 1 - distance / 0.24)
    return strength * strength * (3 - 2 * strength) * signalEnvelope
  }

  function settle() {
    signalPhase = 0
  }

  function advanceSignal(frameDelta) {
    // A long compositor frame contributes at most 50 ms of phase travel.
    var delta = Math.min(0.05, Math.max(0, frameDelta))
    signalPhase = (signalPhase + delta * signalSpeed) % 1
  }

  function updateDisplayedMessage() {
    pendingMessage = message
    if (!componentReady) {
      displayedMessage = pendingMessage
      return
    }
    if (!motionEnabled) {
      messageSwap.stop()
      displayedMessage = pendingMessage
      statusLabel.opacity = 1
      return
    }
    if (displayedMessage !== pendingMessage) messageSwap.restart()
  }

  onActiveChanged: if (componentReady && !active) settle()
  // Token bursts intentionally do not restart or retime the signal. The
  // waiting-to-streaming handoff only eases its velocity, leaving phase intact.
  onMotionEnabledChanged: if (componentReady) {
    if (!motionEnabled) settle()
    updateDisplayedMessage()
  }
  onMessageChanged: updateDisplayedMessage()
  Component.onCompleted: {
    componentReady = true
    displayedMessage = message
    pendingMessage = message
    if (!active || !motionEnabled) settle()
  }

  RowLayout {
    id: content
    anchors.fill: parent
    spacing: Style.spacing.md

    Item {
      id: route
      Layout.alignment: Qt.AlignVCenter
      implicitWidth: Style.space(44)
      implicitHeight: Style.space(14)
      clip: true

      Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        height: Math.max(1, Style.spacing.hairline)
        color: Style.normalBorderFor(root.foreground, root.accent)
        opacity: 0.62 + 0.18 * root.routeEnergy
      }

      Repeater {
        id: routeNodes
        model: 3

        Rectangle {
          required property int index
          readonly property real routePosition: (index + 1) / 4
          readonly property real energy: root.nodeEnergy(routePosition)
          width: Style.spacing.sm
          height: width
          x: routePosition * route.width - width / 2
          anchors.verticalCenter: route.verticalCenter
          radius: Style.cornerRadius > 0 ? Math.min(Style.cornerRadius, width / 2) : 0
          color: root.accent
          opacity: root.settledNodeOpacity + (0.96 - root.settledNodeOpacity) * energy
          scale: 1 + 0.16 * energy
          transformOrigin: Item.Center
        }
      }

      Item {
        id: signalBeam
        width: Style.space(14)
        height: route.height
        x: root.signalPhase * route.width - width / 2
        opacity: root.signalEnvelope

        Rectangle {
          anchors.centerIn: parent
          width: parent.width
          height: Style.spacing.sm + Style.spacing.hairline
          radius: Style.cornerRadius > 0 ? Math.min(Style.cornerRadius, height / 2) : 0
          color: root.accent
          opacity: 0.20
        }

        Rectangle {
          anchors.centerIn: parent
          width: Math.round(parent.width * 0.58)
          height: Math.max(1, Style.spacing.hairline * 2)
          radius: Style.cornerRadius > 0 ? Math.min(Style.cornerRadius, height / 2) : 0
          color: root.accent
          opacity: 0.94
        }
      }
    }

    Text {
      id: statusLabel
      Layout.alignment: Qt.AlignVCenter
      Layout.fillWidth: true
      Layout.minimumWidth: 0
      text: root.displayedMessage
      color: root.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.weight: Font.Medium
      elide: Text.ElideRight
      maximumLineCount: 1
      Accessible.role: Accessible.StaticText
      Accessible.name: text
    }
  }

  SequentialAnimation {
    id: messageSwap
    NumberAnimation {
      target: statusLabel
      property: "opacity"
      to: 0.30
      duration: 70
      easing.type: Easing.OutCubic
    }
    ScriptAction { script: root.displayedMessage = root.pendingMessage }
    NumberAnimation {
      target: statusLabel
      property: "opacity"
      to: 1
      duration: 110
      easing.type: Easing.OutCubic
    }
  }

  FrameAnimation {
    id: signalClock
    objectName: "signalClock"
    running: root.active && root.motionEnabled
    // Cap delayed frames so compositor stalls cannot become visible jumps.
    onTriggered: root.advanceSignal(smoothFrameTime)
  }
}
