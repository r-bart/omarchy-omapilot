import QtQuick
import Quickshell
import "components" as OmaPilot

// The console window's lifecycle, run with no compositor to talk to.
//
// This is the D11 path — "degrade to a plain window when Hyprland is not
// there" — and until this probe existed it was the one decision in the spec
// that had been read and never executed. The harness unsets
// HYPRLAND_INSTANCE_SIGNATURE, so ConsolePlacement reports itself unavailable
// and every activation, dispatch and geometry read becomes a no-op. What is
// left has to be a window that still opens, still closes and still reopens.
//
// Two things it cannot reach, said plainly rather than pretended. The offscreen
// platform reports its windows as active, so the console is always in the
// focused state here and the focus ladder never falls through to its remap —
// that step is measured live instead, and the remap is driven by hand below to
// get at the close it used to swallow. And the lane reset is not asserted:
// `viewMode` lives inside ConsoleContent, the console does not expose it,
// exposing it for a test would be API nobody calls, and the escape probe
// already drives that component directly.
ShellRoot {
  id: root

  property bool failed: false
  property int stage: 0

  function fail(message) {
    failed = true
    console.error("omapilot console window probe failed: " + message)
  }

  BackendStub { id: backendStub }

  OmaPilot.Console {
    id: console_
    backend: backendStub
    motionEnabled: false
    surfaceWidth: 440
  }

  Timer {
    interval: 420
    running: true
    repeat: true
    onTriggered: {
      if (root.stage === 0) {
        // Nothing is mapped until someone asks. The console tree exists for
        // users who opted into the surface; it is not a window yet.
        if (console_.opened || console_.engaged)
          root.fail("the console mapped itself before anyone opened it")
        if (OmaPilot.ConsolePlacement.available)
          root.fail("this probe must run with no compositor to talk to")
        // Every entry point has to survive the compositor being absent rather
        // than throwing on the way past.
        if (OmaPilot.ConsolePlacement.activate("OmaPilot") !== false)
          root.fail("activation claimed success with no compositor")
        if (OmaPilot.ConsolePlacement.snapshot("OmaPilot") !== null)
          root.fail("a snapshot came back from a compositor that is not there")
        OmaPilot.ConsolePlacement.place("OmaPilot",
          OmaPilot.ConsolePlacement.columnShape(440, true, false))
      } else if (root.stage === 1) {
        // Opening latches the desktop context and maps the window.
        console_.open(true)
        if (!console_.opened || !console_.engaged)
          root.fail("open did not map the console")
        if (backendStub.latchCount !== 1)
          root.fail("open did not latch the desktop context")
      } else if (root.stage === 2) {
        // Offscreen the window reports itself active, so the console is in the
        // third of its three states: visible and holding the keyboard.
        if (!console_.focused)
          root.fail("a mapped offscreen window was not reported as focused")
      } else if (root.stage === 3) {
        // Toggling from there is a dismissal, and it has to be a real close:
        // the latch released, the window gone, the process still here.
        console_.toggle()
        if (console_.opened || console_.engaged)
          root.fail("toggle did not close a focused console")
        if (backendStub.unlatchCount !== 1)
          root.fail("toggle did not release the desktop-context latch")
      } else if (root.stage === 4) {
        // A close arriving while a remap is in flight used to be swallowed:
        // the window was already hidden, so nothing downstream was told. The
        // fallback cannot be provoked without a compositor, so this drives it
        // by hand and then closes on top of it.
        console_.open(true)
        console_.remapping = true
        console_.close()
      } else if (root.stage === 5) {
        if (console_.opened || console_.engaged)
          root.fail("a close during a remap did not close the console")
        if (console_.remapping)
          root.fail("closing left a remap in flight")
        if (backendStub.unlatchCount !== 2)
          root.fail("the swallowed close did not release the latch")
      } else if (root.stage === 6) {
        // And it reopens. The point of `closed` being a close rather than a
        // teardown is that the process is still here to be asked again.
        console_.open(true)
        if (!console_.opened || !console_.engaged)
          root.fail("the console did not reopen after closing")
        if (backendStub.latchCount !== 3)
          root.fail("reopening did not latch the desktop context again")
      } else if (root.stage === 7) {
        // The lanes still route through the same open, with no compositor.
        console_.openSettings()
        console_.openHistory()
        console_.openApproval()
        if (!console_.opened)
          root.fail("a lane request closed the console")
      } else {
        if (!root.failed) console.log("OMAPILOT_CONSOLE_WINDOW_PROBE_OK")
        Qt.quit()
      }
      root.stage++
    }
  }
}
