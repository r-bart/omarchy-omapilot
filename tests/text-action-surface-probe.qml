import QtQuick
import Quickshell
import "components" as OmaPilot

// The chooser as a surface renders it: real buttons, real layout, real theme.
//
// qmltestrunner cannot load anything that imports qs.Ui, which is why this is
// a probe and not a unit test. What it holds is what a grep cannot see — that
// the quote stops at six lines whatever it is given, that the chip a bare
// Enter would run is the one drawn as primary, and that the console shows the
// chooser instead of, never beside, its desktop quick actions.
ShellRoot {
  id: root

  property bool failed: false
  property int stage: 0
  property string picked: ""

  function fail(message) {
    failed = true
    console.error("omapilot text action surface probe failed: " + message)
  }

  // The chooser keeps its parts private, so they are found by the properties
  // only they have rather than by walking a layout that is free to change.
  function descendants(item, match) {
    var found = []
    function walk(node) {
      if (!node || !node.children) return
      for (var i = 0; i < node.children.length; i++) {
        var child = node.children[i]
        if (child && match(child)) found.push(child)
        walk(child)
      }
    }
    walk(item)
    return found
  }

  function chips() {
    return root.descendants(chooser, function(item) {
      return item.action !== undefined && String(item.action) !== ""
    })
  }

  function quote() {
    var found = root.descendants(chooser, function(item) {
      return item.maximumLineCount === 6
    })
    return found.length > 0 ? found[0] : null
  }

  BackendStub {
    id: backendStub
    selectionChoosing: true
    selectionText: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine"
    textActionLanguage: "Spanish"
    textActionDefault: "fix"
  }

  OmaPilot.TextActionChooser {
    id: chooser
    width: 420
    backend: backendStub
    onActionRequested: function(action) { root.picked = action }
  }

  OmaPilot.ConsoleContent {
    id: content
    width: 440
    height: 900
    backend: backendStub
    focused: true
    motionEnabled: false
  }

  Timer {
    interval: 160
    running: true
    repeat: true
    onTriggered: {
      if (root.stage === 0) {
        // Nine lines of selection, six lines of quote, and the rest elided.
        // A selection is up to eight thousand characters and this is not a
        // viewer.
        var text = root.quote()
        if (text === null) root.fail("the quoted selection is not there at all")
        else {
          if (text.lineCount > 6) root.fail("the quote ran to " + text.lineCount + " lines")
          if (!text.truncated) root.fail("nine lines of selection were not elided")
          if (String(text.text) !== backendStub.selectionText)
            root.fail("the quote is not the selection")
        }
      } else if (root.stage === 1) {
        var buttons = root.chips()
        if (buttons.length !== 3) root.fail("expected three chips, found " + buttons.length)
        else {
          if (buttons[0].action !== "fix" || buttons[1].action !== "rewrite"
              || buttons[2].action !== "translate")
            root.fail("the chips are in the wrong order")
          // Where a translation is going is on the chip, not behind a setting.
          if (buttons[2].text !== "Translate → Spanish")
            root.fail("the translate chip reads '" + buttons[2].text + "'")
          if (!buttons[0].bordered || buttons[1].bordered || buttons[2].bordered)
            root.fail("the chip Enter would run is not the one drawn as primary")
          if (buttons[0].tooltipText.indexOf("(Enter)") < 0)
            root.fail("the default chip does not say Enter runs it")
          // The tooltip and the accessible name say what the word does.
          if (buttons[0].tooltipText.indexOf("Fix grammar and syntax") < 0)
            root.fail("the Fix chip's tooltip only repeats its label")
          if (buttons[1].tooltipText !== "Rewrite more clearly")
            root.fail("the Rewrite chip's tooltip reads '" + buttons[1].tooltipText + "'")
          if (buttons[1].Accessible.name !== buttons[1].tooltipText)
            root.fail("the chip's accessible name is not what its tooltip says")
          // A pointer target on the desktop wants 40 pixels of height. The
          // chips are ordinary shell buttons, so this measures the shell's
          // own control size rather than anything invented here.
          for (var h = 0; h < buttons.length; h++)
            if (buttons[h].height < 32)
              root.fail("chip " + h + " is only " + Math.round(buttons[h].height) + " px tall")
        }
      } else if (root.stage === 2) {
        // The default follows what the user last ran, so the border moves.
        backendStub.textActionDefault = "translate"
        var moved = root.chips()
        if (moved[0].bordered || !moved[2].bordered)
          root.fail("the primary chip did not follow the remembered action")
        backendStub.textActionDefault = "fix"
      } else if (root.stage === 3) {
        // The primary chip is drawn with a border and the others are not, and
        // the default moves as the user changes what they last ran. If that
        // costs a pixel the whole row shuffles under the cursor every time.
        backendStub.textActionDefault = "fix"
        var before = root.chips().map(function(chip) { return chip.width })
        backendStub.textActionDefault = "translate"
        var after = root.chips().map(function(chip) { return chip.width })
        for (var w = 0; w < before.length; w++)
          if (before[w] !== after[w])
            root.fail("chip " + w + " changed width with the default: "
              + before[w] + " -> " + after[w])
        backendStub.textActionDefault = "fix"
      } else if (root.stage === 4) {
        // The console is 360 pixels wide at its narrowest and a language name
        // can be long. A chip that cannot fit must still be readable.
        var narrow = chooser.width
        chooser.width = 360
        backendStub.textActionLanguage = "Brazilian Portuguese"
        var translateChip = root.chips()[2]
        if (translateChip.width < translateChip.implicitWidth)
          root.fail("the translate chip is clipped at 360: needs "
            + Math.round(translateChip.implicitWidth) + " has " + Math.round(translateChip.width))
        backendStub.textActionLanguage = "Spanish"
        chooser.width = narrow
      } else if (root.stage === 5) {
        root.picked = ""
        root.chips()[1].clicked()
        if (root.picked !== "rewrite")
          root.fail("pressing a chip asked for '" + root.picked + "'")
      } else if (root.stage === 6) {
        // Nothing is offered while the harness is answering or a replacement
        // is being typed.
        backendStub.state = "streaming"
        if (root.chips()[0].enabled) root.fail("a chip stayed live while streaming")
        backendStub.state = "composing"
        backendStub.selectionReplacing = true
        if (root.chips()[0].enabled) root.fail("a chip stayed live while replacing")
        backendStub.selectionReplacing = false
        if (!root.chips()[0].enabled) root.fail("the chips never came back")
      } else if (root.stage === 7) {
        // In the console the chooser takes the empty state's place; two rows
        // of things to press is a menu, not an empty state.
        var choosers = root.descendants(content, function(item) {
          return item.defaultAction !== undefined && item.language !== undefined
        })
        if (choosers.length !== 1)
          root.fail("the console has " + choosers.length + " choosers")
        else if (!choosers[0].visible)
          root.fail("the console hid the chooser while the store was choosing")
        var actionRows = root.descendants(content, function(item) {
          return item.workInAppShortcutText !== undefined
        })
        if (actionRows.length !== 1)
          root.fail("expected one quick-action row, found " + actionRows.length)
        else if (actionRows[0].visible)
          root.fail("the desktop quick actions showed up beside the chooser")
      } else if (root.stage === 8) {
        // Once something has been asked, the chooser is gone and the answer's
        // own controls are what is left.
        backendStub.selectionChoosing = false
        backendStub.question = "Translate to Spanish"
        backendStub.answerMarkdown = "El gato."
        backendStub.textActionActive = true
        if (chooser.visible) root.fail("the chooser stayed up after an action ran")
        if (chooser.implicitHeight !== 0)
          root.fail("the hidden chooser still takes " + chooser.implicitHeight + " pixels")
      } else {
        if (!root.failed) console.log("OMAPILOT_TEXT_ACTION_SURFACE_PROBE_OK")
        Qt.quit()
      }
      root.stage++
    }
  }
}
