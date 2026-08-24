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

  Component.onCompleted: root.refresh()
}
