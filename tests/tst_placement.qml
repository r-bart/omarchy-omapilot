import QtQuick
import QtTest
import "../components/Placement.js" as Placement

// The console's geometry arithmetic, tested without a compositor.
//
// Every case below is one this branch actually hit on a live Hyprland, where
// finding it cost a probe instance, a shell restart and a round of guessing.
// They are all decidable from values alone.
TestCase {
  name: "OmaPilotPlacement"

  // A QVariantList crossing into QML is array-LIKE and not an Array: it
  // indexes, it has a length, it stringifies as "[1,2]" — and `Array.isArray`
  // says no. That single false made a geometry snapshot return null in silence
  // and made the verifier call a perfect placement a failure.
  function test_hyprlandArraysAreArrayLikeAndNotArrays() {
    var arrayLike = { length: 2, 0: 1973, 1: 35 }
    verify(!Array.isArray(arrayLike))
    compare(JSON.stringify(Placement.numbers(arrayLike, 2)), "[1973,35]")
    compare(JSON.stringify(Placement.numbers([1973, 35], 2)), "[1973,35]")
  }

  function test_numbersRefusesWhatItCannotUse() {
    compare(Placement.numbers(null, 2), null)
    compare(Placement.numbers(undefined, 2), null)
    compare(Placement.numbers({}, 2), null)
    // Short is not "pad with zeros": a truncated geometry placed the console
    // at the origin would look deliberate.
    compare(Placement.numbers([1973], 2), null)
    compare(Placement.numbers(["x", 35], 2), null)
    compare(Placement.numbers([1 / 0, 35], 2), null)
    // Longer than asked is fine; the extra is simply not read.
    compare(JSON.stringify(Placement.numbers([1, 2, 3, 4], 2)), "[1,2]")
    // Hyprland reports fractional geometry on scaled outputs.
    compare(JSON.stringify(Placement.numbers([1972.6, 35.4], 2)), "[1973,35]")
  }

  function test_cssShorthandIsReadFromItsFirstValue() {
    compare(Placement.cssGap('{"css":"10 10 10 10"}'), 10)
    compare(Placement.cssGap('{"css":"12"}'), 12)
    compare(Placement.cssGap('{"css":"8 16"}'), 8)
    compare(Placement.cssGap('{"css":"0 0 0 0"}'), 0)
    // Unreadable means "keep the default", never "zero".
    compare(Placement.cssGap('not json'), -1)
    compare(Placement.cssGap('{"int":2}'), -1)
    compare(Placement.cssGap('{"css":"auto"}'), -1)
    compare(Placement.intOption('{"int":2}'), 2)
    compare(Placement.intOption('{"css":"10"}'), -1)
    compare(Placement.intOption(''), -1)
  }

  // The measured column on this desktop: a 2560x1440 output at scale 1 with a
  // 35px bar, gaps_out 10 and border 2. The answer has to be the box every
  // tiled window on that screen already gets.
  function test_theColumnLandsWhereTiledWindowsLand() {
    var monitor = {
      x: 0, y: 0, width: 2560, height: 1440, scale: 1, reserved: [0, 35, 0, 0]
    }
    var box = Placement.columnBox(monitor, 587, 12)
    compare(box.width, 587)
    compare(box.height, 1381)
    compare(box.x, 1961)
    compare(box.y, 47)
  }

  function test_theInsetIsWhatKeepsTheBorderOutFromUnderTheBar() {
    var monitor = {
      x: 0, y: 0, width: 2560, height: 1440, scale: 1, reserved: [0, 35, 0, 0]
    }
    // Flush against the reserved strip is where the top border disappears
    // behind the bar, so the inset is load-bearing and not a margin.
    var flush = Placement.columnBox(monitor, 587, 0)
    compare(flush.y, 35)
    compare(flush.height, 1405)
    verify(Placement.columnBox(monitor, 587, 12).y > flush.y)
  }

  function test_geometryIsLogicalAndMonitorsHaveOffsets() {
    // Hyprland reports size in device pixels and position in logical ones, so
    // a scaled output is a division and not a special case.
    var scaled = {
      x: 0, y: 0, width: 3840, height: 2160, scale: 2, reserved: [0, 35, 0, 0]
    }
    var box = Placement.columnBox(scaled, 500, 10)
    compare(box.x, 1920 - 500 - 10)
    compare(box.height, 1080 - 35 - 20)
    // A second monitor to the right is an origin, not a new formula.
    var offset = {
      x: 2560, y: 0, width: 1920, height: 1080, scale: 1, reserved: [0, 0, 0, 0]
    }
    compare(Placement.columnBox(offset, 400, 10).x, 2560 + 1920 - 400 - 10)
  }

  function test_columnBoxRefusesRatherThanGuesses() {
    compare(Placement.columnBox(null, 587, 12), null)
    compare(Placement.columnBox({ width: 2560, height: 1440 }, 0, 12), null)
    // Missing `reserved` is a monitor with nothing reserved, not a failure.
    var bare = { x: 0, y: 0, width: 1000, height: 800, scale: 1 }
    compare(Placement.columnBox(bare, 300, 0).height, 800)
    // A reserved area larger than the screen cannot produce a negative height.
    var swallowed = {
      x: 0, y: 0, width: 1000, height: 100, scale: 1, reserved: [0, 80, 0, 80]
    }
    verify(Placement.columnBox(swallowed, 300, 10).height >= 1)
  }

  function test_aPlacementIsOnlyDoneWhenTheWindowWearsIt() {
    var want = { maximized: false, floating: true,
                 box: { x: 1961, y: 47, width: 587, height: 1381 } }
    var placed = { floating: true, pinned: true, fullscreen: 0,
                   at: [1961, 47], size: [587, 1381] }
    verify(Placement.matches(placed, want))
    // Two pixels of slack, because borders and gaps are the compositor's to add.
    verify(Placement.matches({ floating: true, pinned: true, fullscreen: 0,
                               at: [1962, 46], size: [588, 1380] }, want))
    verify(!Placement.matches({ floating: true, pinned: true, fullscreen: 0,
                                at: [1961, 47], size: [587, 1370] }, want))
    // Every one of these is a way the compositor accepted the request and did
    // something else with it.
    verify(!Placement.matches({ floating: false, pinned: false, fullscreen: 0,
                                at: [12, 745], size: [1261, 683] }, want))
    verify(!Placement.matches({ floating: true, pinned: false, fullscreen: 0,
                                at: [1961, 47], size: [587, 1381] }, want))
    verify(!Placement.matches({ floating: true, pinned: true, fullscreen: 1,
                                at: [1961, 47], size: [587, 1381] }, want))
    verify(!Placement.matches(null, want))
    verify(!Placement.matches(placed, null))
  }

  function test_theOtherTwoShapesAreJudgedOnWhatTheyClaim() {
    // Maximized is state 1 and never state 2: 2 covers the bar, which holds the
    // icon that dismisses the console.
    var maximized = { maximized: true, floating: true, box: null }
    verify(Placement.matches({ fullscreen: 1, at: [2, 37], size: [2556, 1401] }, maximized))
    verify(!Placement.matches({ fullscreen: 2, at: [0, 0], size: [2560, 1440] }, maximized))
    verify(!Placement.matches({ fullscreen: 0, floating: true, pinned: true }, maximized))
    // Tiled asks for nothing but being tiled: the layout owns the geometry.
    var tiled = { maximized: false, floating: false, box: null }
    verify(Placement.matches({ floating: false, fullscreen: 0,
                               at: [12, 745], size: [1261, 683] }, tiled))
    verify(!Placement.matches({ floating: true, pinned: true, fullscreen: 0 }, tiled))
  }

  function test_aMissingGeometryIsNotAMatch() {
    var want = { maximized: false, floating: true,
                 box: { x: 0, y: 0, width: 100, height: 100 } }
    // A window that has just mapped may carry no geometry yet. Reading that as
    // agreement would stop the retry before it started.
    verify(!Placement.matches({ floating: true, pinned: true, fullscreen: 0 }, want))
  }

  function test_aSnapshotCarriesTheShapeAcrossARemap() {
    // A remap is a brand-new window to Hyprland: it comes back tiled at a
    // default size, losing the column and any drag the user had done by hand.
    var dragged = { floating: true, pinned: true, fullscreen: 0,
                    at: [300, 300], size: [800, 600] }
    var shape = Placement.snapshotFrom(dragged)
    compare(shape.floating, true)
    compare(shape.maximized, false)
    compare(shape.width, 800)
    compare(JSON.stringify(shape.box), '{"x":300,"y":300,"width":800,"height":600}')
    // Round-trips through matches: what was photographed is what is put back.
    verify(Placement.matches(dragged, { maximized: false, floating: true, box: shape.box }))
    compare(Placement.snapshotFrom({ floating: true }), null)
    compare(Placement.snapshotFrom(null), null)
    compare(Placement.snapshotFrom({ at: [0, 0], size: [10, 10], fullscreen: 1 }).maximized, true)
  }

  function test_theLuaTableIsKeyedAndNotPositional() {
    // MEASURED, and it cost the first live run: `{587,1405}` is accepted and
    // does nothing. This compositor's whole failure mode in one line.
    compare(Placement.luaPoint(587, 1405), "{ x = 587, y = 1405 }")
    compare(Placement.luaPoint(1972.6, 35.4), "{ x = 1973, y = 35 }")
    compare(Placement.luaPoint(0, 0), "{ x = 0, y = 0 }")
  }

  function test_aShapeIsNormalizedBeforeItIsAsked() {
    var column = Placement.columnShape(586.7, true, false)
    compare(column.width, 587)
    compare(column.floating, true)
    compare(column.maximized, false)
    compare(column.box, null)
    // The defaults lean the safe way: absent means floating, absent means not
    // maximized, because a maximized console hides the control that closes it.
    compare(Placement.columnShape(500, undefined, undefined).floating, true)
    compare(Placement.columnShape(500, false, "yes").floating, false)
    compare(Placement.columnShape(500, true, "yes").maximized, false)
  }
}
