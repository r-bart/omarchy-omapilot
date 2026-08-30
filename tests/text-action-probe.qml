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
        s.currentChatId = "10000000-0000-4000-8000-000000000001"
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
          if (sent.saveToHistory !== false)
            root.fail("the text action was allowed to become chat history")
          if (sent.resumeChatId !== undefined)
            root.fail("the text action resumed the open conversation")
        }
      } else if (root.stage === 3) {
        // Replace sends the answer to the window the action was latched to.
        s.applyEvent({ type: "complete", id: s.currentId, answer: "El gato se sentó en la alfombra." })
        if (s.currentChatId !== "10000000-0000-4000-8000-000000000001")
          root.fail("the text action did not restore the conversation behind it")
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
      } else if (root.stage === 15) {
        // A read the user walked away from must not land on the selection they
        // latched afterwards. The protocol carries no request id, so the only
        // safe answer is to allow one read at a time and drop the reply to an
        // action that is gone.
        s.resetChat()
        root.latch("fix")
        if (!s.selectionPending) root.fail("the read was not marked in flight")
        s.dismissTextAction()
        if (s.beginTextAction("fix") !== "pending")
          root.fail("a second read started while the first was still out")
        // Reply to the abandoned read.
        s.applyEvent({ type: "selection", available: true, text: "text from the first window" })
        if (s.selectionChoosing || s.textActionActive || s.selectionText !== "")
          root.fail("an abandoned read still produced an action")
        if (root.commandsOfType(root.drain(), "submit").length !== 0)
          root.fail("an abandoned read submitted a prompt")
        // And the feature still works right afterwards.
        root.latch("")
        root.deliverSelection("text from the second window")
        if (!s.selectionChoosing) root.fail("the next action could not start")
        s.endTextAction()
        root.drain()
      } else if (root.stage === 16) {
        // An unrelated error while a paste is in flight must not make the real
        // answer unreadable, and must never allow a second paste.
        s.resetChat()
        root.latch("fix")
        root.deliverSelection("teh cat sat")
        root.drain()
        s.answerMarkdown = "The cat sat."
        s.state = "complete"
        s.replaceSelectionWithAnswer()
        if (root.commandsOfType(root.drain(), "selection_replace").length !== 1)
          root.fail("the first paste was not sent")
        s.applyEvent({ type: "error", code: "capability_failed", message: "unrelated" })
        s.replaceSelectionWithAnswer()
        if (root.commandsOfType(root.drain(), "selection_replace").length !== 0)
          root.fail("an unrelated error let the same text be pasted twice")
        s.applyEvent({ type: "selection_replaced", replaced: true })
        if (s.textActionActive)
          root.fail("the real reply was dropped after an unrelated error")
        root.drain()
      } else if (root.stage === 17) {
        // Regenerate resets the chat before it runs, so a refused run has to
        // put back the action it found rather than the nothing reset left.
        s.resetChat()
        root.latch("")
        root.deliverSelection("teh cat sat")
        if (!s.runTextAction("translate", "")) root.fail("translate did not run")
        root.drain()
        s.answerMarkdown = "El gato se sentó."
        s.state = "complete"
        // The refusal has to survive the resetChat inside regenerate, and
        // continuationBlocked does not: that reset clears it, and the test
        // then passed for the wrong reason. An empty provider list does.
        var harness = s.providers
        s.providers = []
        s.regenerateTextAction()
        s.providers = harness
        if (s.selectionAction !== "translate")
          root.fail("a refused regenerate left the action as '" + s.selectionAction + "'")
        // And Regenerate still works once the harness is back.
        s.regenerateTextAction()
        if (root.commandsOfType(root.drain(), "submit").length !== 1)
          root.fail("Regenerate was dead after a refusal")
        s.endTextAction()
        root.drain()
      } else if (root.stage === 18) {
        // Asking something else while the read is still out is still asking
        // something else. The chooser must not arrive over that conversation.
        s.resetChat()
        root.latch("fix")
        if (!s.submit("what is the capital of France?"))
          root.fail("an ordinary question could not be asked during a read")
        root.drain()
        s.applyEvent({ type: "selection", available: true, text: "a paragraph" })
        if (s.selectionChoosing || s.textActionActive)
          root.fail("a chooser arrived over an unrelated conversation")
        s.resetChat()
        root.drain()
      } else if (root.stage === 19) {
        // A text action does not send the captured context, but it must not
        // throw it away either: the user captured it for the question they are
        // still going to ask.
        s.resetChat()
        s.contextAttachments = [{
          id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
          selectedRepresentationIds: ["text"]
        }]
        root.latch("")
        root.deliverSelection("teh cat sat")
        if (!s.runTextAction("fix", "")) root.fail("fix did not run")
        root.drain()
        if (s.contextAttachments.length !== 1)
          root.fail("a text action threw the captured context away")
        s.endTextAction()
        s.resetChat()
        root.drain()
      } else if (root.stage === 20) {
        // A scripted caller has only the return value to go on, so a refusal
        // must not read as success.
        s.resetChat()
        root.latch("")
        root.deliverSelection("teh cat sat")
        s.answerMarkdown = "The cat sat."
        s.state = "complete"
        if (s.replaceSelectionWithAnswer() !== "choosing")
          root.fail("a refusal while choosing did not say so to its caller")
        if (!s.runTextAction("fix", "")) root.fail("fix did not run")
        root.drain()
        s.answerMarkdown = "The cat sat."
        s.state = "complete"
        if (s.replaceSelectionWithAnswer() !== "send")
          root.fail("an accepted replacement did not say so to its caller")
        root.drain()
        s.endTextAction()
      } else if (root.stage === 21) {
        s.state = "composing"
        s.selectionPending = true
        s.selectionTarget = root.address
        s.selectionText = root.selection
        s.selectionChoosing = true
        s.selectionAction = "translate"
        s.currentId = "turn-observable"
        var observable = s.textActionStatePayload()
        if (observable.state !== "composing" || observable.pending !== true
            || observable.active !== true || observable.choosing !== true
            || observable.action !== "translate" || observable.turnId !== "turn-observable")
          root.fail("the safe text-action state omitted lifecycle identity")
        if (observable.selectionText !== undefined || observable.selectionTarget !== undefined
            || observable.question !== undefined || observable.answerMarkdown !== undefined)
          root.fail("the safe text-action state exposed private action content")
        s.endTextAction()
        s.currentId = ""
      } else {
        if (!root.failed) console.log("OMAPILOT_TEXT_ACTION_PROBE_OK")
        Qt.quit()
      }
      root.stage++
    }
  }
}
