import QtQuick
import QtQuick.Window
import Quickshell
import "components" as OmaPilot

ShellRoot {
  id: root

  readonly property string outputDirectory: Quickshell.env("OMAPILOT_MOTION_FRAME_DIR")
  property int frameIndex: 0
  property real lastProgress: -1
  property real largestStep: 0
  property real transitionProgress: 0
  property bool failed: false
  property string responseState: "preparing"
  property int runningStarts: 0
  property int transitionStarts: 0

  function fail(message) {
    failed = true
    console.error("omapilot motion preview failed: " + message)
    Qt.quit()
  }

  Component.onCompleted: {
    if (indicator.running) runningStarts = Math.max(1, runningStarts)
  }

  Window {
    id: previewWindow
    width: 420
    height: 44
    visible: true
    color: "transparent"
    flags: Qt.FramelessWindowHint

    Rectangle {
      id: captureSurface
      anchors.fill: parent
      color: "#181923"

      OmaPilot.ResponseActivityBorder {
        id: indicator
        anchors.fill: parent
        anchors.margins: 10
        active: root.responseState === "preparing" || root.responseState === "streaming"
        motionEnabled: true
        accent: "#8caaee"
        radius: 18
      }
    }
  }

  Connections {
    target: indicator
    function onRunningChanged() {
      if (indicator.running) root.runningStarts += 1
    }
  }

  Timer {
    id: captureTimer
    interval: 80
    running: true
    repeat: false
    onTriggered: {
      if (root.outputDirectory === "") {
        root.fail("OMAPILOT_MOTION_FRAME_DIR is required")
        return
      }
      var progress = indicator.phase
      if (root.lastProgress >= 0) {
        var step = (progress - root.lastProgress + 1) % 1
        root.largestStep = Math.max(root.largestStep, step)
        if (step <= 0 || step > 0.14) {
          root.fail("perimeter phase step was not smooth: " + step.toFixed(3))
          return
        }
      }
      root.lastProgress = progress
      var output = root.outputDirectory + "/frame-" + String(root.frameIndex).padStart(2, "0") + ".png"
      console.log("OMAPILOT_MOTION_FRAME=" + root.frameIndex
        + " phase=" + (root.responseState === "streaming" ? "streaming" : "waiting")
        + " progress=" + indicator.phase.toFixed(3))
      captureSurface.grabToImage(function(result) {
        if (!result || !result.saveToFile(output)) {
          root.fail("could not save " + output)
          return
        }
        root.frameIndex += 1
        if (root.frameIndex === 7) {
          if (root.runningStarts < 1) {
            root.fail("motion preview did not observe the initial runner start")
            return
          }
          root.transitionProgress = indicator.phase
          root.transitionStarts = root.runningStarts
          root.responseState = "streaming"
        }
        if (root.frameIndex === 8) {
          var advance = (indicator.phase - root.transitionProgress + 1) % 1
          if (advance <= 0 || advance > 0.14
              || root.runningStarts !== root.transitionStarts) {
            root.fail("waiting-to-streaming render restarted or jumped phase")
            return
          }
        }
        if (root.frameIndex >= 14) {
          if (root.largestStep <= 0) {
            root.fail("motion preview did not observe temporal progress")
            return
          }
          console.log("OMAPILOT_MOTION_PREVIEW_OK")
          Qt.quit()
          return
        }
        captureTimer.restart()
      })
    }
  }
}
