pragma Singleton

import QtQuick
import Quickshell.Hyprland

// Everything that couples the console to Hyprland, and nothing else.
//
// Console.qml is about a window: it opens, it closes, it holds the keyboard or
// it does not. This file is about a compositor: finding our own toplevel,
// asking for it to be focused, and later placing it. Keeping the Hyprland
// import out of Console.qml is what keeps that separation honest, and it makes
// the no-Hyprland path one check here instead of a habit everywhere.
//
// It is deliberately not part of DesktopContext. That singleton reads the
// desktop to attach evidence to a question; this one acts on our own window.
// Merging them would make DesktopContext a drawer.
QtObject {
  id: root

  // Set for the lifetime of the process by the compositor that started it.
  // Everything below is a no-op without it, so a shell running under anything
  // else degrades to a plain window rather than throwing.
  readonly property bool available: String(Hyprland.requestSocketPath || "") !== ""

  // MEASURED: the toplevel model is populated lazily and starts EMPTY. Without
  // a refresh first, `Hyprland.toplevels.values` is `[]` and a lookup by title
  // fails with nothing to say why. The refresh is an IPC round trip, so it
  // cannot be awaited inline — it is issued early and again whenever a lookup
  // comes up empty, so the model is warm by the time it matters.
  function refresh() {
    if (!root.available) return
    Hyprland.refreshToplevels()
  }

  // Quickshell sets app_id per process, so every toplevel of the shell arrives
  // as org.quickshell: the title is the only stable identifier. The traversal
  // is the one DesktopContext already uses.
  function ownToplevel(title) {
    if (!root.available) return null
    var list = Hyprland.toplevels ? Hyprland.toplevels.values : []
    for (var i = 0; i < list.length; i++) {
      var entry = list[i]
      if (entry && String(entry.title || "") === title) return entry
    }
    return null
  }

  // Ask the compositor to focus our own window, and say whether the request
  // could be made at all. It never throws and never assumes: a false return is
  // the caller's cue to fall back, not an error.
  //
  // MEASURED (A1, three of three): HyprlandToplevel.wayland is a
  // foreign-toplevel handle whose activate() moves focus to a visible but
  // unfocused window with no remap and no blink.
  function activate(title) {
    var entry = root.ownToplevel(title)
    if (!entry) {
      // Either we are not mapped, or the model is cold. Warm it for next time
      // and let the caller use the guaranteed path now.
      root.refresh()
      return false
    }
    var handle = entry.wayland
    if (!handle) return false
    handle.activate()
    return true
  }

  // ------------------------------------------------------------------ placing
  //
  // Everything below acts on the ACTIVE window, because that is the only window
  // a dispatch can address without a selector. So it may only run once the
  // active window is known to be ours: placing someone else's window is worse
  // than leaving ours where the compositor put it.
  //
  // Focus arrives from the compositor as an event, not as the return of a call,
  // and the toplevel model refreshes over IPC. Both are why this is a request
  // now and a decision one round trip later, rather than a single function.

  property string pendingTitle: ""
  property int pendingWidth: 0
  property bool pendingFloating: false
  property bool pendingMaximized: false

  property Timer confirmTimer: Timer {
    interval: 120
    repeat: false
    onTriggered: root.applyPending()
  }

  // Ask for the shape the console wants: a column pinned to the right edge and
  // under whatever the bar reserves, or tiled so the user's windows sit beside
  // it, or maximized over the usable screen.
  function placeConsole(title, width, floating, maximized) {
    if (!root.available) return
    root.pendingTitle = String(title || "")
    root.pendingWidth = Math.round(width)
    root.pendingFloating = floating !== false
    root.pendingMaximized = maximized === true
    root.activate(root.pendingTitle)
    root.refresh()
    confirmTimer.restart()
  }

  function applyPending() {
    var title = root.pendingTitle
    var width = root.pendingWidth
    var floating = root.pendingFloating
    var maximized = root.pendingMaximized
    root.pendingTitle = ""

    if (title === "") return
    var active = Hyprland.activeToplevel
    if (!active || String(active.title || "") !== title) return

    // MEASURED: `hl.dsp.window.float` and `.pin` are the toggles Hyprland has
    // always had under other names, so they are only safe to send against a
    // known current state. That state is why the refresh above matters.
    var state = active.lastIpcObject || {}

    // MEASURED, live: Hyprland ignores a client's own xdg maximize request, so
    // the window property alone leaves the console exactly where it was. The
    // compositor's own state is 0 none / 1 maximized / 2 fullscreen, and 1 is
    // the one that stops at the usable area and leaves the bar clickable.
    var current = Number(state.fullscreen || 0)
    if (maximized) {
      // MEASURED: a pinned window will not maximize. Hyprland gates that on
      // binds:allow_pin_fullscreen, off by default and not ours to turn on;
      // without unpinning first the request half-lands — the client state
      // changes, the window does not move, and nothing reports a failure.
      if (state.pinned === true) root.dispatch("window.pin()", "pin active")
      if (current !== 1)
        root.dispatch("window.fullscreen_state({ internal = 1, client = 1 })",
                      "fullscreenstate 1 1")
      return
    }
    if (current !== 0)
      root.dispatch("window.fullscreen_state({ internal = 0, client = 0 })",
                    "fullscreenstate 0 0")

    if (state.floating !== floating) root.dispatch("window.float()", "togglefloating active")
    if (!floating) {
      // Tiled: the layout owns the geometry, and a pinned tiled window is a
      // contradiction the compositor resolves however it likes.
      if (state.pinned === true) root.dispatch("window.pin()", "pin active")
      return
    }
    if (state.pinned !== true) root.dispatch("window.pin()", "pin active")

    var box = root.columnBox(width)
    if (!box) return
    // MEASURED, and it cost the first live run: the table is keyed, not
    // positional. `{ x = 587, y = 1405 }` resizes; `{587,1405}` is accepted and
    // does nothing, which is this compositor's whole failure mode in one line.
    root.dispatch("window.resize({ x = " + box.width + ", y = " + box.height + " })",
                  "resizewindowpixel exact " + box.width + " " + box.height + ",activewindow")
    root.dispatch("window.move({ x = " + box.x + ", y = " + box.y + " })",
                  "movewindowpixel exact " + box.x + " " + box.y + ",activewindow")
  }

  // The right-hand column of the monitor that currently holds our window,
  // inside whatever the bar and anything else have reserved.
  function columnBox(width) {
    var monitor = Hyprland.focusedMonitor
    if (!monitor || width <= 0) return null
    // Hyprland reports monitor size in device pixels and everything else in
    // logical ones. Verified at scale 1; the division is what makes the other
    // scales arithmetic rather than a special case.
    var scale = monitor.scale > 0 ? monitor.scale : 1
    var logicalWidth = Math.round(monitor.width / scale)
    var logicalHeight = Math.round(monitor.height / scale)
    var reserved = (monitor.lastIpcObject || {}).reserved || [0, 0, 0, 0]
    var top = Number(reserved[1]) || 0
    var bottom = Number(reserved[3]) || 0
    return {
      width: width,
      height: Math.max(1, logicalHeight - top - bottom),
      x: monitor.x + logicalWidth - width,
      y: monitor.y + top
    }
  }

  // MEASURED, and it cost a whole round of tests: this Hyprland reads its
  // config in Lua, and a dispatch in the classic syntax does not fail there —
  // it silently does nothing. `usingLua` is the compositor telling us which
  // language it speaks, so neither form has to be guessed at.
  //
  // Nothing checks the result because there is nothing to check: dispatch()
  // returns void in this Quickshell, and `ok` from the socket means "accepted",
  // not "had an effect". The guard is the state read above, not a return value.
  function dispatch(lua, classic) {
    if (!root.available) return
    Hyprland.dispatch(Hyprland.usingLua ? "hl.dsp." + lua : classic)
  }

  Component.onCompleted: root.refresh()
}
