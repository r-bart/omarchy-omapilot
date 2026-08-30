import QtQuick
import Quickshell
import Quickshell.Hyprland
import "components" as OmaPilot

// Ephemeral real-desktop fixture for verifying the capped answer curtain. The
// numbered paragraphs make wheel or touch scrolling visible in screenshots.
ShellRoot {
  id: root

  readonly property string focusedScreenName:
    Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name || "") : ""
  readonly property var activeScreen: {
    var screens = Quickshell.screens || []
    for (var i = 0; i < screens.length; i++)
      if (String(screens[i].name || "") === root.focusedScreenName) return screens[i]
    return screens.length > 0 ? screens[0] : null
  }
  readonly property string longAnswer: {
    var paragraphs = []
    for (var i = 1; i <= 48; i++)
      paragraphs.push("Paragraph " + i + " — enough content to verify the ambient answer viewport can scroll.")
    return paragraphs.join("\n\n")
  }

  OmaPilot.AnswerCurtain {
    shown: true
    question: "Show a long ambient answer"
    markdown: root.longAnswer
    provenance: "preview · issue 31"
    targetScreen: root.activeScreen
    motionEnabled: false
  }
}
