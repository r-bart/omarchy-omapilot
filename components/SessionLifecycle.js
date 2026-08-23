.pragma library

// One contextual Super+A gesture owns the common voice lifecycle. The ambient
// session lease, not the presence of an old saved chat, decides whether a press
// starts fresh or continues. A live recording is the one special case: the same
// gesture finishes and submits it.
function voiceActivationMode(sessionActive, storeState) {
  if (sessionActive === true && String(storeState || "") === "dictating")
    return "finish"
  return sessionActive === true ? "continue" : "fresh"
}

// While a follow-up is running, the store hides its last committed chat ID so
// Herdr cannot hand off a half-written turn. A failed or canceled follow-up must
// restore that ID; a successful turn's new ID always wins.
function settledChatId(currentChatId, submittedResumeChatId) {
  var current = String(currentChatId || "")
  return current !== "" ? current : String(submittedResumeChatId || "")
}
