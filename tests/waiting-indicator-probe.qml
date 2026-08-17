import QtQuick
import QtQuick.Window
import Quickshell
import "components" as OmaPilot

ShellRoot {
  id: root
  property real waitingOffset: 0
  property bool failed: false

  function fail(message) {
    failed = true
    console.error("omapilot motion probe failed: " + message)
  }

  Window {
    width: 220
    height: 24
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
    interval: 80
    running: true
    repeat: false
    onTriggered: {
      root.waitingOffset = indicator.pulseOffset
      if (!indicator.pulseRunning || root.waitingOffset <= 0)
        root.fail("waiting sweep did not start")

      indicator.streaming = true
      if (!indicator.pulseRunning)
        root.fail("first token stopped the active sweep")
      if (!indicator.pulseQueued)
        root.fail("first token did not queue the streaming pulse")
      if (indicator.pulseOffset < root.waitingOffset - 2)
        root.fail("first token reset the active marker")

      indicator.activityRevision += 1
      if (!indicator.pulseQueued)
        root.fail("content event was discarded while the pulse was active")

      indicator.active = false
      if (indicator.pulseRunning || indicator.pulseQueued || indicator.pulseOffset !== 0)
        root.fail("inactive motion did not settle")

      indicator.motionEnabled = false
      indicator.active = true
      if (indicator.pulseRunning || indicator.pulseQueued || indicator.pulseOffset !== 0)
        root.fail("reduced motion did not remain settled")

      if (!root.failed) console.log("OMAPILOT_MOTION_PROBE_OK")
      Qt.quit()
    }
  }
}
