.pragma library

// State colours for the ambient surfaces.
//
// The problem: every state used one accent plus red for failure, so listening,
// thinking, and answering were indistinguishable.
//
// The constraint: Omarchy's public theme roles are foreground, background,
// accent, urgent, and muted. The raw terminal palette (a green, an amber) is
// read by Color.qml only as a fallback for those five and is never exposed, and
// reading colors.toml here would duplicate the shell's theming and break the
// rule that colours resolve from qs.Commons roles.
//
// So the states are derived from the theme's own accent by rotating hue while
// keeping its saturation and lightness. That has a real tradeoff worth stating:
// it gives up the green-means-done convention, because an absolute green would
// clash with a warm theme and would collide with the accent outright in a green
// one. Relative spacing is instead guaranteed distinct in every theme, and every
// state still reads as belonging to the palette. Failure keeps `urgent`, which
// is the one role a theme defines specifically to mean "something is wrong".

// Hue offsets in turns (1.0 == 360°). Spaced far enough apart to be
// unambiguous at a glance, even bloomed and at low opacity.
var LISTENING_SHIFT = 0.0;    // the theme accent itself
var THINKING_SHIFT = 0.11;    // ~40°
var ANSWERING_SHIFT = 0.30;   // ~108°

// A plain string has no hslHue/hslSaturation, so callers passing "#rrggbb"
// would silently produce NaN and collapse every state to one colour. Qt.darker
// with a factor of 1 is the cheapest reliable string-to-color coercion.
function asColor(value) {
  return Qt.darker(value, 1.0);
}

function wrap(value) {
  var result = value % 1;
  return result < 0 ? result + 1 : result;
}

function clamp01(value) {
  if (!isFinite(value)) return 0;
  return value < 0 ? 0 : (value > 1 ? 1 : value);
}

function rotated(input, shift, tint) {
  var accent = asColor(input);
  // Listening keeps the theme's own saturation, so a monochrome theme stays
  // monochrome for its identity state rather than being given a hue the palette
  // does not contain. Only the derived states lift saturation, and only enough
  // for the rotation to be visible at all — rotating hue on a grey yields grey.
  var saturation = tint ? Math.max(accent.hslSaturation, 0.35) : accent.hslSaturation;
  // Lightness is clamped for every state: a pure-black or pure-white accent
  // would otherwise produce an invisible glow.
  var lightness = clamp01(Math.max(0.42, Math.min(0.72, accent.hslLightness)));
  return Qt.hsla(wrap(accent.hslHue + shift), clamp01(saturation), lightness, 1);
}

/**
 * The colour for one phase.
 *
 * phase: dormant | listening | thinking | answering | error
 */
function forPhase(accent, urgent, phase) {
  if (phase === "error") return urgent;
  if (phase === "thinking") return rotated(accent, THINKING_SHIFT, true);
  if (phase === "answering") return rotated(accent, ANSWERING_SHIFT, true);
  // Listening and dormant both speak with the theme's own voice.
  return rotated(accent, LISTENING_SHIFT, false);
}

/** Distinctness guard used by the tests: hue separation in turns, wrapped. */
function hueDistance(first, second) {
  var a = asColor(first);
  var b = asColor(second);
  var raw = Math.abs(wrap(a.hslHue) - wrap(b.hslHue));
  return Math.min(raw, 1 - raw);
}
