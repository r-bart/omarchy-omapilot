import QtQuick
import QtQuick.Window
import Quickshell
import "components" as OmaPilot

ShellRoot {
  id: root

  readonly property string outputDirectory: Quickshell.env("OMAPILOT_MOTION_FRAME_DIR")
  property int frameIndex: 0
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
    interval: 110
    running: true
    repeat: false
    onTriggered: {
      if (root.outputDirectory === "") {
        root.fail("OMAPILOT_MOTION_FRAME_DIR is required")
        return
      }
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
        if (root.frameIndex === 5) {
          indicator.streaming = true
          indicator.activityRevision += 1
        }
        if (root.frameIndex >= 10) {
          console.log("OMAPILOT_MOTION_PREVIEW_OK")
          Qt.quit()
          return
        }
        captureTimer.restart()
      })
    }
  }
}
