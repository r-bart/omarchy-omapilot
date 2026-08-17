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
    var windows = []
    var toplevels = Hyprland.toplevels ? Hyprland.toplevels.values : []
    for (var i = 0; i < toplevels.length; i++)
      if (!isShellToplevel(toplevels[i])) windows.push(windowRecord(toplevels[i], false))

    var media = []
    var players = Mpris.players ? Mpris.players.values : []
    for (var j = 0; j < players.length; j++) {
      if (media.length >= 4) break
      var player = players[j]
      if (!player || !player.isPlaying) continue
      media.push({
        player: player.identity || player.desktopEntry || "",
        title: player.trackTitle || "",
        artist: player.trackArtist || ""
      })
    }

    return Protocol.normalizedDesktopContext({
      activeWindow: windowRecord(active, true),
      windows: windows,
      media: media
    })
  }
}
