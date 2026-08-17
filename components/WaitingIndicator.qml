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
  property real waveProgress: 0
  property bool componentReady: false
  property string displayedMessage: message
  property string pendingMessage: message
  readonly property int requestedPulseDuration: streaming ? 460 : 760
  property int activePulseDuration: 760
  readonly property int waitingRestDuration: 1320
  readonly property bool pulseRunning: wavePulse.running
  readonly property bool waitingCadenceRunning: waitingCadence.running
  readonly property real pulseProgress: waveProgress
  readonly property real settledNodeOpacity: motionEnabled ? 0.46 : 0.72

  implicitWidth: Style.space(204)
  implicitHeight: content.implicitHeight
  visible: active || opacity > 0
  opacity: active ? 1 : 0
  clip: true

  Behavior on opacity {
    enabled: root.motionEnabled
    NumberAnimation { duration: 140; easing.type: Easing.OutCubic }
  }

  function pulseStrength(position) {
    var progress = Math.max(0, Math.min(1, waveProgress))
    var distance = Math.abs(progress - position)
    var localWave = Math.max(0, 1 - distance / 0.38)
    var endpointEnvelope = Math.sin(Math.PI * progress)
    return localWave * endpointEnvelope
  }

  function settle() {
    waveProgress = 0
  }

  function stopAndSettle() {
    pulseQueued = false
    waitingCadence.stop()
    wavePulse.stop()
    settle()
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

  function startPulse() {
    if (!active || !motionEnabled) {
      stopAndSettle()
      return
    }
    waitingCadence.stop()
    pulseQueued = false
    waveProgress = 0
    activePulseDuration = requestedPulseDuration
    wavePulse.start()
  }

  function requestPulse() {
    if (!active || !motionEnabled) {
      stopAndSettle()
      return
    }
    waitingCadence.stop()
    if (wavePulse.running) {
      pulseQueued = true
      return
    }
    startPulse()
  }

  onActiveChanged: if (componentReady) active ? requestPulse() : stopAndSettle()
  // First-token and bursty content events coalesce behind the active wave.
  // Because both ends of the wave render at the same resting state, handing
  // off to the queued streaming pulse has no visible reset or teleport.
  onStreamingChanged: if (componentReady) requestPulse()
  onMotionEnabledChanged: if (componentReady) {
    motionEnabled ? requestPulse() : stopAndSettle()
    updateDisplayedMessage()
  }
  onMessageChanged: updateDisplayedMessage()
  onActivityRevisionChanged: {
    if (componentReady && active && streaming && motionEnabled) requestPulse()
  }
  Component.onCompleted: {
    componentReady = true
    displayedMessage = message
    pendingMessage = message
    active ? requestPulse() : settle()
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

      Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        height: Math.max(1, Style.spacing.hairline)
        color: Style.normalBorderFor(root.foreground, root.accent)
        opacity: 0.72 + 0.18 * Math.sin(Math.PI * root.waveProgress)
      }

      Repeater {
        id: routeNodes
        model: 3

        Rectangle {
          required property int index
          readonly property real routePosition: (index + 1) / 4
          readonly property real energy: root.pulseStrength(routePosition)
          width: Style.spacing.sm
          height: width
          x: routePosition * route.width - width / 2
          anchors.verticalCenter: route.verticalCenter
          radius: Style.cornerRadius > 0 ? Math.min(Style.cornerRadius, width / 2) : 0
          color: root.accent
          opacity: root.settledNodeOpacity + (0.96 - root.settledNodeOpacity) * energy
          scale: 1 + 0.22 * energy
          transformOrigin: Item.Center
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

  NumberAnimation {
    id: wavePulse
    objectName: "wavePulse"
    target: root
    property: "waveProgress"
    from: 0
    to: 1
    duration: root.activePulseDuration
    easing.type: Easing.InOutCubic
    onFinished: {
      root.settle()
      if (root.pulseQueued && root.active && root.motionEnabled)
        Qt.callLater(root.startPulse)
      else if (root.active && !root.streaming && root.motionEnabled)
        waitingCadence.restart()
    }
  }

  Timer {
    id: waitingCadence
    objectName: "waitingCadence"
    interval: root.waitingRestDuration
    repeat: false
    onTriggered: root.requestPulse()
  }
}
