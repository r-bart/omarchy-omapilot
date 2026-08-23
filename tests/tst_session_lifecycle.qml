import QtQuick
import QtTest
import "../components/SessionLifecycle.js" as SessionLifecycle

TestCase {
  name: "SessionLifecycle"

  function test_closedVoiceFlowStartsFresh() {
    var states = ["composing", "dictating", "preparing", "streaming", "complete", "error"]
    for (var i = 0; i < states.length; i++)
      compare(SessionLifecycle.voiceActivationMode(false, states[i]), "fresh")
  }

  function test_activeVoiceFlowFinishesOnlyLiveDictation() {
    compare(SessionLifecycle.voiceActivationMode(true, "dictating"), "finish")
    var continuingStates = ["composing", "preparing", "streaming", "complete", "error", "unavailable"]
    for (var i = 0; i < continuingStates.length; i++)
      compare(SessionLifecycle.voiceActivationMode(true, continuingStates[i]), "continue")
  }

  function test_completedTurnWinsOverSubmittedContinuation() {
    compare(SessionLifecycle.settledChatId("new-chat", "prior-chat"), "new-chat")
  }

  function test_interruptedTurnRestoresSubmittedContinuation() {
    compare(SessionLifecycle.settledChatId("", "prior-chat"), "prior-chat")
    compare(SessionLifecycle.settledChatId("", ""), "")
  }
}
