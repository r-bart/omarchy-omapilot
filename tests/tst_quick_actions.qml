import QtQuick
import QtTest
import "../components/QuickActions.js" as QuickActions

TestCase {
  name: "OmaPilotQuickActions"

  function test_defaultsAndLegacyVisibilityMigrate() {
    var actions = QuickActions.actionsFromSettings("", true, true)
    compare(actions.length, 2)
    compare(actions[0].id, "summarize-window")
    compare(actions[1].id, "work-in-app")
    var summaryOnly = QuickActions.actionsFromSettings("", true, false)
    compare(summaryOnly.length, 1)
    compare(summaryOnly[0].id, "summarize-window")
    var workOnly = QuickActions.actionsFromSettings("", false, true)
    compare(workOnly.length, 1)
    compare(workOnly[0].id, "work-in-app")
    compare(QuickActions.actionsFromSettings("", false, false).length, 0)
  }

  function test_customActionsRoundTripAndEmptyListIsIntentional() {
    var custom = [
      { id: "research", label: "Research this", prompt: "Research the current topic.", icon: "R" },
      { id: "draft", label: "Draft reply", prompt: "Draft a concise reply.", icon: "D" }
    ]
    var serialized = QuickActions.serializedActions(custom)
    var restored = QuickActions.actionsFromSettings(serialized, true, true)
    compare(restored.length, 2)
    compare(restored[0].id, "research")
    compare(restored[1].prompt, "Draft a concise reply.")
    compare(QuickActions.actionsFromSettings("[]", true, true).length, 0)
    compare(QuickActions.actionsFromSettings("not-json", true, true).length, 2)
  }

  function test_addEditRemoveAndReorderAreBounded() {
    var actions = []
    for (var i = 0; i < 7; i++)
      actions = QuickActions.addAction(actions, "Action " + i, "Prompt " + i, i)
    compare(actions.length, QuickActions.maximumActions)

    actions = QuickActions.updateAction(actions, 0, "Updated", "Updated prompt")
    compare(actions[0].label, "Updated")
    actions = QuickActions.moveAction(actions, 0, 1)
    compare(actions[1].label, "Updated")
    actions = QuickActions.removeAction(actions, 1)
    compare(actions.length, QuickActions.maximumActions - 1)
    verify(actions[0].label !== "Updated")
  }

  function test_invalidAndDuplicateRowsAreNormalized() {
    var actions = QuickActions.normalizedActions([
      { id: "same", label: "First", prompt: "One" },
      { id: "same", label: "Second", prompt: "Two" },
      { id: "empty", label: "", prompt: "Dropped" }
    ])
    compare(actions.length, 2)
    compare(actions[0].id, "same")
    compare(actions[1].id, "same-2")
  }

  function test_actionsPrefillEditablePrompts() {
    var actions = QuickActions.defaultActions(true, true)
    verify(QuickActions.promptFor(actions, "summarize-window").indexOf("active window") >= 0)
    compare(QuickActions.promptFor(actions, "work-in-app"), "In the active app, ")
    compare(QuickActions.promptFor(actions, "unknown"), "")
  }
}
