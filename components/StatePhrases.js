.pragma library

// Shared working-state copy for the panel and ambient voice surface. These are
// deliberately interpretive rather than progress claims: the broker can tell
// us that a turn is active, but it cannot truthfully expose a percentage.
var THINKING_PHRASES = [
  "Thinking it through…",
  "Tracing the thread…",
  "Connecting the dots…",
  "Checking the details…",
  "Following the signal…",
  "Shaping the answer…"
]

function thinkingCount() {
  return THINKING_PHRASES.length
}

function thinkingAt(index) {
  var count = thinkingCount()
  if (count === 0) return "Thinking…"
  var value = Math.floor(Number(index))
  if (!isFinite(value)) value = 0
  return THINKING_PHRASES[((value % count) + count) % count]
}

// Preserve actionable broker copy (for example, a tool approval) and rotate
// only when the status is the generic startup/receiving state.
function isGenericStatus(status) {
  var value = String(status || "").trim()
  return value === ""
    || value.indexOf("Preparing ") === 0
    || value.indexOf("Starting ") === 0
    || value === "Receiving response…"
}

function thinkingStatus(index, status) {
  return isGenericStatus(status) ? thinkingAt(index) : String(status || "")
}
