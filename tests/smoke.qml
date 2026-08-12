import QtQuick
import Quickshell

ShellRoot {
  Loader {
    id: pluginLoader
    source: Qt.resolvedUrl("BarWidget.qml")
  }

  Timer {
    interval: 600
    running: true
    onTriggered: {
      if (pluginLoader.status === Loader.Error)
        console.error("quickchat smoke loader failed")
      Qt.quit()
    }
  }
}
