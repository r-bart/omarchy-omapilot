pragma Singleton

import QtQuick
import Quickshell.Hyprland
import Quickshell.Services.Mpris
import "Protocol.js" as Protocol

QtObject {
  function appIdFor(toplevel) {
    if (!toplevel) return ""
    var ipc = toplevel.lastIpcObject || {}
    var wayland = toplevel.wayland
    return String(wayland ? wayland.appId : (ipc.class || ipc.initialClass || ""))
  }

  function isShellToplevel(toplevel) {
    return Protocol.isShellAppId(appIdFor(toplevel))
  }

  function windowRecord(toplevel, includeTitle) {
    if (!toplevel) return null
    var ipc = toplevel.lastIpcObject || {}
    return {
      appId: appIdFor(toplevel),
      title: includeTitle ? (toplevel.title || ipc.title || "") : "",
      workspace: toplevel.workspace ? toplevel.workspace.id : undefined,
      monitor: toplevel.monitor ? toplevel.monitor.name : ""
    }
  }

  function snapshot() {
    var active = isShellToplevel(Hyprland.activeToplevel) ? null : Hyprland.activeToplevel
    var focusedWorkspace = Hyprland.focusedWorkspace
    var focusedMonitor = Hyprland.focusedMonitor
    var windows = []
    var toplevels = Hyprland.toplevels ? Hyprland.toplevels.values : []
    for (var i = 0; i < toplevels.length; i++)
      if (!isShellToplevel(toplevels[i])) windows.push(windowRecord(toplevels[i], false))

    var media = []
    var players = Mpris.players ? Mpris.players.values : []
    for (var j = 0; j < players.length; j++) {
      if (media.length >= 4) break
      var player = players[j]
      if (!player || (!player.isPlaying && !player.trackTitle && !player.trackArtist)) continue
      var status = String(MprisPlaybackState.toString(player.playbackState) || "").toLowerCase()
      if (["playing", "paused", "stopped"].indexOf(status) < 0)
        status = player.isPlaying ? "playing" : "stopped"
      media.push({
        player: player.identity || player.desktopEntry || "",
        title: player.trackTitle || "",
        artist: player.trackArtist || "",
        status: status
      })
    }

    return Protocol.normalizedDesktopContext({
      activeWindow: windowRecord(active, true),
      activeWorkspace: focusedWorkspace ? focusedWorkspace.id : undefined,
      focusedMonitor: focusedMonitor ? focusedMonitor.name : "",
      windows: windows,
      media: media
    })
  }

  function captureTarget() {
    var toplevel = isShellToplevel(Hyprland.activeToplevel) ? null : Hyprland.activeToplevel
    if (!toplevel) return null
    var ipc = toplevel.lastIpcObject || {}
    var at = Array.isArray(ipc.at) ? ipc.at : []
    var size = Array.isArray(ipc.size) ? ipc.size : []
    var bounds = at.length >= 2 && size.length >= 2 ? {
      x: Number(at[0]), y: Number(at[1]), width: Number(size[0]), height: Number(size[1])
    } : null
    return Protocol.normalizedCaptureTarget({
      appId: appIdFor(toplevel),
      title: toplevel.title || ipc.title || "",
      bounds: bounds
    })
  }
}
