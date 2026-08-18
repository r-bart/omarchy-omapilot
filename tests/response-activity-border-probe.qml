import QtQuick
import QtQuick.Window
import Quickshell
import "components" as OmaPilot

ShellRoot {
  id: root
  property string responseState: "preparing"
  property real waitingPhase: 0
  property real transitionPhase: 0
  property int runningStarts: 0
  property int transitionStarts: 0
  property real cardHeight: 156
  property bool failed: false
  property int stage: 0

  Behavior on cardHeight {
    NumberAnimation { duration: 120; easing.type: Easing.Linear }
  }

  function fail(message) {
    failed = true
    console.error("omapilot motion probe failed: " + message)
  }

  Component.onCompleted: {
    if (indicator.running) runningStarts = Math.max(1, runningStarts)
  }

  Window {
    width: 420
    height: 260
    visible: true
    color: "#181923"

    OmaPilot.ResponseActivityBorder {
      id: indicator
      anchors.centerIn: parent
      width: 396
      height: root.cardHeight
      active: root.responseState === "preparing" || root.responseState === "streaming"
      motionEnabled: true
      accent: "#8caaee"
      radius: 18
    }
  }

  Connections {
    target: indicator
    function onRunningChanged() {
      if (indicator.running) root.runningStarts += 1
    }
  }

  Timer {
    id: probeTimer
    interval: 180
    running: true
    repeat: true
    onTriggered: {
      if (root.stage === 0) {
        root.waitingPhase = indicator.phase
        if (!indicator.running || root.waitingPhase <= 0 || root.runningStarts < 1)
          root.fail("waiting perimeter did not start")
        root.transitionPhase = indicator.phase
        root.transitionStarts = root.runningStarts
        root.responseState = "streaming"
        root.cardHeight = 236
      } else if (root.stage === 1) {
        var advance = (indicator.phase - root.transitionPhase + 1) % 1
        if (!indicator.running || advance <= 0 || advance > 0.2)
          root.fail("streaming perimeter did not continue smoothly")
        if (root.runningStarts !== root.transitionStarts)
          root.fail("waiting-to-streaming restarted the perimeter")
        if (Math.abs(root.cardHeight - 236) > 0.001)
          root.fail("resizing probe did not complete")
        root.responseState = "complete"
        if (indicator.running)
          root.fail("completed response left the perimeter running")
      } else if (root.stage === 2) {
        if (indicator.opacity > 0.001 || indicator.phase !== 0 || indicator.visible)
          root.fail("inactive perimeter did not fade and settle")
        indicator.motionEnabled = false
        root.responseState = "preparing"
        if (indicator.running || indicator.opacity > 0.001 || indicator.phase !== 0)
          root.fail("reduced motion did not remain static")
        root.responseState = "complete"
        if (!root.failed) console.log("OMAPILOT_MOTION_PROBE_OK")
        probeTimer.stop()
        Qt.quit()
      }
      root.stage += 1
    }
  }
}
