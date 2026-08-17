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

  function fail(message) {
    failed = true
    console.error("omapilot motion preview failed: " + message)
    Qt.quit()
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

      OmaPilot.WaitingIndicator {
        id: indicator
        anchors.centerIn: parent
        width: 260
        height: 24
        active: true
        streaming: false
        motionEnabled: true
        message: streaming ? "Receiving response…" : "Preparing Codex…"
        foreground: "#c6d0f5"
        accent: "#8caaee"
      }
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
      var progress = indicator.pulseProgress
      if (root.lastProgress >= 0) {
        var step = (progress - root.lastProgress + 1) % 1
        root.largestStep = Math.max(root.largestStep, step)
        if (step <= 0 || step > 0.14) {
          root.fail("frame-clock phase step was not smooth: " + step.toFixed(3))
          return
        }
      }
      root.lastProgress = progress
      var output = root.outputDirectory + "/frame-" + String(root.frameIndex).padStart(2, "0") + ".png"
      console.log("OMAPILOT_MOTION_FRAME=" + root.frameIndex
        + " phase=" + (indicator.streaming ? "streaming" : "waiting")
        + " progress=" + indicator.pulseProgress.toFixed(3)
        + " message=" + indicator.displayedMessage)
      captureSurface.grabToImage(function(result) {
        if (!result || !result.saveToFile(output)) {
          root.fail("could not save " + output)
          return
        }
        root.frameIndex += 1
        if (root.frameIndex === 7) {
          root.transitionProgress = indicator.pulseProgress
          indicator.streaming = true
          indicator.activityRevision += 1
        }
        if (root.frameIndex === 8 && indicator.pulseProgress < root.transitionProgress) {
          root.fail("waiting-to-streaming render reset phase")
          return
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
