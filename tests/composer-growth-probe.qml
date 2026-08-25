import QtQuick
import Quickshell
import qs.Commons
import "components" as OmaPilot

// The composer grows with the draft, and then it stops.
//
// It used to only grow. The prompt row's height was bound straight to the
// text's implicit height, and the composer sits at the bottom of a column
// whose conversation is `fillHeight` — so a pasted block took the room it
// wanted, squeezed the answer above it to nothing, and then carried on past
// the bottom edge of the window. Nothing in the tree said no.
//
// The invariant here is deliberately not a pixel count: it is that two drafts
// which both clear the cap produce the *same* height. That holds whatever the
// spacing scale, the font size or the cap itself is set to, and it is exactly
// what "stops growing" means. Boundedness is then a consequence, and the last
// stage states it separately so a regression says which half broke.
//
// The composer has to sit in a window. Qt Quick Layouts settle during the
// polish phase, which only runs for items that belong to one — measured: with
// the composer parented straight to the ShellRoot, the editor's implicit
// height climbed to 4800px while the row it lives in stayed at its floor
// forever, so the probe passed the cap without the cap doing anything. The
// offscreen platform gives a real window and no Wayland surface, which is the
// same trade the console window probe makes.
ShellRoot {
  id: root

  property bool failed: false
  property int stage: 0

  property real emptyHeight: 0
  property real oneLineHeight: 0
  property real twentyLineHeight: 0
  property real twoHundredLineHeight: 0

  function fail(message) {
    failed = true
    console.error("omapilot composer growth probe failed: " + message)
  }

  function lines(count) {
    var out = []
    for (var i = 0; i < count; i++) out.push("line " + i + " of the pasted block")
    return out.join("\n")
  }

  BackendStub { id: backendStub }

  FloatingWindow {
    id: host
    visible: true
    implicitWidth: 560
    implicitHeight: 700

    OmaPilot.Composer {
      id: composer
      backend: backendStub
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.top: parent.top
    }
  }

  Timer {
    interval: 260
    running: true
    repeat: true
    onTriggered: {
      if (root.stage === 0) {
        root.emptyHeight = composer.implicitHeight
        if (root.emptyHeight <= 0)
          root.fail("an empty composer had no height at all")
        composer.draftText = "one line"
      } else if (root.stage === 1) {
        root.oneLineHeight = composer.implicitHeight
        composer.draftText = root.lines(20)
      } else if (root.stage === 2) {
        root.twentyLineHeight = composer.implicitHeight
        // Twenty lines is well past the cap, so it must be taller than one
        // line — otherwise the row never grew and the cap is not what is
        // being measured below.
        if (!(root.twentyLineHeight > root.oneLineHeight))
          root.fail("the composer did not grow with the draft at all")
        composer.draftText = root.lines(200)
      } else if (root.stage === 3) {
        root.twoHundredLineHeight = composer.implicitHeight
        // The point of the whole probe.
        if (root.twoHundredLineHeight !== root.twentyLineHeight)
          root.fail("the composer kept growing past the cap: 20 lines gave "
            + root.twentyLineHeight + ", 200 lines gave "
            + root.twoHundredLineHeight)
        // And it is bounded by something a console can actually hold, rather
        // than merely converging somewhere off-screen.
        if (root.twoHundredLineHeight > Style.space(300))
          root.fail("the capped composer is " + root.twoHundredLineHeight
            + "px, taller than any docked column should give a prompt")
      } else if (root.stage === 4) {
        // Clearing the draft gives the room straight back. A cap that only
        // ratchets one way would leave the console short for the rest of the
        // session after a single paste.
        composer.draftText = ""
      } else if (root.stage === 5) {
        if (composer.implicitHeight !== root.emptyHeight)
          root.fail("the composer did not shrink back after the draft was"
            + " cleared: started at " + root.emptyHeight + ", ended at "
            + composer.implicitHeight)
      } else {
        if (!root.failed) console.log("OMAPILOT_COMPOSER_GROWTH_PROBE_OK")
        Qt.quit()
      }
      root.stage++
    }
  }
}
