import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Protocol.js" as Protocol
import "Presentation.js" as Presentation

Item {
  id: root

  required property var backend
  property bool inlineMode: false
  property string draftText: ""
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  // The bar panel has no header to put the surface switch in, so it keeps it
  // here. The console turns this off and shows the same row beside its gear.
  property bool showSurfaceSwitch: true
  readonly property string currentSurface: root.backend
    ? Protocol.normalizedSurface(root.backend.configuredSurface) : "panel"

  signal providerChanged(string provider)
  signal modelChanged(string provider, string model)
  signal submitted()
  signal escapeRequested()
  // Routed through key events rather than Qt Shortcut. The panel is a layer
  // surface whose keyboard focus is OnDemand after a brief Exclusive prime, so
  // window activation — which Qt.WindowShortcut depends on — is not dependable.
  // Key events reach the focused editor regardless, which is why Enter and
  // Escape below have always worked.
  signal historyRequested()

  readonly property bool inputActive: inlineMode ? inlineInput.activeFocus : promptInput.activeFocus
  property bool attachmentPopupOpen: false
  property string hostName: ""
  readonly property bool popupOpen: inlineProvider.popupOpen || attachmentPopupOpen

  FileView {
    path: "/etc/hostname"
    watchChanges: false
    printErrors: false
    onLoaded: root.hostName = String(text() || "").trim().split(/\s+/)[0]
  }

  implicitWidth: inlineMode ? Style.space(360) : Style.space(520)
  implicitHeight: inlineMode ? Style.bar.sizeHorizontal : panelComposer.implicitHeight

  function submit() {
    if (!backend || !backend.submitFromComposer(draftText)) return
    draftText = ""
    submitted()
  }

  function setDraft(text) {
    draftText = String(text || "")
    Qt.callLater(function() {
      root.forceInputFocus()
      if (!root.inlineMode) promptInput.cursorPosition = promptInput.length
      else inlineInput.cursorPosition = inlineInput.length
    })
  }

  function forceInputFocus() {
    if (!root.visible) return
    if (inlineMode) inlineInput.forceActiveFocus()
    else promptInput.forceActiveFocus()
  }

  function closePopups() {
    inlineProvider.close()
    for (var i = 0; i < attachmentRepeater.count; i++) {
      var preview = attachmentRepeater.itemAt(i)
      if (preview) preview.closePopup()
    }
    forceInputFocus()
  }

  function refreshAttachmentPopupState() {
    var anyOpen = false
    for (var i = 0; i < attachmentRepeater.count; i++) {
      var preview = attachmentRepeater.itemAt(i)
      if (preview && preview.popupOpen) anyOpen = true
    }
    attachmentPopupOpen = anyOpen
  }

  function acceptTranscript() {
    if (!backend || !backend.transcript) return
    draftText = String(backend.transcript)
    Qt.callLater(forceInputFocus)
  }

  Connections {
    target: root.backend
    function onTranscriptChanged() { root.acceptTranscript() }
    function onFocusComposerRequested() {
      root.draftText = ""
      Qt.callLater(root.forceInputFocus)
    }
  }

  RowLayout {
    id: inlineComposer
    anchors.fill: parent
    visible: root.inlineMode
    spacing: Style.spacing.sm

    Dropdown {
      id: inlineProvider
      Layout.preferredWidth: Style.space(92)
      Layout.fillHeight: true
      showLabel: false
      rowHeight: parent.height
      options: root.backend ? root.backend.providers : []
      value: root.backend ? root.backend.provider : ""
      foreground: root.foreground
      background: root.background
      onChanged: function(value) {
        root.backend.selectProvider(value)
        root.providerChanged(value)
      }
    }

    TextField {
      id: inlineInput
      Layout.fillWidth: true
      Layout.fillHeight: true
      enabled: root.backend && !root.backend.busy && !root.backend.continuationBlocked
      text: root.draftText
      // Hosts hide the composer while a selection is waiting. Keep this text
      // defensive for any future host that renders it during that state.
      placeholderText: root.backend && root.backend.selectionChoosing === true
        ? "What should I do with this text?"
        : root.backend && root.backend.initialized
          ? "What do you want to do?"
          : "Starting…"
      foreground: root.foreground
      horizontalPadding: Style.spacing.md
      verticalPadding: Style.spacing.xxs
      Accessible.name: "OmaPilot request"
      onTextEdited: {
        root.draftText = text
      }
      onAccepted: root.submit()
      Keys.onEscapePressed: function(event) {
        if (root.backend && root.backend.busy) root.backend.cancel()
        else root.escapeRequested()
        event.accepted = true
      }
    }

    PanelActionButton {
      Layout.alignment: Qt.AlignVCenter
      iconText: root.backend && root.backend.state === "dictating" ? "󰓛" : "󰍬"
      tooltipText: root.backend && root.backend.state === "dictating" ? "Stop dictation"
        : (root.backend && root.backend.voiceEnabled === false ? "Enable voice in Settings" : "Dictate")
      foreground: root.foreground
      focusable: true
      enabled: root.backend && root.backend.providerReady && !root.backend.continuationBlocked
        && root.backend.state !== "streaming" && root.backend.state !== "preparing"
      Accessible.name: tooltipText
      onClicked: {
        if (root.backend.state === "dictating") root.backend.stopDictation()
        else root.backend.startDictation()
      }
    }

    PanelActionButton {
      Layout.alignment: Qt.AlignVCenter
      iconText: root.backend && root.backend.busy ? "󰓛" : "󰒊"
      tooltipText: root.backend && root.backend.busy ? "Stop response" : "Send question"
      foreground: root.foreground
      focusable: true
      enabled: root.backend && (root.backend.busy || (root.backend.canSubmit && root.draftText.trim() !== ""))
      Accessible.name: tooltipText
      onClicked: {
        if (root.backend.busy) root.backend.cancel()
        else root.submit()
      }
    }
  }

  ColumnLayout {
    id: panelComposer
    anchors.left: parent.left
    anchors.right: parent.right
    visible: !root.inlineMode
    spacing: Style.spacing.md

    Repeater {
      id: attachmentRepeater
      model: root.backend && Array.isArray(root.backend.contextAttachments)
        ? root.backend.contextAttachments : []
      onItemAdded: Qt.callLater(root.refreshAttachmentPopupState)
      onItemRemoved: Qt.callLater(root.refreshAttachmentPopupState)

      ContextAttachmentPreview {
        required property var modelData
        Layout.fillWidth: true
        backend: root.backend
        attachment: modelData
        foreground: root.foreground
        background: root.background
        accent: root.accent
        fontFamily: root.fontFamily
        onPopupOpenChanged: root.refreshAttachmentPopupState()
      }
    }

    Text {
      Layout.fillWidth: true
      visible: root.backend && root.backend.desktopContextActive && root.hostName !== ""
      text: "󰍹  " + root.hostName
      color: Qt.darker(root.foreground, 1.45)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      elide: Text.ElideRight
      Accessible.role: Accessible.StaticText
      Accessible.name: "Desktop context attached from " + root.hostName
    }

    // The hero: one borderless prompt line, not a boxed text area with a
    // toolbar. Keep its text on the same left edge as context and responses;
    // a decorative prompt glyph only indented the user's words.
    Item {
      id: promptRow
      Layout.fillWidth: true
      // Grows with the draft, then stops. Unbounded, a pasted block took the
      // height it wanted: the composer sits under a `fillHeight` conversation,
      // so sixty lines of paste squeezed the answer above it to nothing and
      // then pushed itself off the bottom of the window. Nine lines is where
      // it stops growing and starts scrolling.
      readonly property int maxPromptHeight: Style.space(180)
      Layout.preferredHeight: Math.max(Style.space(34),
        Math.min(promptInput.implicitHeight + Style.spacing.md, maxPromptHeight))
      visible: !root.backend || root.backend.pendingPermission === null

      // Past the cap the editor scrolls inside the row. `TextArea.flickable`
      // is the form QtQuick.Controls provides for exactly this, and it owns
      // the two parts worth not hand-rolling: keeping the caret in view, and
      // arbitrating a press-drag between selecting text and panning. The
      // editor keeps its own implicit height under it, which is what the cap
      // above reads.
      //
      // `interactive` is bound rather than left on, so a drag inside a draft
      // that fits cannot be taken for a flick when there is nothing to scroll.
      Flickable {
        id: promptScroll
        anchors {
          left: parent.left; right: promptTools.left; top: parent.top; bottom: parent.bottom
          rightMargin: Style.spacing.md
        }
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        TextArea.flickable: TextArea {
          id: promptInput
          enabled: root.backend && !root.backend.continuationBlocked
            && root.backend.state !== "streaming" && root.backend.state !== "preparing"
          text: root.draftText
          placeholderText: root.backend && root.backend.selectionChoosing === true
            ? "What should I do with this text?"
            : root.backend && root.backend.initialized
              ? "Ask, or describe what to do"
              : "Starting OmaPilot\u2026"
          // 1.7 measured 4.12:1 against the popup background on the shipped
          // theme — under the 4.5:1 floor, and the heading token this renders
          // at is well short of the size that earns the 3:1 large-text
          // allowance. 1.6 clears it at 4.57:1 and still reads as a
          // placeholder.
          placeholderTextColor: Qt.darker(root.foreground, 1.6)
          color: root.foreground
          selectionColor: Style.selectionFillFor(root.foreground, root.accent)
          selectedTextColor: root.foreground
          font.family: root.fontFamily
          // Deliberately larger than body: the request is the most important
          // text in the panel, and the old body-size input buried it.
          font.pixelSize: Style.font.heading
          wrapMode: TextEdit.Wrap
          background: null
          leftPadding: 0
          topPadding: 0
          bottomPadding: 0
          Accessible.name: "OmaPilot request"
          onTextEdited: root.draftText = text

          Keys.onPressed: function(event) {
            if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                && !(event.modifiers & Qt.ShiftModifier)) {
              root.submit()
              event.accepted = true
            } else if (event.key === Qt.Key_H && (event.modifiers & Qt.ControlModifier)) {
              root.historyRequested()
              event.accepted = true
            } else if (event.key === Qt.Key_Escape) {
              if (root.backend && root.backend.busy) root.backend.cancel()
              else root.escapeRequested()
              event.accepted = true
            }
          }
        }
      }

      // Only the two affordances that have no keyboard equivalent worth
      // teaching stay visible, and they lose their boxes. Provider identity
      // moved to the panel's hint row; send is Enter.
      Row {
        id: promptTools
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.spacing.xs

        // The surface switch lives here, beside the other composer actions,
        // because the composer is the one piece all three surfaces share. In
        // the header it existed only inside the console — reachable to leave a
        // surface, never to enter one, which left the bar panel with no way in
        // short of a dropdown five tabs deep in settings.
        //
        // All three, always, rather than one button that cycles. Cycling showed
        // the icon of the *next* surface, so the one you wanted was one click
        // away or two and never named: going back to the bar panel from the
        // console meant passing through fullscreen to discover where it was.
        // Two extra glyphs buy every destination in one click, and the current
        // surface stays on show and marked — a row that changed width as you
        // switched would be a row you had to re-find every time.
        Repeater {
          model: root.showSurfaceSwitch ? Protocol.surfaceOrder() : []

          PanelActionButton {
            readonly property string surfaceName: String(modelData)
            readonly property bool current: root.currentSurface === surfaceName

            iconText: Presentation.surfaceIcon(surfaceName)
            tooltipText: Presentation.surfaceTooltip(surfaceName)
            // Same marking the console header uses, so the control reads as
            // one control that lives in two places rather than two controls.
            foreground: current ? root.accent : root.foreground
            focusable: true
            // Moving surfaces mid-turn would tear the answer out from under the
            // user; the settings dropdown holds the same line.
            enabled: root.backend && !root.backend.busy
            Accessible.name: current ? tooltipText + " (current)" : tooltipText
            onClicked: {
              if (root.backend && typeof root.backend.selectSurface === "function")
                root.backend.selectSurface(surfaceName)
            }
          }
        }

        PanelActionButton {
          iconText: "󰹑"
          tooltipText: "Clip context from the desktop"
          foreground: root.foreground
          focusable: true
          enabled: root.backend && root.backend.contextCaptureAvailable
          Accessible.name: tooltipText
          onClicked: root.backend.beginContextCapture()
        }

        PanelActionButton {
          iconText: root.backend && (root.backend.busy || root.backend.state === "dictating")
            ? "󰓛" : "󰍬"
          tooltipText: root.backend && root.backend.busy ? "Stop response" : "Dictate with Voxtype"
          foreground: root.backend && root.backend.state === "dictating" ? root.accent : root.foreground
          focusable: true
          enabled: root.backend && root.backend.providerReady && !root.backend.continuationBlocked
          Accessible.name: tooltipText
          onClicked: {
            if (root.backend.busy && root.backend.state !== "dictating") root.backend.cancel()
            else if (root.backend.state === "dictating") root.backend.stopDictation()
            else root.backend.startDictation()
          }
        }
      }
    }

    RowLayout {
      Layout.fillWidth: true
      visible: statusText.visible || retryButton.visible
      spacing: Style.spacing.md

      Text {
        id: statusText
        Layout.fillWidth: true
        text: root.backend ? root.backend.statusMessage : ""
        visible: text !== "" && root.backend
          && (root.backend.continuationBlocked
            || root.backend.state === "dictating"
            || (root.backend.question === ""
              && root.backend.state !== "error"
              && root.backend.state !== "unavailable"))
        color: root.backend && root.backend.state === "error" ? Color.urgent : Qt.darker(root.foreground, 1.45)
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
        Accessible.role: Accessible.StaticText
        Accessible.name: text
      }

      Button {
        id: retryButton
        // Suppressed while the panel is showing an error notice. The notice
        // explains the failure and now carries its own retry, so leaving this
        // one here stranded a lone bordered button under the composer with no
        // label beside it and no context.
        visible: root.backend && root.backend.canRetry
          && root.backend.state !== "error" && root.backend.state !== "unavailable"
        text: "Retry"
        tooltipText: "Restart the OmaPilot broker"
        foreground: root.foreground
        background: root.background
        bordered: true
        focusable: true
        Accessible.name: tooltipText
        onClicked: root.backend.retryBroker()
      }
    }
  }
}
