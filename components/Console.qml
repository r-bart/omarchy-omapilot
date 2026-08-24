import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import "." as OmaPilot

// The console: OmaPilot's full-height deliberate surface, docked to the right
// edge of the focused output.
//
// This is the third ambient surface of design/ambient-ux.md — the node listens,
// the curtain answers, the console is where typing, choices, history, settings,
// and approvals live. It loads the way Panel.qml and ContextCaptureOverlay.qml
// load: as a child of the plugin's own tree, because the host resolves exactly
// one entry point per plugin and an extra `entryPoints` key would be silently
// ignored.
//
// The window stays mechanical on purpose: geometry, layer, focus policy, and
// the slide. Everything with an opinion lives in ConsoleContent, so the layout
// can iterate offscreen while only this file needs a live Wayland session.
Item {
  id: root

  property var backend: null
  property var targetScreen: null
  property bool motionEnabled: true
  // Value at scale 1; Style.space applies the host's spacing scale below.
  property int surfaceWidth: 440

  property bool opened: false
  // Mapped, including the exit slide. Owners that tear the console down (the
  // loader in Ambient.qml) must wait for this, not for `opened`.
  readonly property bool engaged: surface.visible
  // Holding the compositor's keyboard. Escape at rest releases this without
  // closing; clicking anywhere on the surface takes it back.
  property bool invoked: false

  function open(withFocus) {
    if (!opened && backend && typeof backend.latchDesktopContext === "function")
      backend.latchDesktopContext()
    opened = true
    if (withFocus !== false) {
      invoked = true
      Qt.callLater(function() { content.forceComposerFocus() })
    }
  }

  function close() {
    invoked = false
    opened = false
    if (backend && typeof backend.clearDesktopContextLatch === "function")
      backend.clearDesktopContextLatch()
  }

  function toggle() {
    if (opened) close()
    else open(true)
  }

  function openHistory() {
    open(true)
    content.openHistory()
  }

  function openSettings() {
    open(true)
    content.openSettings()
  }

  // A real blocker summons the chat lane specifically: the approval card only
  // renders there, and an approval the user cannot see is a stalled turn with
  // no indication of why.
  function openApproval() {
    open(true)
    content.showChat(false)
  }

  PanelWindow {
    id: surface
    screen: root.targetScreen
    color: "transparent"
    anchors { right: true; top: true; bottom: true }
    implicitWidth: Style.space(root.surfaceWidth)
    // No reserved strip: nothing reflows when the console opens.
    exclusionMode: ExclusionMode.Ignore
    exclusiveZone: 0
    // Keep the surface mapped while the exit slide plays out.
    visible: root.opened || shellItem.slid > 0.001

    // Attached, not direct: written as plain properties these compile and do
    // nothing. VoiceNode's PanelWindow is the canonical reference.
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "omapilot-console"
    WlrLayershell.keyboardFocus: root.invoked
      ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    Item {
      id: shellItem
      // 0 = parked beyond the right edge, 1 = docked. The slide is ours rather
      // than the compositor's: Omarchy pins layersIn/layersOut to a global
      // fade, the same reason the curtain animates its own y.
      property real slid: root.opened ? 1 : 0
      Behavior on slid {
        enabled: root.motionEnabled
        NumberAnimation {
          duration: root.opened ? 220 : 160
          easing.type: Easing.OutQuint
        }
      }
      // Reset the lanes only once the slide has finished: snapping settings or
      // history back to the empty chat while the surface is still leaving the
      // screen reads as a glitch, not a close.
      onSlidChanged: if (slid < 0.001 && !root.opened) content.reset()

      width: parent.width
      height: parent.height
      x: parent.width * (1 - slid)

      Rectangle {
        anchors.fill: parent
        color: Qt.rgba(Color.popups.background.r, Color.popups.background.g,
                       Color.popups.background.b, 0.97)
      }

      // Releasing keyboard focus never releases the pointer, so the surface
      // keeps receiving clicks while unfocused — and a click anywhere is the
      // gesture that takes the keyboard back.
      TapHandler {
        onTapped: {
          if (!root.invoked) {
            root.invoked = true
            Qt.callLater(function() { content.forceComposerFocus() })
          }
        }
      }

      OmaPilot.ConsoleContent {
        id: content
        anchors.fill: parent
        backend: root.backend
        focused: root.invoked
        // Keyed to the mapped surface, not `opened`, so the filament does not
        // freeze mid-frame during the exit slide.
        motionEnabled: root.motionEnabled && surface.visible
        onReleaseFocusRequested: root.invoked = false
        onCloseRequested: root.close()
      }
    }
  }
}
