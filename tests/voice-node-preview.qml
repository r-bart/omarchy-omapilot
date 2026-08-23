import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import "components" as OmaPilot

// Ephemeral real-desktop preview for the ambient state surface. The VoiceNode
// itself is non-interactive and requests no keyboard focus or input region.
ShellRoot {
  id: root

  readonly property string previewPhase: Quickshell.env("OMAPILOT_VOICE_PREVIEW_PHASE") || "thinking"
  readonly property bool blankWorkspace: Quickshell.env("OMAPILOT_VOICE_PREVIEW_BLANK") === "1"
  property real speakingLevel: 0.08
  property int speakingFrame: 0
  readonly property var speakingLevels: [0.08, 0.42, 0.78, 0.24, 0.91, 0.56, 0.16, 0.68]
  readonly property string focusedScreenName:
    Hyprland.focusedMonitor ? String(Hyprland.focusedMonitor.name || "") : ""
  readonly property var activeScreen: {
    var screens = Quickshell.screens || []
    for (var i = 0; i < screens.length; i++)
      if (String(screens[i].name || "") === root.focusedScreenName) return screens[i]
    return screens.length > 0 ? screens[0] : null
  }

  PanelWindow {
    screen: root.activeScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: Color.background
    visible: root.blankWorkspace
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Bottom
    WlrLayershell.namespace: "omapilot-voice-preview-background"
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
  }

  OmaPilot.VoiceNode {
    phase: root.previewPhase
    transcript: root.previewPhase === "listening" ? "Listening…" : ""
    status: ""
    speaking: root.previewPhase === "speaking"
    playbackMetered: root.previewPhase === "speaking"
    playbackLevel: root.speakingLevel
    hint: root.previewPhase === "listening"
      ? "Super+A to send · Super+Alt+X to cancel" : ""
    targetScreen: root.activeScreen
    motionEnabled: true
  }

  Timer {
    interval: 120
    running: root.previewPhase === "speaking"
    repeat: true
    onTriggered: {
      root.speakingFrame = (root.speakingFrame + 1) % root.speakingLevels.length
      root.speakingLevel = root.speakingLevels[root.speakingFrame]
    }
  }
}
