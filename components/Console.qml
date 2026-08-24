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
  // Same content, whole screen. ConsoleContent was split from this window so a
  // second host could exist; this is that host, and it costs one anchor rather
  // than a second surface to keep in step. Docked stays the default.
  property bool fullscreen: false

  property bool opened: false
  // Collapsed is not closed. Closed unmaps the surface and ends the visit;
  // collapsed keeps it mapped as a grab handle at the edge, so the way back is
  // always one click away and never depends on the keyboard reaching us.
  property bool collapsed: false
  // Value at scale 1, like surfaceWidth.
  property int handleWidth: 24
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
    // Any deliberate summon — hotkey, bar button, an approval — is a request to
    // see the console, so it undoes a collapse rather than opening behind one.
    collapsed = false
    if (withFocus !== false) {
      invoked = true
      Qt.callLater(function() { content.forceComposerFocus() })
    }
  }

  function close() {
    invoked = false
    opened = false
    collapsed = false
    if (backend && typeof backend.clearDesktopContextLatch === "function")
      backend.clearDesktopContextLatch()
  }

  function collapse() {
    // Fullscreen has no edge to fold into, and a whole-screen surface reduced
    // to a handle would read as a bug rather than a collapse.
    if (fullscreen) return
    // Dropping the keyboard is the point: a collapsed console must not hold
    // the compositor's focus while showing nothing to type into.
    invoked = false
    collapsed = true
  }

  function expand() {
    collapsed = false
    invoked = true
    Qt.callLater(function() { content.forceComposerFocus() })
  }

  function toggleCollapsed() {
    if (collapsed) expand()
    else collapse()
  }

  // Switching to fullscreen while folded would map a whole-screen surface with
  // nothing in it: the handle that would unfold it does not exist there.
  onFullscreenChanged: if (fullscreen) collapsed = false

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
    // Anchoring left as well is the whole of the fullscreen mode: with both
    // sides pinned the compositor sizes the surface and implicitWidth stops
    // being consulted, so the docked width needs no special case.
    anchors { right: true; top: true; bottom: true; left: root.fullscreen }
    // Collapsing narrows the surface itself rather than sliding the content
    // out of a full-width window: the layer's input region is its size, so a
    // full-width collapsed console would keep swallowing clicks meant for the
    // windows behind it.
    implicitWidth: Style.space(root.collapsed ? root.handleWidth : root.surfaceWidth)
    Behavior on implicitWidth {
      enabled: root.motionEnabled
      NumberAnimation { duration: 200; easing.type: Easing.OutQuint }
    }
    // Normal, not Ignore. `exclusiveZone: 0` is what keeps the console from
    // reserving a strip of its own, so nothing reflows when it opens — that
    // part is unchanged. Ignore additionally opted the surface out of being
    // moved by *other* surfaces' exclusive zones, which is what laid it over
    // the bar. Normal leaves the bar's own strip alone and starts underneath it.
    exclusionMode: ExclusionMode.Normal
    exclusiveZone: 0
    // Keep the surface mapped while the exit slide plays out.
    visible: root.opened || shellItem.slid > 0.001

    // Attached, not direct: written as plain properties these compile and do
    // nothing. VoiceNode's PanelWindow is the canonical reference.
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "omapilot-console"
    WlrLayershell.keyboardFocus: root.invoked && !root.collapsed
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
      // The content keeps its expanded width through the collapse, so the
      // shell is what hides the overhang.
      clip: true

      Rectangle {
        anchors.fill: parent
        color: Qt.rgba(Color.popups.background.r, Color.popups.background.g,
                       Color.popups.background.b, 0.97)
      }

      // Releasing keyboard focus never releases the pointer, so the surface
      // keeps receiving clicks while unfocused — and a click anywhere is the
      // gesture that takes the keyboard back.
      TapHandler {
        // Collapsed, the only thing worth clicking is the handle, which owns
        // its own press. Taking the keyboard back here would fight it.
        enabled: !root.collapsed
        onTapped: {
          if (!root.invoked) {
            root.invoked = true
            Qt.callLater(function() { content.forceComposerFocus() })
          }
        }
      }

      OmaPilot.ConsoleContent {
        id: content
        // Held at its expanded width and clipped by the shell rather than
        // anchored to fill: reflowing the whole console down to a 24px handle
        // and back, sixty times a second, is a lot of layout for an animation
        // whose only job is to move the surface off the edge.
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        // Docked, the handle owns a column of its own rather than sitting on
        // top of the filament: the configured width is the surface, and the
        // content takes what the handle leaves.
        width: root.fullscreen
          ? parent.width
          : Style.space(root.surfaceWidth) - Style.space(root.handleWidth)
        backend: root.backend
        focused: root.invoked && !root.collapsed
        // Keyed to the mapped surface, not `opened`, so the filament does not
        // freeze mid-frame during the exit slide.
        motionEnabled: root.motionEnabled && surface.visible
        // Stop rendering a full console behind a 24px handle, but only once the
        // narrowing has actually finished — hiding it on the first frame would
        // leave the animation playing against an empty surface.
        visible: !root.collapsed
          || shellItem.width > Style.space(root.handleWidth) + 1
        onReleaseFocusRequested: root.invoked = false
        onCloseRequested: root.close()
      }

      // The collapse handle, on the surface's own edge rather than in the
      // header, because it has to outlive the collapse that hides the header.
      // It is also the one control here that never depends on the keyboard
      // arriving: whatever else goes wrong, the pointer can always reach it.
      Rectangle {
        id: handle
        visible: !root.fullscreen
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: Style.space(root.handleWidth)
        color: Qt.rgba(Color.popups.background.r, Color.popups.background.g,
                       Color.popups.background.b, 0.97)

        Text {
          anchors.centerIn: parent
          // Pointing the way the click moves the surface: right folds it into
          // the edge, left brings it back out.
          text: root.collapsed ? "󰅁" : "󰅂"
          color: handleArea.containsMouse
            ? Color.popups.text : Qt.darker(Color.popups.text, 1.7)
          font.family: Style.font.family
          font.pixelSize: Style.font.icon
          Behavior on color {
            enabled: root.motionEnabled
            ColorAnimation { duration: 120 }
          }
        }

        MouseArea {
          id: handleArea
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.toggleCollapsed()
        }
      }
    }
  }
}
