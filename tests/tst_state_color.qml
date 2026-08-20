import QtQuick
import QtTest
import "../components/StateColor.js" as StateColor

TestCase {
  name: "OmaPilotStateColor"

  readonly property color urgent: "#a55555"

  function phases() {
    return ["listening", "thinking", "answering"]
  }

  function test_everyStateIsVisiblyDistinctInAnyTheme() {
    // A blue accent, a warm one, a green one, and a near-grey one. The green
    // case is the interesting one: an absolute "success green" would have
    // collided with the accent, which is why the states rotate instead.
    var accents = ["#7aa2f7", "#c4746e", "#8fb573", "#cacccc", "#111111", "#ffffff"]
    for (var a = 0; a < accents.length; a++) {
      var accent = accents[a]
      var seen = []
      for (var p = 0; p < phases().length; p++)
        seen.push(StateColor.forPhase(accent, urgent, phases()[p]))
      for (var i = 0; i < seen.length; i++) {
        for (var j = i + 1; j < seen.length; j++) {
          // Either a clear hue separation, or a clear saturation separation for
          // a monochrome accent whose listening state stays grey on purpose.
          var byHue = StateColor.hueDistance(seen[i], seen[j]) > 0.07
          var bySaturation = Math.abs(seen[i].hslSaturation - seen[j].hslSaturation) > 0.2
          verify(byHue || bySaturation,
            "states " + phases()[i] + "/" + phases()[j] + " too close for accent " + accent)
        }
      }
    }
  }

  function test_failureUsesTheThemeUrgentRoleUnchanged() {
    // Urgent is the one role a theme defines specifically to mean "wrong", so it
    // is passed through rather than derived.
    var failed = StateColor.forPhase("#7aa2f7", urgent, "error")
    compare(Qt.colorEqual(failed, urgent), true)
  }

  function test_listeningSpeaksWithTheThemeAccent() {
    // Listening keeps the accent's own hue; only saturation and lightness are
    // clamped for legibility.
    var accent = "#7aa2f7"
    var listening = StateColor.forPhase(accent, urgent, "listening")
    verify(StateColor.hueDistance(listening, accent) < 0.001)
  }

  function test_aDesaturatedAccentStillProducesThreeDifferentStates() {
    // A monochrome theme must keep its identity state monochrome — inventing a
    // hue for listening would put a colour on screen the palette never defines.
    // The derived states still lift saturation, because rotating hue on a grey
    // yields grey and would leave all three identical.
    var grey = "#cacccc"
    var listening = StateColor.forPhase(grey, urgent, "listening")
    var thinking = StateColor.forPhase(grey, urgent, "thinking")
    var answering = StateColor.forPhase(grey, urgent, "answering")
    verify(!Qt.colorEqual(listening, thinking))
    verify(!Qt.colorEqual(thinking, answering))
    verify(!Qt.colorEqual(listening, answering))
    verify(listening.hslSaturation < 0.1, "listening must not invent saturation a grey theme lacks")
    verify(thinking.hslSaturation > 0.2, "derived states need saturation to be distinguishable")
  }

  function test_lightnessStaysInALegibleBandForExtremeAccents() {
    // Pure black and pure white accents must not produce an invisible state.
    var accents = ["#000000", "#ffffff"]
    for (var a = 0; a < accents.length; a++) {
      for (var p = 0; p < phases().length; p++) {
        var result = StateColor.forPhase(accents[a], urgent, phases()[p])
        verify(result.hslLightness >= 0.42 && result.hslLightness <= 0.72,
          "lightness out of band for " + accents[a] + " " + phases()[p])
      }
    }
  }

  function test_dormantDoesNotInventAColour() {
    // Dormant draws nothing, so it must resolve to the same value as listening
    // rather than a fourth hue that briefly flashes on the way in.
    var accent = "#7aa2f7"
    compare(Qt.colorEqual(StateColor.forPhase(accent, urgent, "dormant"),
                          StateColor.forPhase(accent, urgent, "listening")), true)
  }
}
