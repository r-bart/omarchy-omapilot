.pragma library

// The chords currently bound to OmaPilot, read from the user's own Hyprland
// bindings.
//
// Shown, never edited. The file belongs to the user — the installer writes one
// marked block into it at an explicit request and then leaves, and its own
// comment says to edit the bindings freely. A second place claiming to own a
// keybinding is how the two end up disagreeing, and Hyprland only ever obeys
// the file.
//
// Reading it is worth doing because nothing else tells the user what their
// chords are, and because a chord the installer skipped over a collision is
// invisible today: it says so on standard error, which no one sees.

// Matches the installer's own shape and a hand-edited one alike: either quote
// style, and the command on the following line, which is how it is written.
var bindPattern =
  /o\.bind\(\s*(["'])([^"']+)\1\s*,\s*(["'])([^"']*)\3\s*,\s*(["'])([^"']*)\5\s*\)/g

function installedChords(text, pluginId) {
  var source = String(text === undefined || text === null ? "" : text)
  var id = String(pluginId === undefined || pluginId === null ? "" : pluginId)
  if (source === "" || id === "") return []

  var result = []
  var seen = ({})
  bindPattern.lastIndex = 0
  var match = bindPattern.exec(source)
  while (match !== null) {
    var command = match[6]
    if (command.indexOf(id) >= 0) {
      var chord = match[2].replace(/\s+/g, " ").replace(/^ | $/g, "")
      // Wherever it sits in the file, not only inside the managed block: a
      // chord the user moved out of it is still their chord for this.
      if (chord !== "" && !seen[chord]) {
        seen[chord] = true
        result.push({ chord: chord, description: String(match[4] || "").replace(/^\s+|\s+$/g, "") })
      }
    }
    match = bindPattern.exec(source)
  }
  return result
}

// The method each chord calls, for callers that want to match a chord to what
// it does rather than to its description.
function methodFor(command, pluginId) {
  var text = String(command === undefined || command === null ? "" : command)
  var id = String(pluginId === undefined || pluginId === null ? "" : pluginId)
  if (id === "" || text.indexOf(id) < 0) return ""
  var tail = text.slice(text.indexOf(id) + id.length).replace(/^\s+|\s+$/g, "")
  return tail.split(/\s+/)[0] || ""
}
