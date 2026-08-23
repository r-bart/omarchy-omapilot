import QtQuick
import Quickshell

ShellRoot {
  Loader {
    id: pluginLoader
    source: Qt.resolvedUrl("BarWidget.qml")
  }

  Loader {
    id: overlayLoader
    source: Qt.resolvedUrl("ContextCaptureOverlay.qml")
  }

  Timer {
    interval: 600
    running: true
    onTriggered: {
      if (pluginLoader.status === Loader.Error)
        console.error("omapilot smoke loader failed")
      if (overlayLoader.status === Loader.Error)
        console.error("omapilot overlay smoke loader failed")
      Qt.quit()
    }
  }
}
