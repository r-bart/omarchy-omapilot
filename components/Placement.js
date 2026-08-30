.pragma library

// The arithmetic and the judgement behind placing the console window, with no
// compositor in it.
//
// ConsolePlacement.qml is the part that cannot be tested without a live
// Hyprland: sockets, dispatches, timers, a toplevel model that refreshes over
// IPC. Everything here is a pure function of values that file already has in
// hand, and it is where both of this branch's worst bugs lived — an array test
// that quietly said no, and a comparison that called a perfect placement a
// failure. Neither needed a compositor to find, only a test.

// MEASURED: `Array.isArray` is FALSE for the arrays inside Hyprland's
// `lastIpcObject`. They index like arrays and stringify like arrays, so the
// mistake survives every casual check — it made a geometry snapshot return null
// in silence and made the verifier report a correct placement as a failure.
// Length is the honest test.
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

// `hyprctl -j getoption general:gaps_out` answers with CSS shorthand — "10", or
// "10 20", or four values. The console is inset equally, so the first is the one
// that matters. Returns -1 when there is nothing usable to read, which the
// caller treats as "keep the default".
function cssGap(payload) {
  try {
    // An absent `css` is unreadable, not zero. Number("") is 0, and a zero gap
    // read from nothing would put the console's top border back under the bar
    // while looking like a deliberate answer.
    var raw = String(JSON.parse(payload).css || "").trim()
    if (raw === "") return -1
    var value = Number(raw.split(/\s+/)[0])
    return isFinite(value) && value >= 0 ? value : -1
  } catch (error) {
    return -1
  }
}

// Same, for the integer-valued options. -1 means unreadable.
function intOption(payload) {
  try {
    var value = Number(JSON.parse(payload).int)
    return isFinite(value) && value >= 0 ? value : -1
  } catch (error) {
    return -1
  }
}

// What the console wants to look like. `box` is an explicit geometry when there
// is one to preserve, and null when the column should be recomputed.
function columnShape(width, floating, maximized) {
  return {
    width: Math.round(width),
    floating: floating !== false,
    maximized: maximized === true,
    box: null
  }
}

// The shape a window is currently wearing, read from a toplevel's last IPC
// object. Null when the object does not carry a geometry — which is not an
// error: a window that has just mapped may not have one yet.
function snapshotFrom(state) {
  if (!state) return null
  var at = numbers(state.at, 2)
  var size = numbers(state.size, 2)
  if (!at || !size) return null
  return {
    width: size[0],
    floating: state.floating === true,
    maximized: Number(state.fullscreen || 0) === 1,
    box: { x: at[0], y: at[1], width: size[0], height: size[1] }
  }
}

// The right-hand column of a monitor, inside whatever the bar has reserved and
// inset by the gap the compositor gives every tiled window.
//
// Hyprland reports monitor size in device pixels and everything else in logical
// ones. Verified at scale 1; the division is what makes the other scales
// arithmetic rather than a special case.
//
// The inset is not decoration: a window's border is drawn OUTSIDE the box
// hyprctl reports, so a column flush against the reserved strip has its top
// border underneath the bar.
function columnBox(monitor, width, inset) {
  if (!monitor || !(width > 0)) return null
  var scale = monitor.scale > 0 ? monitor.scale : 1
  var logicalWidth = Math.round(monitor.width / scale)
  var logicalHeight = Math.round(monitor.height / scale)
  var reserved = numbers(monitor.reserved, 4) || [0, 0, 0, 0]
  var top = reserved[1]
  var bottom = reserved[3]
  var edge = Math.max(0, Math.round(inset || 0))
  return {
    width: Math.round(width),
    height: Math.max(1, logicalHeight - top - bottom - edge * 2),
    x: Math.round(monitor.x + logicalWidth - width - edge),
    y: Math.round(monitor.y + top + edge)
  }
}

// Did the compositor take the shape it was asked for? Nothing about a dispatch
// says so — it is void, and the socket's `ok` means "accepted", not "had an
// effect" — so this comparison is the only thing that can tell.
//
// Two pixels of slack on the geometry: the dispatches are exact, but borders
// and gaps are the compositor's to add and not worth a retry over.
function matches(state, want) {
  if (!state || !want) return false
  if (want.maximized) return Number(state.fullscreen || 0) === 1
  if (Number(state.fullscreen || 0) !== 0) return false
  if ((state.floating === true) !== want.floating) return false
  if (!want.floating) return true
  if (state.pinned !== true) return false
  if (!want.box) return true
  var at = numbers(state.at, 2)
  var size = numbers(state.size, 2)
  if (!at || !size) return false
  return Math.abs(size[0] - want.box.width) <= 2
    && Math.abs(size[1] - want.box.height) <= 2
    && Math.abs(at[0] - want.box.x) <= 2
    && Math.abs(at[1] - want.box.y) <= 2
}

// The Lua table is keyed, not positional. MEASURED, and it cost the first live
// run: `{ x = 587, y = 1405 }` resizes; `{587,1405}` is accepted and does
// nothing, which is this compositor's whole failure mode in one line.
function luaPoint(x, y) {
  return "{ x = " + Math.round(x) + ", y = " + Math.round(y) + " }"
}
