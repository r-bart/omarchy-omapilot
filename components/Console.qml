import QtQuick
import Quickshell
import qs.Commons
import "." as OmaPilot

// The console: OmaPilot's deliberate surface, and a window like any other.
//
// This is the third ambient surface of design/ambient-ux.md — the node listens,
// the curtain answers, the console is where typing, choices, history, settings,
// and approvals live. It loads the way Panel.qml and ContextCaptureOverlay.qml
// load: as a child of the plugin's own tree, because the host resolves exactly
// one entry point per plugin and an extra `entryPoints` key would be silently
// ignored.
//
// It used to be a layer-shell surface, and that was measured to be a trap. A
// probe of two pure OnDemand surfaces — one on Overlay, one on Top, with no
// plugin code at all — trapped the keyboard in both: on Hyprland 0.56.2 a
// layer-shell surface does not hand focus back whatever its interactivity, so
// an open console could strand a session with no way out but the keyboard it
// was holding. A real xdg-toplevel gets the compositor's ordinary focus
// handling for free, and with it the window cycle, the close button, and every
// keybinding the user already has.
//
// The window stays mechanical on purpose: identity, geometry, and lifecycle.
// Everything with an opinion lives in ConsoleContent, so the layout can iterate
// offscreen while only this file needs a live Wayland session.
Item {
  id: root

  property var backend: null
  property var targetScreen: null
  property bool motionEnabled: true
  // Value at scale 1; Style.space applies the host's spacing scale below.
  property int surfaceWidth: 440
  // Same content, whole screen. ConsoleContent was split from this window so a
  // second host could exist; this is that host, and it costs one property
  // rather than a second surface to keep in step. Docked stays the default.
  property bool fullscreen: false
  // Whether the compositor should hold a column open for the console the way it
  // holds the strip open for the bar, so windows tile beside it instead of
  // underneath. Off by default: reserving reflows the user's layout every time
  // the console opens, which is a cost they should choose, not inherit.
  property bool reservesSpace: false

  property bool opened: false
  // Mapped. Owners that tear the console down (the loader in Ambient.qml) must
  // wait for this, not for `opened`.
  readonly property bool engaged: surface.visible

  // Quickshell sets app_id per process, so every toplevel of the shell arrives
  // as org.quickshell and the title is the only stable identifier — Omarchy
  // singles out its own dev gallery the same way. One source of truth for it,
  // because everything that has to find this window matches on it.
  readonly property string windowTitle: "OmaPilot"

  // Derived, never stored, and `visible` is part of the expression rather than
  // decoration. Measured: after the compositor closes the window Qt never emits
  // active=false, so a stored flag keeps a stale true and the next open never
  // corrects it — it was already true.
  readonly property bool focused: surface.visible && shellItem.windowActive

  // True only for the instant the focus fallback takes to unmap and remap the
  // window. `opened` deliberately stays true across it, so nothing downstream
  // reads a blink as a close.
  property bool remapping: false

  function open(withFocus) {
    if (!opened && backend && typeof backend.latchDesktopContext === "function")
      backend.latchDesktopContext()
    opened = true
    if (withFocus === false) return
    // Mapping usually takes the compositor's keyboard, and "usually" is not a
    // guarantee we can build on — MEASURED: three opens in a row where the
    // window mapped and the keyboard stayed where it was, which also left the
    // console sitting unplaced in whatever slot the tiling gave it. The ladder
    // asks, looks, and falls back, so it costs nothing when focus does arrive.
    takeFocus()
    Qt.callLater(function() { content.forceComposerFocus() })
  }

  // Take the keyboard back for a window the user can already see.
  //
  // Activating our own toplevel is a request, not a command, and MEASURED it is
  // not always granted: the same call moved focus three times out of three one
  // night and was silently ignored the next morning, from an unchanged probe on
  // an unchanged compositor. So its return value only says the request went
  // out, and the only proof of focus is the focus itself.
  //
  // Hence the check rather than a branch: ask, look, and if the keyboard did
  // not arrive, remap. A window hidden and shown again comes back focused —
  // measured, and reliable every time it has been tried. The ladder ends
  // somewhere guaranteed, so this has no failure branch.
  //
  // Not `focus()`: QQuickItem already has a final property by that name, and
  // shadowing it is a warning today and a silent misbinding tomorrow.
  function takeFocus() {
    ConsolePlacement.activate(root.windowTitle)
    focusCheck.restart()
  }

  function close() {
    // `opened` first, then the remap flag, or clearing the flag would map the
    // window again for an instant on its way out.
    opened = false
    // A remap in flight would otherwise swallow this close: the window is
    // already hidden, so nothing downstream would be told it had gone.
    focusCheck.stop()
    remapTimer.stop()
    remapping = false
    pendingShape = null
    if (backend && typeof backend.clearDesktopContextLatch === "function")
      backend.clearDesktopContextLatch()
    // The panel drops a live text action when it closes and this surface did
    // not, so a console user kept an action pointing at a window address that
    // had stopped meaning anything.
    if (backend && typeof backend.dismissTextAction === "function")
      backend.dismissTextAction()
    resetLanes.restart()
  }

  // Three states, not two. A window can be visible without holding the
  // keyboard, and pressed over a console the user can already see but is not
  // typing into, the bar icon means "take me there" — hiding what someone just
  // asked for is the surprise this project has already paid for twice.
  //
  // A dedicated fold-to-a-handle state was tried and removed: it spent a
  // permanent column of the surface on a gesture the bar icon already
  // performs, from a control the user has to discover, and left the console
  // mapped and holding a strip of the screen to no purpose.
  function toggle() {
    if (!opened) open(true)
    else if (!root.focused) takeFocus()
    else close()
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

  // A text action lands in the chat lane too: the chooser, the answer, and the
  // Replace and Regenerate controls under it only render there. open(true)
  // already queues the composer focus, and it lands after this returns, by
  // which time the lane is the chat one — which is what makes Enter the fourth
  // action rather than a keystroke into nothing.
  function openTextAction() {
    open(true)
    content.showChat(false)
  }

  // The console asks to be a column pinned to the right edge, under the bar.
  // It asks at exactly three moments — when it maps, and when either setting
  // that decides its shape changes while it is up — and at no other. In
  // between the geometry belongs to the user: a window they dragged or resized
  // by hand stays where they put it until the next of the three. Nothing is
  // persisted, so the next open is the column again.
  //
  // `reservesSpace` is the same promise the exclusive zone used to make, kept
  // the way a window keeps it: not floating. Tiled, the layout puts the user's
  // windows beside the console instead of behind it, and opening or closing it
  // reflows them.
  // What the compositor still owes us, or null.
  //
  // A shape is queued rather than sent when we do not hold the keyboard, because
  // every dispatch acts on the active window — asking would mean taking it, and
  // yanking the keyboard because a setting changed while the user was working
  // somewhere else is worse than a console that squares itself up a moment
  // later. It is sent the next time the console has focus, which is the next
  // time the user is looking at it anyway.
  property var pendingShape: null

  function applyPlacement() {
    if (!engaged) return
    pendingShape = ConsolePlacement.columnShape(Style.space(root.surfaceWidth),
                                                !root.reservesSpace, root.fullscreen)
    flushShape()
  }

  function flushShape() {
    if (!pendingShape || !engaged || !focused) return
    var shape = pendingShape
    pendingShape = null
    ConsolePlacement.place(root.windowTitle, shape)
  }

  onEngagedChanged: {
    if (!engaged) return
    // A remap already carries the shape it has to put back; only a real map
    // has to go and ask the settings for one.
    if (!pendingShape) applyPlacement()
    flushShape()
  }
  onFocusedChanged: if (focused) flushShape()
  onSurfaceWidthChanged: applyPlacement()
  onReservesSpaceChanged: applyPlacement()
  // Coming back from the whole screen is the fourth moment, and it is the same
  // moment: the column has to be asked for again because leaving maximized
  // returns the window to wherever the compositor last had it, not to us.
  //
  // And unlike the others it may take the keyboard. A width or a tiling change
  // is a consequence of something the user did elsewhere, so it waits until
  // they are looking at the console; changing surface IS the request, and over
  // IPC — a hotkey, another surface's switch — it arrives with the console
  // unfocused. Deferring that means pressing the key and watching nothing
  // happen until you click the window.
  onFullscreenChanged: {
    applyPlacement()
    if (engaged && !focused) takeFocus()
  }

  // Did the compositor grant the activation? Long enough for the focus event
  // to have arrived and come back through Qt, short enough that the fallback
  // still reads as one gesture rather than two.
  Timer {
    id: focusCheck
    interval: ConsolePlacement.focusGraceDelay
    repeat: false
    onTriggered: {
      if (!root.opened || root.focused) return
      // MEASURED: to the compositor a remap is a brand-new window. It comes
      // back tiled at a default size, losing the column and any drag the user
      // had done by hand. So the shape is carried across rather than
      // recomputed — recomputing would quietly overwrite geometry that, until
      // the next of the three moments, belongs to the user.
      //
      // Unless something is already owed. A shape still pending has not been
      // applied yet, so the window is not wearing it: photographing it here
      // would capture the slot the tiling happened to give us and put *that*
      // back, which is how an unplaced console stays unplaced forever.
      if (!root.pendingShape)
        root.pendingShape = ConsolePlacement.snapshot(root.windowTitle)
      root.remapping = true
      remapTimer.restart()
    }
  }

  // MEASURED: one millisecond is not enough. Qt coalesces the two changes and
  // the surface never leaves the screen, so nothing remaps and no focus comes
  // back. This is a frame or two, which is below the threshold of a blink and
  // above the threshold of the compositor noticing.
  Timer {
    id: remapTimer
    interval: ConsolePlacement.remapDelay
    repeat: false
    onTriggered: root.remapping = false
  }

  // The lanes go back to chat once the window is gone rather than while it is
  // going: the compositor animates the last frame it was handed, and a reset
  // drawn into that frame is a glitch on the way out. Keyed to the close and
  // not to the visibility, because a remap hides the window too and means the
  // opposite — measured: closing mid-remap used to skip the reset entirely and
  // the console reopened in whatever lane it had been left in.
  Timer {
    id: resetLanes
    interval: 120
    repeat: false
    onTriggered: if (!root.opened) content.reset()
  }

  FloatingWindow {
    id: surface
    title: root.windowTitle
    // Advisory only. A layer-shell surface belongs to an output; a toplevel is
    // placed by the compositor, which will honour this or not as it sees fit.
    screen: root.targetScreen
    color: "transparent"
    implicitWidth: Style.space(root.surfaceWidth)
    // Only consulted until the placement dispatch exists, and on any compositor
    // that cannot be dispatched to: ask for the full height of the output.
    implicitHeight: root.targetScreen ? root.targetScreen.height : Style.space(900)
    // The stored width is already clamped to 360-560 in OmaPilotStore.configure;
    // this is the same floor, so a drag cannot squash the console below the
    // narrowest width the settings will offer.
    minimumSize: Qt.size(Style.space(360), Style.space(280))
    // Maximized, never fullscreen. Real fullscreen covers the bar, and the bar
    // holds the icon that dismisses the console: a state that hides its own
    // exit. Maximized fills the usable screen and leaves the bar clickable,
    // which is what "whole screen" was always asking for.
    //
    // MEASURED: Hyprland ignores this — a client's own xdg maximize request
    // does nothing here, and ConsolePlacement asks the compositor instead. It
    // stays because it is the portable half of the same request, and it is the
    // only half a compositor without a dispatcher to talk to would honour.
    maximized: root.fullscreen
    visible: root.opened && !root.remapping
    // No slide of our own any more. Omarchy pins layersIn/layersOut to a global
    // fade, which is why the layer-shell console animated its own x; a toplevel
    // gets windowsIn/windowsOut instead, the animation the user already has for
    // every other window.

    // The X, or Super+W, or any other way the compositor closes a window. This
    // is a close, not a hide: the desktop-context latch freezes the active
    // window and workspace from the moment the console opened, and held past a
    // close it would attach a desktop that no longer exists to the next
    // question.
    onClosed: root.close()

    Item {
      id: shellItem
      anchors.fill: parent
      // Whether the compositor has given us the keyboard, as Qt sees it. It is
      // an attached property, so it only resolves inside the window: read here
      // and lifted to `root.focused` above.
      readonly property bool windowActive: Window.active

      // Opaque, where the layer-shell surface painted itself at 0.97. A layer
      // surface is exempt from window opacity rules; a toplevel is not, and
      // Omarchy tags every window for one. Our own alpha was there to stand in
      // for a rule that did not reach us, and it now stacks with the rule that
      // does — measured as barely a value per channel, but it is still a layer
      // shell assumption carried into a window. The compositor owns the
      // translucency, which means the user's own looknfeel setting governs it
      // and the console reads like every other window on their desktop.
      Rectangle {
        anchors.fill: parent
        color: Color.popups.background
      }

      OmaPilot.ConsoleContent {
        id: content
        anchors.fill: parent
        backend: root.backend
        focused: root.focused
        motionEnabled: root.motionEnabled && surface.visible
        onCloseRequested: root.close()
      }
    }
  }
}
