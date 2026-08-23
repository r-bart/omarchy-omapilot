import QtQuick
import QtTest
import "../components/StatePhrases.js" as StatePhrases

TestCase {
  name: "StatePhrases"

  function test_thinkingPhrasesWrapBothDirections() {
    verify(StatePhrases.thinkingCount() >= 5)
    compare(StatePhrases.thinkingAt(0), "Thinking it through…")
    compare(StatePhrases.thinkingAt(StatePhrases.thinkingCount()),
      StatePhrases.thinkingAt(0))
    compare(StatePhrases.thinkingAt(-1),
      StatePhrases.thinkingAt(StatePhrases.thinkingCount() - 1))
  }

  function test_onlyGenericStatusUsesDecorativeCopy() {
    verify(StatePhrases.isGenericStatus(""))
    verify(StatePhrases.isGenericStatus("Preparing Codex…"))
    verify(StatePhrases.isGenericStatus("Starting Built-in…"))
    verify(StatePhrases.isGenericStatus("Receiving response…"))
    verify(!StatePhrases.isGenericStatus("Waiting for tool approval…"))
    compare(StatePhrases.thinkingStatus(2, "Waiting for tool approval…"),
      "Waiting for tool approval…")
    compare(StatePhrases.thinkingStatus(2, ""), StatePhrases.thinkingAt(2))
  }
}
