import QtQuick
import QtQuick.Window
import Quickshell
import "components" as OmaPilot

ShellRoot {
  id: root
  property real waitingProgress: 0
  property int waitingDuration: 0
  property bool transitionChecked: false
  property bool cadenceChecked: false
  property bool failed: false

  function fail(message) {
    failed = true
    console.error("omapilot motion probe failed: " + message)
  }

  Window {
    width: 460
    height: 52
    visible: true
    color: "transparent"

    Column {
      anchors.fill: parent

      OmaPilot.WaitingIndicator {
        id: transitionIndicator
        width: parent.width
        height: 24
        active: true
        streaming: false
        motionEnabled: true
        message: streaming ? "Receiving response…" : "Preparing Codex…"
      }

      OmaPilot.WaitingIndicator {
        id: cadenceIndicator
        width: parent.width
        height: 24
        active: true
        streaming: false
        motionEnabled: true
        message: "Preparing Codex…"
      }
    }
  }

  Timer {
    interval: 100
    running: true
    repeat: false
    onTriggered: {
      root.waitingProgress = transitionIndicator.pulseProgress
      root.waitingDuration = transitionIndicator.activePulseDuration
      if (!transitionIndicator.pulseRunning || root.waitingProgress <= 0)
        root.fail("waiting energy wave did not start")

      transitionIndicator.streaming = true
      if (!transitionIndicator.pulseRunning)
        root.fail("first token stopped the active energy wave")
      if (!transitionIndicator.pulseQueued)
        root.fail("first token did not queue the streaming wave")
      if (transitionIndicator.pulseProgress < root.waitingProgress - 0.03)
        root.fail("first token reset the active energy wave")
      if (transitionIndicator.activePulseDuration !== root.waitingDuration)
        root.fail("first token changed the in-flight wave timing")

      transitionIndicator.activityRevision += 1
      if (!transitionIndicator.pulseQueued)
        root.fail("content event was discarded while the wave was active")

      transitionIndicator.active = false
      if (transitionIndicator.pulseRunning || transitionIndicator.pulseQueued
          || transitionIndicator.pulseProgress !== 0
          || transitionIndicator.waitingCadenceRunning)
        root.fail("inactive motion did not settle")

      transitionIndicator.motionEnabled = false
      transitionIndicator.active = true
      if (transitionIndicator.pulseRunning || transitionIndicator.pulseQueued
          || transitionIndicator.pulseProgress !== 0
          || transitionIndicator.waitingCadenceRunning)
        root.fail("reduced motion did not remain settled")

      root.transitionChecked = true
    }
  }

  Timer {
    interval: 900
    running: true
    repeat: false
    onTriggered: {
      if (cadenceIndicator.pulseRunning)
        root.fail("waiting wave did not return to its rest state")
      if (!cadenceIndicator.waitingCadenceRunning)
        root.fail("waiting rest cadence was not scheduled")
      if (cadenceIndicator.pulseProgress !== 0)
        root.fail("waiting wave endpoint did not settle continuously")
      root.cadenceChecked = true
    }
  }

  Timer {
    interval: 2250
    running: true
    repeat: false
    onTriggered: {
      if (!cadenceIndicator.pulseRunning || cadenceIndicator.pulseProgress <= 0)
        root.fail("waiting cadence did not begin its next restrained wave")
      if (!root.transitionChecked || !root.cadenceChecked)
        root.fail("motion probe stages did not complete")
      if (!root.failed) console.log("OMAPILOT_MOTION_PROBE_OK")
      Qt.quit()
    }
  }
}
