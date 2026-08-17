import QtQuick
import QtQuick.Window
import Quickshell
import "components" as OmaPilot

ShellRoot {
  id: root
  property real waitingPhase: 0
  property real transitionPhase: 0
  property real activityPhase: 0
  property bool failed: false

  function fail(message) {
    failed = true
    console.error("omapilot motion probe failed: " + message)
  }

  Window {
    width: 460
    height: 28
    visible: true
    color: "transparent"

    OmaPilot.WaitingIndicator {
      id: indicator
      anchors.fill: parent
      active: true
      streaming: false
      motionEnabled: true
      message: streaming ? "Receiving response…" : "Preparing Codex…"
    }
  }

  Timer {
    interval: 180
    running: true
    repeat: false
    onTriggered: {
      root.waitingPhase = indicator.pulseProgress
      if (!indicator.pulseRunning || root.waitingPhase <= 0
          || root.waitingPhase >= 0.20)
        root.fail("waiting frame-clock signal did not advance at a bounded rate")

      root.transitionPhase = indicator.pulseProgress
      indicator.streaming = true
      if (!indicator.pulseRunning || indicator.pulseProgress !== root.transitionPhase)
        root.fail("first token reset the frame-clock phase")

      root.activityPhase = indicator.pulseProgress
      indicator.activityRevision += 1
      if (indicator.pulseProgress !== root.activityPhase)
        root.fail("token activity restarted the frame-clock phase")
    }
  }

  Timer {
    interval: 520
    running: true
    repeat: false
    onTriggered: {
      if (!indicator.pulseRunning || indicator.pulseProgress <= root.transitionPhase)
        root.fail("streaming signal did not continue from the waiting phase")
      if (indicator.signalSpeed < 0.76 || indicator.signalSpeed > 0.79)
        root.fail("waiting-to-streaming velocity did not ease to its target")

      indicator.active = false
      if (indicator.pulseRunning || indicator.pulseProgress !== 0)
        root.fail("inactive motion did not stop and settle")

      indicator.signalPhase = 0
      var restingQuarter = indicator.nodeEnergy(0.25)
      var restingHalf = indicator.nodeEnergy(0.5)
      var restingThreeQuarter = indicator.nodeEnergy(0.75)
      indicator.signalPhase = 1
      if (indicator.nodeEnergy(0.25) !== restingQuarter
          || indicator.nodeEnergy(0.5) !== restingHalf
          || indicator.nodeEnergy(0.75) !== restingThreeQuarter)
        root.fail("phase wrap changed resting geometry")

      indicator.signalPhase = 0
      indicator.advanceSignal(1)
      if (indicator.signalPhase <= 0 || indicator.signalPhase > 0.041)
        root.fail("delayed-frame phase travel was not capped")
      indicator.settle()

      indicator.motionEnabled = false
      indicator.active = true
      if (indicator.pulseRunning || indicator.pulseProgress !== 0)
        root.fail("reduced motion did not remain settled")

      if (!root.failed) console.log("OMAPILOT_MOTION_PROBE_OK")
      Qt.quit()
    }
  }
}
