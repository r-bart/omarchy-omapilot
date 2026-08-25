pragma Singleton

import QtQuick
import Quickshell.Hyprland
import Quickshell.Io

// Everything that couples the console to Hyprland, and nothing else.
//
// Console.qml is about a window: it opens, it closes, it holds the keyboard or
// it does not. This file is about a compositor: finding our own toplevel,
// asking for it to be focused, and giving it a shape. Keeping the Hyprland
// import out of Console.qml is what keeps that separation honest, and it makes
// the no-Hyprland path one check here instead of a habit everywhere.
//
// It is deliberately not part of DesktopContext. That singleton reads the
// desktop to attach evidence to a question; this one acts on our own window.
// Merging them would make DesktopContext a drawer.
//
// The rule the whole file is built around: **nothing here returns an answer.**
// `dispatch()` is void, the socket's `ok` means "accepted" rather than "had an
// effect", and an activation request can be ignored outright. So every request
// is followed by a look at what actually happened.
QtObject {
  id: root

  // Set for the lifetime of the process by the compositor that started it.
  // Everything below is a no-op without it, so a shell running under anything
  // else degrades to a plain window rather than throwing.
  readonly property bool available: String(Hyprland.requestSocketPath || "") !== ""

  // Every delay here is measured, and they are ordered on purpose:
  //
  //   confirm < focusGrace   a placement still in flight must not read as a
  //                          focus that never arrived
  //   remap   < focusGrace   the blink finishes inside one gesture
  //   verify  > confirm      the dispatches have to have been sent first
  readonly property int confirmDelay: 40
  readonly property int focusGraceDelay: 150
  readonly property int remapDelay: 80
  readonly property int verifyDelay: 220

  // MEASURED: the toplevel model is populated lazily and starts EMPTY. Without
  // a refresh first, `Hyprland.toplevels.values` is `[]` and a lookup by title
  // fails with nothing to say why. Monitors go with it: the column is measured
  // against the bar's reserved strip, and a stale monitor is a stale strip.
  // Both are IPC round trips, so neither can be awaited inline.
  function refresh() {
    if (!root.available) return
    Hyprland.refreshToplevels()
    Hyprland.refreshMonitors()
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

  // Ask the compositor to focus our own window. The return says only that the
  // request could be made — never that it was granted. Callers must look.
  //
  // MEASURED: the same call moved focus three times out of three one night and
  // was silently ignored the next morning, from an unchanged probe on an
  // unchanged compositor.
  function activate(title) {
    // Always, before anything else. Whoever activates is about to look at what
    // happened — at the focus, at the geometry — and `lastIpcObject` is a cache
    // that only a refresh moves. MEASURED: without this the snapshot taken a
    // moment later described the window as it was at the last refresh, so a
    // drag the user had done since was invisible and got overwritten.
    root.refresh()
    var entry = root.ownToplevel(title)
    // Not mapped, or the model was cold and the refresh above has not landed
    // yet. Either way the caller falls back to its guaranteed path.
    if (!entry) return false
    var handle = entry.wayland
    if (!handle) return false
    handle.activate()
    return true
  }

  // MEASURED: `Array.isArray` is FALSE for the arrays inside `lastIpcObject`.
  // They index and stringify like arrays, so the mistake survives every casual
  // check — it cost a snapshot that silently returned null and a verifier that
  // reported a perfect placement as a failure. Length is the honest test.
  function numbers(value, count) {
    if (!value || typeof value.length !== "number" || value.length < count) return null
    var out = []
    for (var i = 0; i < count; i++) {
      var n = Number(value[i])
      if (!isFinite(n)) return null
      out.push(Math.round(n))
    }
    return out
  }

  // ------------------------------------------------------------------- shapes
  //
  // A shape is what the console wants to look like: floating in its column,
  // tiled among the user's windows, or maximized over the usable screen. `box`
  // is an explicit geometry when there is one to preserve, and null when the
  // column should be recomputed from the current monitor.

  function columnShape(width, floating, maximized) {
    return {
      width: Math.round(width),
      floating: floating !== false,
      maximized: maximized === true,
      box: null
    }
  }

  // The shape a window currently has, as the compositor sees it.
  //
  // MEASURED, and the reason this exists: a remap is a brand-new window to
  // Hyprland. It comes back tiled at a default size, losing the column and any
  // drag the user had done by hand. Carrying the shape across is what keeps a
  // refocus from quietly overwriting geometry that belongs to the user.
  function snapshot(title) {
    var entry = root.ownToplevel(title)
    if (!entry) return null
    var state = entry.lastIpcObject || {}
    var at = root.numbers(state.at, 2)
    var size = root.numbers(state.size, 2)
    if (!at || !size) return null
    return {
      width: size[0],
      floating: state.floating === true,
      maximized: Number(state.fullscreen || 0) === 1,
      box: { x: at[0], y: at[1], width: size[0], height: size[1] }
    }
  }

  // ------------------------------------------------------------------ placing
  //
  // The dispatches act on the ACTIVE window, because that is the only window
  // one can address without a selector. So placing may only run once the active
  // window is known to be ours — and this file never makes it ours, because
  // taking the keyboard to move a window the user is not looking at is worse
  // than not moving it. Console.qml holds the request until it has focus.

  property string pendingTitle: ""
  property var pendingShape: null

  property Timer confirmTimer: Timer {
    interval: root.confirmDelay
    repeat: false
    onTriggered: root.applyPending()
  }

  function place(title, shape) {
    if (!root.available || !shape) return
    root.pendingTitle = String(title || "")
    root.pendingShape = shape
    root.attempts = 0
    root.refresh()
    confirmTimer.restart()
  }

  function applyPending() {
    var title = root.pendingTitle
    var shape = root.pendingShape
    root.pendingTitle = ""
    root.pendingShape = null
    if (title === "" || !shape) return

    var active = Hyprland.activeToplevel
    if (!active || String(active.title || "") !== title) {
      console.warn("OmaPilot: console is not the active window; placement skipped")
      return
    }

    // MEASURED: `float`, `pin` and `fullscreen_state` are the toggles Hyprland
    // has always had under other names, so they are only safe to send against a
    // known current state. That state is why the refresh above matters.
    var state = active.lastIpcObject || {}
    var current = Number(state.fullscreen || 0)
    var box = null

    if (shape.maximized) {
      // MEASURED: a pinned window will not maximize. Hyprland gates that on
      // binds:allow_pin_fullscreen, off by default and not ours to turn on;
      // without unpinning first the request half-lands — the client state
      // changes, the window does not move, and nothing reports a failure.
      if (state.pinned === true) root.dispatch("window.pin()", "pin active")
      if (current !== 1)
        root.dispatch("window.fullscreen_state({ internal = 1, client = 1 })",
                      "fullscreenstate 1 1")
    } else {
      if (current !== 0)
        root.dispatch("window.fullscreen_state({ internal = 0, client = 0 })",
                      "fullscreenstate 0 0")
      if (state.floating !== shape.floating)
        root.dispatch("window.float()", "togglefloating active")

      if (!shape.floating) {
        // Tiled: the layout owns the geometry, and a pinned tiled window is a
        // contradiction the compositor resolves however it likes.
        if (state.pinned === true) root.dispatch("window.pin()", "pin active")
      } else {
        if (state.pinned !== true) root.dispatch("window.pin()", "pin active")
        box = shape.box || root.columnBox(shape.width)
        if (box) {
          // MEASURED, and it cost the first live run: the table is keyed, not
          // positional. `{ x = 587, y = 1405 }` resizes; `{587,1405}` is
          // accepted and does nothing, which is this compositor's whole failure
          // mode in one line.
          root.dispatch("window.resize({ x = " + box.width + ", y = " + box.height + " })",
                        "resizewindowpixel exact " + box.width + " " + box.height
                          + ",activewindow")
          root.dispatch("window.move({ x = " + box.x + ", y = " + box.y + " })",
                        "movewindowpixel exact " + box.x + " " + box.y + ",activewindow")
        }
      }
    }

    root.expect(title, { maximized: shape.maximized, floating: shape.floating, box: box })
  }

  // ---------------------------------------------------------------- verifying

  property string expectTitle: ""
  property var expected: null
  property int attempts: 0

  property Timer verifyTimer: Timer {
    interval: root.verifyDelay
    repeat: false
    onTriggered: root.checkPlacement()
  }

  function expect(title, shape) {
    root.expectTitle = title
    root.expected = shape
    root.refresh()
    verifyTimer.restart()
  }

  // Nothing about a dispatch says whether it worked, so this is the only place
  // that can tell. One retry, because the failures seen so far were either
  // permanent — a syntax the compositor accepts and ignores, a state it
  // refuses — or a lost race, and retrying a permanent refusal is only a slower
  // way to be wrong. After that it says so out loud: a console that is silently
  // the wrong shape is the hardest kind of bug to be told about.
  function checkPlacement() {
    var title = root.expectTitle
    var want = root.expected
    root.expectTitle = ""
    root.expected = null
    if (title === "" || !want) return

    var entry = root.ownToplevel(title)
    if (!entry) return
    var state = entry.lastIpcObject || {}
    if (root.matches(state, want)) return

    if (root.attempts < 1) {
      root.attempts += 1
      root.pendingTitle = title
      root.pendingShape = {
        width: want.box ? want.box.width : 0,
        floating: want.floating,
        maximized: want.maximized,
        box: want.box
      }
      confirmTimer.restart()
      return
    }
    console.warn("OmaPilot: the compositor did not take the console's placement"
      + " (wanted " + JSON.stringify(want)
      + ", got floating=" + state.floating + " pinned=" + state.pinned
      + " fullscreen=" + state.fullscreen
      + " size=" + JSON.stringify(state.size) + " at=" + JSON.stringify(state.at) + ")")
  }

  function matches(state, want) {
    if (want.maximized) return Number(state.fullscreen || 0) === 1
    if (Number(state.fullscreen || 0) !== 0) return false
    if ((state.floating === true) !== want.floating) return false
    if (!want.floating) return true
    if (state.pinned !== true) return false
    if (!want.box) return true
    var at = root.numbers(state.at, 2)
    var size = root.numbers(state.size, 2)
    if (!at || !size) return false
    // Two pixels of slack: the dispatches are exact, but borders and gaps are
    // the compositor's to add and not worth a retry over.
    return Math.abs(size[0] - want.box.width) <= 2
      && Math.abs(size[1] - want.box.height) <= 2
      && Math.abs(at[0] - want.box.x) <= 2
      && Math.abs(at[1] - want.box.y) <= 2
  }

  // ------------------------------------------------------------- the outer gap
  //
  // A window's border is drawn OUTSIDE the box hyprctl reports, so a column
  // placed flush against the bar's reserved strip has its top border underneath
  // the bar — measured, and visible. Tiled windows do not have that problem
  // because the compositor insets them by gaps_out plus the border, and matching
  // that is also what makes the console line up with everything else on screen
  // instead of sitting one gap proud of it.
  //
  // Neither number is on the Hyprland IPC object, so they are read once. If the
  // read fails the defaults are Hyprland's own, and the console is a few pixels
  // off rather than broken.
  property int outerGap: 10
  property int borderSize: 2
  readonly property int edgeInset: outerGap + borderSize

  property Process gapReader: Process {
    running: false
    command: ["hyprctl", "-j", "getoption", "general:gaps_out"]
    stdout: StdioCollector {
      onStreamFinished: {
        var top = root.firstCssGap(text)
        if (top >= 0) root.outerGap = top
        borderReader.running = true
      }
    }
  }

  property Process borderReader: Process {
    running: false
    command: ["hyprctl", "-j", "getoption", "general:border_size"]
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          var value = Number(JSON.parse(text).int)
          if (isFinite(value) && value >= 0) root.borderSize = value
        } catch (error) {
          // Keep the default. A console a couple of pixels out is not worth a
          // failure path of its own.
        }
      }
    }
  }

  // `gaps_out` comes back as CSS shorthand — "10" or "10 20" or four values —
  // and only the first one is ever different from the rest in practice. The
  // column is inset equally, so the first is the one that matters.
  function firstCssGap(payload) {
    try {
      var parts = String(JSON.parse(payload).css || "").trim().split(/\s+/)
      var value = Number(parts[0])
      return isFinite(value) && value >= 0 ? value : -1
    } catch (error) {
      return -1
    }
  }

  // The right-hand column of the monitor that currently holds our window,
  // inside whatever the bar and anything else have reserved, and inset by the
  // same gap the compositor gives every tiled window.
  function columnBox(width) {
    var monitor = Hyprland.focusedMonitor
    if (!monitor || width <= 0) return null
    // Hyprland reports monitor size in device pixels and everything else in
    // logical ones. Verified at scale 1; the division is what makes the other
    // scales arithmetic rather than a special case.
    var scale = monitor.scale > 0 ? monitor.scale : 1
    var logicalWidth = Math.round(monitor.width / scale)
    var logicalHeight = Math.round(monitor.height / scale)
    var reserved = root.numbers((monitor.lastIpcObject || {}).reserved, 4) || [0, 0, 0, 0]
    var top = reserved[1]
    var bottom = reserved[3]
    var inset = root.edgeInset
    return {
      width: width,
      height: Math.max(1, logicalHeight - top - bottom - inset * 2),
      x: monitor.x + logicalWidth - width - inset,
      y: monitor.y + top + inset
    }
  }

  // MEASURED, and it cost a whole round of tests: this Hyprland reads its
  // config in Lua, and a dispatch in the classic syntax does not fail there —
  // it silently does nothing. `usingLua` is the compositor telling us which
  // language it speaks, so neither form has to be guessed at.
  function dispatch(lua, classic) {
    if (!root.available) return
    Hyprland.dispatch(Hyprland.usingLua ? "hl.dsp." + lua : classic)
  }

  Component.onCompleted: {
    root.refresh()
    if (root.available) gapReader.running = true
  }
}
