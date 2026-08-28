import QtQuick
import QtTest
import "../components/Hotkeys.js" as Hotkeys

TestCase {
  name: "OmaPilotHotkeys"

  readonly property string pluginId: "io.github.spencerbull.omapilot"

  readonly property string managedBlock: '\
-- BEGIN OmaPilot managed hotkeys\n\
-- Added at the user request from OmaPilot settings. Edit these bindings freely.\n\
hl.unbind("SUPER + A")\n\
o.bind("SUPER + A", "Talk to OmaPilot",\n\
  "omarchy-shell -q io.github.spencerbull.omapilot voiceToggle")\n\
hl.unbind("SUPER + ALT + T")\n\
o.bind("SUPER + ALT + T", "Fix the selected text with OmaPilot",\n\
  "omarchy-shell -q io.github.spencerbull.omapilot fixSelection")\n\
-- END OmaPilot managed hotkeys\n'

  function test_readsTheChordsTheInstallerWrote() {
    // The command sits on the line after the chord, which is how the installer
    // writes it, so the parser has to span the newline.
    var chords = Hotkeys.installedChords(managedBlock, pluginId)
    compare(chords.length, 2)
    compare(chords[0].chord, "SUPER + A")
    compare(chords[0].description, "Talk to OmaPilot")
    compare(chords[1].chord, "SUPER + ALT + T")
    compare(chords[1].description, "Fix the selected text with OmaPilot")
  }

  function test_findsAChordTheUserMovedOutOfTheBlock() {
    // The block is where the installer writes, not where the chord has to
    // live. Someone who moved it still has that chord.
    var moved = 'o.bind("SUPER + SHIFT + K", "My own name for it",\n'
      + '  "omarchy-shell -q io.github.spencerbull.omapilot fixSelection")\n'
    var chords = Hotkeys.installedChords(moved, pluginId)
    compare(chords.length, 1)
    compare(chords[0].chord, "SUPER + SHIFT + K")
    compare(chords[0].description, "My own name for it")
  }

  function test_readsHandEditedBindingsWhateverQuotesTheyUsed() {
    var single = "o.bind('SUPER + ALT + N', 'New OmaPilot chat', "
      + "'omarchy-shell -q io.github.spencerbull.omapilot newChat')\n"
    var chords = Hotkeys.installedChords(single, pluginId)
    compare(chords.length, 1)
    compare(chords[0].chord, "SUPER + ALT + N")
  }

  function test_ignoresEverybodyElsesBindings() {
    var others = 'o.bind("SUPER + Q", "Close window", "hl.dsp.window.close()")\n'
      + 'o.bind("SUPER + RETURN", "Terminal", "uwsm app -- foot")\n'
      + managedBlock
    var chords = Hotkeys.installedChords(others, pluginId)
    compare(chords.length, 2)
    for (var i = 0; i < chords.length; i++)
      verify(chords[i].chord.indexOf("SUPER") === 0)
  }

  function test_aChordSkippedOverACollisionSimplyIsNotThere() {
    // The installer leaves a colliding chord alone and says so on standard
    // error, which nobody sees. Its absence here is what the user can see.
    var collided = managedBlock.replace(
      'o.bind("SUPER + A", "Talk to OmaPilot",\n  "omarchy-shell -q io.github.spencerbull.omapilot voiceToggle")\n', "")
    var chords = Hotkeys.installedChords(collided, pluginId)
    compare(chords.length, 1)
    compare(chords[0].chord, "SUPER + ALT + T")
  }

  function test_neverReportsTheSameChordTwice() {
    var duplicated = managedBlock + managedBlock
    compare(Hotkeys.installedChords(duplicated, pluginId).length, 2)
  }

  function test_emptyOrUnreadableInputIsAnEmptyList() {
    compare(Hotkeys.installedChords("", pluginId).length, 0)
    compare(Hotkeys.installedChords(null, pluginId).length, 0)
    compare(Hotkeys.installedChords(undefined, pluginId).length, 0)
    compare(Hotkeys.installedChords(managedBlock, "").length, 0)
    compare(Hotkeys.installedChords(managedBlock, null).length, 0)
  }

  function test_namesTheMethodEachChordCalls() {
    compare(Hotkeys.methodFor(
      "omarchy-shell -q io.github.spencerbull.omapilot fixSelection", pluginId), "fixSelection")
    compare(Hotkeys.methodFor(
      "omarchy-shell io.github.spencerbull.omapilot newChat", pluginId), "newChat")
    compare(Hotkeys.methodFor("something else entirely", pluginId), "")
    compare(Hotkeys.methodFor("", pluginId), "")
  }
}
