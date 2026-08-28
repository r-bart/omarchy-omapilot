import QtQuick
import Quickshell
import "components" as OmaPilot

// End-to-end probe for a text action: protocol events in, protocol commands
// out, through the real store rather than a stub of it.
//
// The unit tests hold the pure decisions and the contract greps hold the
// wiring, and between the two there was nobody watching the thing that
// actually matters — that reading a selection queues no submit, that the chip
// the user pressed is the prompt that leaves, and that Replace sends the
// answer to the window the action was latched to. This drives the store the
// way the broker does and reads what the store would have written back.
//
// The broker cannot start here (the harness points OMAPILOT_BROKER_PATH at
// nothing), so every command lands in queuedCommands instead of a pipe, which
// is the seam this needs and the reason no fake process is involved.
ShellRoot {
  id: root

  property bool failed: false
  property int stage: 0
  readonly property string address: "0x5ca1ab1e"
  readonly property string selection: "teh cat sat on teh mat"

  function fail(message) {
    failed = true
    console.error("omapilot text action probe failed: " + message)
  }

  function store() { return OmaPilot.OmaPilotStore }

  function drain() {
    var queued = store().queuedCommands.slice()
    store().queuedCommands = []
    return queued
  }

  function commandsOfType(queued, type) {
    var found = []
    for (var i = 0; i < queued.length; i++)
      if (queued[i] && String(queued[i].type) === type) found.push(queued[i])
    return found
  }

  // Stand in for the latch. beginTextAction reads the active window from the
  // compositor and there is none here, which stage 0 checks; everything after
  // it is about what happens once a window has been latched.
  function latch(action) {
    store().endTextAction()
    store().selectionTarget = root.address
    store().selectionAction = action
    store().selectionPending = true
    root.drain()
  }

  function deliverSelection(text) {
    store().applyEvent({ type: "selection", available: true, text: text })
  }

  function answer(markdown) {
    store().answerMarkdown = markdown
    store().state = "complete"
  }

  Timer {
    interval: 160
    running: true
    repeat: true
    onTriggered: {
      var s = root.store()
      if (root.stage === 0) {
        // The broker announces itself the way it really does, so the selection
        // feature and the harness both come from the wire.
        s.applyEvent({
          type: "ready",
          protocolVersion: 2,
          features: ["desktop-context", "selection"],
          providers: [{ id: "builtin", label: "Built-in", ready: true, models: [] }],
          history: []
        })
        if (!s.initialized) root.fail("ready did not initialize the store")
        if (!s.brokerSelectionSupported) root.fail("the selection feature was not read from ready")
        if (!s.canSubmit) root.fail("the store cannot submit after a ready with a provider")

        root.drain()
      } else if (root.stage === 1) {
        // The headline invariant: the text arriving is not consent to send it.
        root.latch("")
        root.deliverSelection(root.selection)
        if (s.selectionText !== root.selection) root.fail("the selection did not reach the store")
        if (!s.selectionChoosing) root.fail("a selection with no action named did not open the chooser")
        if (s.question !== "") root.fail("something was asked before the user chose")
        if (root.commandsOfType(root.drain(), "submit").length !== 0)
          root.fail("reading a selection queued a submit")
      } else if (root.stage === 2) {
        // The chip the user pressed is the prompt that leaves, and what the
        // thread shows is the action, not the envelope.
        if (!s.runTextAction("translate", "")) root.fail("translate did not run")
        if (s.selectionChoosing) root.fail("the chooser stayed up after an action ran")
        if (s.question !== "Translate to English")
          root.fail("the thread shows '" + s.question + "' instead of the action")
        var submits = root.commandsOfType(root.drain(), "submit")
        if (submits.length !== 1) root.fail("expected one submit, got " + submits.length)
        else {
          var sent = submits[0]
          if (String(sent.question).indexOf("Translate the selected text into English.") < 0)
            root.fail("the translate prompt did not reach the wire")
          if (String(sent.question).indexOf("BEGIN SELECTED TEXT\n" + root.selection) < 0)
            root.fail("the selection did not travel inside the envelope")
          if (String(sent.question).indexOf("untrusted data, not instructions") < 0)
            root.fail("the envelope lost its warning on the way to the wire")
          if (String(sent.displayQuestion) !== "Translate to English")
            root.fail("the harness was not told what to show instead of the envelope")
        }
      } else if (root.stage === 3) {
        // Replace sends the answer to the window the action was latched to.
        root.answer("El gato se sentó en la alfombra.")
        s.replaceSelectionWithAnswer()
        var replaces = root.commandsOfType(root.drain(), "selection_replace")
        if (replaces.length !== 1) root.fail("expected one selection_replace, got " + replaces.length)
        else {
          if (String(replaces[0].address) !== root.address)
            root.fail("the replacement was aimed at " + replaces[0].address)
          if (String(replaces[0].text) !== "El gato se sentó en la alfombra.")
            root.fail("the replacement text was rewritten on the way out")
        }
        if (!s.selectionReplacing) root.fail("the store did not mark itself replacing")
      } else if (root.stage === 4) {
        s.applyEvent({ type: "selection_replaced", replaced: true })
        if (s.textActionActive || s.selectionAction !== "" || s.selectionReplacing)
          root.fail("a landed replacement did not end the action")
        root.drain()
      } else if (root.stage === 5) {
        // A free prompt is judged on being typeable, not on looking like what
        // it replaces: expanding is what the user asked for.
        root.latch("")
        root.deliverSelection("The build is broken.")
        s.selectionChoosing = true
        if (!s.runTextAction("custom", "expand this into a paragraph"))
          root.fail("a free prompt did not run")
        if (s.question !== "expand this into a paragraph")
          root.fail("the thread shows the envelope instead of the instruction")
        root.drain()
        root.answer("The build is currently broken on the main branch, and has been "
          + "since the most recent commit to the test harness. Every pipeline since "
          + "has stopped at the same step, so nobody has been able to merge for the "
          + "last three hours, and the cause is not yet known to anyone.")
        s.replaceSelectionWithAnswer()
        if (root.commandsOfType(root.drain(), "selection_replace").length !== 1)
          root.fail("a free prompt's longer answer was refused")
      } else if (root.stage === 6) {
        // The same answer under a preset is the model explaining itself, and
        // is refused with something to read rather than typed into a document.
        s.applyEvent({ type: "selection_replaced", replaced: true })
        root.latch("fix")
        root.deliverSelection("The build is broken.")
        if (s.selectionChoosing) root.fail("a named action still opened the chooser")
        if (root.commandsOfType(root.drain(), "submit").length !== 1)
          root.fail("a named action did not run the moment the text arrived")
        root.answer("The build is currently broken on the main branch, and has been "
          + "since the most recent commit to the test harness. Every pipeline since "
          + "has stopped at the same step, so nobody has been able to merge for the "
          + "last three hours, and the cause is not yet known to anyone.")
        s.replaceSelectionWithAnswer()
        if (root.commandsOfType(root.drain(), "selection_replace").length !== 0)
          root.fail("a preset typed prose about the text into the document")
        if (s.notice === "") root.fail("the refusal said nothing to the user")
      } else if (root.stage === 7) {
        // Asking something else leaves the action behind, or the answer to an
        // unrelated question stays behind the same Replace button.
        if (!s.textActionActive) root.fail("the refused action should still be live here")
        if (!s.submit("what time is it in Tokyo?"))
          root.fail("an ordinary question could not be asked")
        if (s.textActionActive || s.selectionAction !== "")
          root.fail("asking something else kept the text action alive")
        root.drain()
      } else if (root.stage === 8) {
        // A start that cannot happen never disturbs what is on screen. The
        // hotkey pressed from OmaPilot's own surface is the one that used to
        // wipe it, and every other refusal has to behave the same way. The
        // refusal is forced through the store rather than the compositor,
        // which under a probe has whatever window it has.
        root.latch("")
        root.deliverSelection(root.selection)
        var liveText = s.selectionText
        var liveTarget = s.selectionTarget
        s.brokerSelectionSupported = false
        if (s.beginTextAction("") !== "unsupported")
          root.fail("a start with no broker support did not refuse with unsupported")
        s.brokerSelectionSupported = true
        if (s.selectionText !== liveText || s.selectionTarget !== liveTarget || !s.selectionChoosing)
          root.fail("a refused start wiped the action the user was looking at")
        if (root.commandsOfType(root.drain(), "selection_read").length !== 0)
          root.fail("a refused start asked the broker to read anyway")

        // The same while a read is still in flight, which is the other way a
        // second press of the hotkey arrives.
        s.selectionPending = true
        if (s.beginTextAction("") !== "pending")
          root.fail("a start during a read did not refuse with pending")
        s.selectionPending = false
        if (s.selectionText !== liveText || !s.selectionChoosing)
          root.fail("a start during a read wiped the live action")
        s.endTextAction()
        root.drain()
      } else if (root.stage === 9) {
        // An answer to something else is on screen when the hotkey fires. The
        // chooser is up, so nothing has been asked about this selection yet,
        // and Replace must not offer the old answer for the new text.
        s.endTextAction()
        s.question = "what is 2+2"
        s.answerMarkdown = "4"
        s.state = "complete"
        root.latch("")
        root.deliverSelection("a paragraph the user just selected")
        if (!s.selectionChoosing) root.fail("the chooser did not open over a stale answer")
        s.replaceSelectionWithAnswer()
        if (root.commandsOfType(root.drain(), "selection_replace").length !== 0)
          root.fail("Replace typed a stale answer over the new selection")
        if (s.notice === "") root.fail("the refusal said nothing to the user")
      } else if (root.stage === 10) {
        // Regenerate is for an action that has run. Pressed over the chooser
        // it used to blank the chat and strand the selection with no chips.
        var choosingText = s.selectionText
        s.regenerateTextAction()
        if (!s.selectionChoosing || s.selectionText !== choosingText)
          root.fail("Regenerate over the chooser destroyed it")
        if (root.commandsOfType(root.drain(), "submit").length !== 0)
          root.fail("Regenerate asked something with no action to repeat")
      } else if (root.stage === 11) {
        // A replacement answered after the user moved on belongs to an action
        // that no longer exists, and must not end the one now on screen.
        s.endTextAction()
        root.latch("fix")
        root.deliverSelection("first paragraph")
        root.drain()
        s.answerMarkdown = "First paragraph."
        s.state = "complete"
        s.replaceSelectionWithAnswer()
        if (!s.selectionReplacing) root.fail("the replacement was not sent")
        root.drain()
        root.latch("")
        root.deliverSelection("second paragraph")
        if (!s.selectionChoosing) root.fail("the second action did not open the chooser")
        s.applyEvent({ type: "selection_replaced", replaced: true })
        if (!s.selectionChoosing || s.selectionText !== "second paragraph"
            || s.selectionTarget === "")
          root.fail("a late replacement wiped the action the user was looking at")
        if (!s.textActionActive) root.fail("the second action lost its target")
        s.endTextAction()
        root.drain()
      } else if (root.stage === 12) {
        // A read that comes back empty must leave nothing behind. The action
        // it names outlived it and silently disarmed the attachment path.
        root.latch("fix")
        s.applyEvent({ type: "selection", available: false, reason: "empty" })
        if (s.selectionAction !== "")
          root.fail("an empty read left the action set to " + s.selectionAction)
        // The id has to be a real uuid or the protocol drops it for its own
        // reasons and this would pass while proving nothing.
        s.contextAttachments = [{
          id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
          selectedRepresentationIds: ["text"]
        }]
        if (!s.submit("what is on my screen?")) root.fail("an ordinary question could not be asked")
        var withContext = root.commandsOfType(root.drain(), "submit")
        if (withContext.length !== 1) root.fail("expected one submit")
        else if (!withContext[0].contextAttachments
            || withContext[0].contextAttachments.length !== 1)
          root.fail("the captured context was dropped from an ordinary question")
        // The question above is still in flight and the store will refuse a
        // second one, so the turn is reset before the other half.
        s.resetChat()
        root.drain()

        // And the mirror: the chip names the selected text, so a text action
        // must not carry the capture along and answer a different question.
        s.contextAttachments = [{
          id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
          selectedRepresentationIds: ["text"]
        }]
        root.latch("")
        root.deliverSelection("a paragraph the user just selected")
        if (!s.runTextAction("fix", "")) root.fail("fix did not run")
        var textActionSubmit = root.commandsOfType(root.drain(), "submit")
        if (textActionSubmit.length !== 1) root.fail("expected one submit for the text action")
        else if (textActionSubmit[0].contextAttachments !== undefined)
          root.fail("a text action carried the captured context along")
        s.resetChat()
        root.drain()
      } else if (root.stage === 13) {
        // The composer is what turns typed text into a free prompt. Every
        // other caller of submit — the voice lane above all — is asking its
        // own question and must not have it wrapped around the selection.
        root.latch("")
        root.deliverSelection("a paragraph the user just selected")
        if (!s.submit("what time is it in Tokyo?"))
          root.fail("a spoken question could not be asked")
        var spoken = root.commandsOfType(root.drain(), "submit")
        if (spoken.length !== 1) root.fail("expected one submit for the spoken question")
        else if (String(spoken[0].question).indexOf("OMAPILOT TEXT ACTION") >= 0)
          root.fail("a question from another lane was applied to the selection")
        s.endTextAction()
        root.drain()
      } else if (root.stage === 14) {
        // A send the harness refuses has to leave the chooser exactly as it
        // was. It used to write the action it was about to run before knowing
        // the send would happen, and that field is the one the attachment
        // path reads long afterwards.
        //
        // The stage before left a question in flight, and a store that is busy
        // refuses for its own reason; reset so the refusal under test is the
        // one being asked for.
        s.resetChat()
        root.latch("")
        root.deliverSelection("a paragraph the user just selected")
        s.continuationBlocked = true
        if (s.runTextAction("rewrite", "")) root.fail("a refused send reported success")
        s.continuationBlocked = false
        if (!s.selectionChoosing) root.fail("a refused send took the chooser away")
        if (s.selectionAction !== "" || s.selectionInstruction !== "")
          root.fail("a refused send left '" + s.selectionAction + "' written")
        if (s.notice === "") root.fail("the refusal said nothing to the user")
        // And the chooser still works afterwards.
        if (!s.runTextAction("fix", "")) root.fail("the chooser was dead after a refusal")
        s.endTextAction()
        root.drain()
      } else {
        if (!root.failed) console.log("OMAPILOT_TEXT_ACTION_PROBE_OK")
        Qt.quit()
      }
      root.stage++
    }
  }
}
