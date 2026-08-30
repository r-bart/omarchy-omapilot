import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "." as OmaPilot
import "internal" as OmaPilotInternal
import "Presentation.js" as Presentation
import "Protocol.js" as Protocol
import "QuickActions.js" as ActionCatalog
import "StatePhrases.js" as StatePhrases

// Everything inside the console window, with no window of its own.
//
// The split from Console.qml is deliberate and is not how the other surfaces
// are built — VoiceNode and AnswerCurtain embed their PanelWindow, which means
// their layout only ever renders on a live Wayland session, and design-qa.md
// documents what that costs the visual fixtures. With the content separate,
// every state below renders offscreen in the preview harness; only geometry
// and the filament's bloom need the real session.
Item {
  id: root

  required property var backend
  // Whether the surface currently holds the compositor's keyboard. Without it
  // there is no keyboard to bind Escape to, and nowhere for a restored caret to
  // go — it gates the shortcut and the lane changes, not the ladder itself.
  property bool focused: false
  property bool motionEnabled: true
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  property string viewMode: "chat"
  property string previewSource: ""
  property string previewAlt: ""

  signal closeRequested()

  // The console speaks the same state language as the panel and the ambient
  // surfaces; the filament is the one element that carries it.
  readonly property bool failureVisible: backend
    && (backend.state === "error" || backend.state === "unavailable")
  readonly property bool responseActivityActive: backend
    && (backend.state === "preparing" || backend.state === "streaming")
  readonly property string statePhase: failureVisible ? "error"
    : (responseActivityActive ? "thinking"
      : (backend && backend.answerMarkdown !== "" ? "answering" : "listening"))
  readonly property bool hasTurn: backend && (backend.question !== ""
    || backend.answerMarkdown !== "" || failureVisible)
  readonly property bool dangerousAutoApprove: backend
    && backend.configuredDangerousAutoApprove === true
  readonly property var quickActionItems: ActionCatalog.actionsFromSettings(
    backend && typeof backend.configuredQuickActionsJson === "string"
      ? backend.configuredQuickActionsJson : "",
    backend && backend.configuredShowSummarizeAction === true,
    backend && backend.configuredShowWorkInAppAction === true)

  property int thinkingPhraseIndex: 0
  readonly property bool genericActivityStatus: responseActivityActive
    && StatePhrases.isGenericStatus(backend ? backend.statusMessage : "")
  readonly property string activityStatusText: StatePhrases.thinkingStatus(
    thinkingPhraseIndex, backend ? backend.statusMessage : "")

  Timer {
    id: thinkingPhraseTimer
    interval: 2800
    running: root.motionEnabled && root.genericActivityStatus
    repeat: true
    onTriggered: thinkingPhraseSwap.restart()
  }

  SequentialAnimation {
    id: thinkingPhraseSwap
    PropertyAnimation {
      target: activityStatus; property: "opacity"
      to: 0; duration: 180; easing.type: Easing.InQuad
    }
    ScriptAction {
      script: root.thinkingPhraseIndex = (root.thinkingPhraseIndex + 1)
        % StatePhrases.thinkingCount()
    }
    PropertyAnimation {
      target: activityStatus; property: "opacity"
      to: 1; duration: 260; easing.type: Easing.OutQuad
    }
  }

  onResponseActivityActiveChanged: {
    thinkingPhraseSwap.stop()
    activityStatus.opacity = 1
    if (!responseActivityActive) thinkingPhraseIndex = 0
  }

  function showChat(restoreFocus) {
    settingsView.closePopups(false)
    viewMode = "chat"
    if (restoreFocus !== false && root.focused)
      Qt.callLater(function() { composer.forceInputFocus() })
  }

  function openHistory() {
    settingsView.closePopups(false)
    viewMode = "history"
    if (backend && typeof backend.requestHistory === "function") backend.requestHistory()
    Qt.callLater(function() { historyView.forceInitialFocus() })
  }

  function openSettings(tab) {
    if (tab) settingsView.selectTab(tab)
    viewMode = "settings"
    if (backend && typeof backend.requestCustomProviders === "function") {
      backend.requestCustomProviders()
      backend.requestVoxtypeOsd()
      backend.requestVoiceStatus()
      backend.requestBrowserCompanionStatus()
    }
    Qt.callLater(function() { settingsView.forceInitialFocus() })
  }

  function openErrorDetails() {
    viewMode = "error"
    Qt.callLater(function() { errorView.forceInitialFocus() })
  }

  function forceComposerFocus() {
    if (viewMode === "chat") composer.forceInputFocus()
  }

  function reset() {
    previewSource = ""
    showChat(false)
  }

  // Starting a new conversation is also going to it. Clearing the chat while
  // the user is looking at history or settings left them there, staring at the
  // lane they were in with nothing to say they had been heard — the new chat
  // was behind them, empty, with the caret nowhere.
  function startNewChat() {
    if (!backend || typeof backend.newChat !== "function") return
    backend.newChat()
    showChat()
  }

  // Settings changes must persist identically whether this view is hosted by
  // the panel (bar.layout entry) or by the console (no settings injection at
  // all). The store relays to whichever owner holds settings authority, which
  // is why this goes through the backend instead of the panel's signal chain.
  function requestPersist(values) {
    if (backend && typeof backend.requestSettingsPersist === "function")
      backend.requestSettingsPersist(values)
  }

  function handleEscape() {
    // Hard rule: a pending approval pins the console. Escape is an answer —
    // the rejection — never a dismissal that leaves the request dangling.
    // It only applies while the card is actually in front of the user: from
    // settings, history, a popup, or a preview, the ladder runs first and
    // unwinds toward the chat lane where the card lives — rejecting something
    // the user cannot see would be worse than the dangling request. And when
    // the harness offered no reject option, the ladder runs too, so Escape
    // still cancels the turn instead of dying against a missing choice.
    var approvalInFront = backend && backend.pendingPermission !== null
      && viewMode === "chat" && previewSource === "" && !composer.popupOpen
    if (approvalInFront && backend.hasPermissionDecision("reject_once")) {
      backend.respondPermission("reject_once", backend.permissionChoiceId("reject_once"))
      return
    }
    var action = Presentation.escapeAction(root.viewMode, composer.popupOpen,
      settingsView.popupOpen, root.previewSource !== "",
      backend ? backend.busy : false)
    if (action === "close-composer-popup") composer.closePopups()
    else if (action === "close-settings-popup") settingsView.closePopups()
    else if (action === "close-preview") root.previewSource = ""
    else if (action === "show-chat") root.showChat()
    else if (action === "cancel") backend.cancel()
    // "close-panel" names the ladder's terminal step, not the surface; the
    // console maps it to its own close the way Panel.qml maps it to its own.
    else root.closeRequested()
  }

  Shortcut {
    sequence: "Escape"
    enabled: root.focused && root.visible
    onActivated: root.handleEscape()
  }

  // The filament: the panel's state light turned on its side, sharing its
  // vocabulary with the voice node so the surfaces read as one product.
  OmaPilot.StateLightBar {
    id: filament
    anchors.left: parent.left
    anchors.top: parent.top
    anchors.bottom: parent.bottom
    width: implicitWidth
    vertical: true
    phase: root.statePhase
    accent: root.accent
    urgent: Color.urgent
    motionEnabled: root.motionEnabled
  }

  // Docked, the console is as wide as it will ever be and the content simply
  // fills it. Filling a 2560px screen instead gives lines nobody can track from
  // one end to the next, a composer pinned to a far corner, and a conversation
  // stranded against one edge. Past this measure the column stops growing and
  // centres: the same layout, not a stretched one.
  //
  // The measure is arithmetic, not taste. The shell font is monospace, so a
  // character is exactly 0.6em: at `Style.font.body` the column holds
  // `width / (0.6 * body)` characters, and because the cap and the font scale
  // together through the same `fontScale`, that count is the same at every
  // `base-size`. Docked at the 587px the compositor gives this screen, the
  // column is 56 characters — comfortable. The old 920 cap made fullscreen
  // 128, which is not a line anyone reads twice.
  //
  // 560 puts fullscreen at 78: a shade over the 75 the reading rules ask for,
  // and stopping there is deliberate. Below `Style.space(560)` the header can
  // no longer keep harness, model, posture and hints on one row, so a tighter
  // measure would buy a few characters and cost the header its shape on the
  // widest surface there is.
  readonly property int contentInset: Style.space(18)
  readonly property int maxContentWidth: Style.space(560)
  readonly property int contentWidth: Math.min(
    Math.max(width - contentInset * 2, 0), maxContentWidth)
  // The column is stacked exactly when it could not reach its own maximum —
  // which is to say, when the surface is too narrow to give it. Written
  // against `maxContentWidth` rather than repeating the number, because the
  // two being equal is load-bearing and two literals drift.
  readonly property bool tightMeta: contentWidth < maxContentWidth

  ColumnLayout {
    anchors.top: parent.top
    anchors.bottom: parent.bottom
    anchors.horizontalCenter: parent.horizontalCenter
    width: root.contentWidth
    anchors.topMargin: Style.space(14)
    anchors.bottomMargin: Style.space(14)
    spacing: Style.spacing.lg

    OmaPilot.OmaPilotHeader {
      Layout.fillWidth: true
      backend: root.backend
      stackedMeta: root.tightMeta
      dangerousAutoApprove: root.dangerousAutoApprove
      motionEnabled: root.motionEnabled
      foreground: root.foreground
      background: root.background
      accent: root.accent
      fontFamily: root.fontFamily
      currentSurface: root.backend ? root.backend.configuredSurface : "console"
      onSettingsRequested: root.viewMode === "settings" ? root.showChat() : root.openSettings()
      onHarnessChanged: function(value) {
        if (String(value || "") !== "") root.requestPersist({ provider: String(value) })
      }
      onModelPicked: function(value) {
        if (!root.backend) return
        root.backend.model = value
        var values = {}
        values[String(root.backend.provider) + "Model"] = value
        root.requestPersist(values)
      }
      onNewChatRequested: root.startNewChat()
      onHistoryRequested: root.viewMode === "history" ? root.showChat() : root.openHistory()
      onSurfaceRequested: function(name) {
        if (root.backend && typeof root.backend.selectSurface === "function")
          root.backend.selectSurface(name)
      }
    }

    Rectangle {
      Layout.fillWidth: true
      implicitHeight: 1
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.06)
    }

    // A pending selection belongs to the sidebar, not to the bottom of the
    // conversation. Keeping the decision card directly under the persistent
    // metadata makes it visible immediately and leaves the whole column below
    // the language picker for Dropdown's downward popup.
    OmaPilot.TextActionChooser {
      id: textActionChooser
      Layout.fillWidth: true
      visible: root.viewMode === "chat" && root.backend
        && root.backend.selectionChoosing === true
      backend: root.backend
      foreground: root.foreground
      background: root.background
      accent: root.accent
      fontFamily: root.fontFamily
      onActionRequested: function(action, language) {
        if (root.backend.runTextAction(action, "", language)) turnScroll.resetForNewTurn()
      }
      onLanguageRequested: function(language) {
        root.requestPersist({ textActionLanguage: language })
      }
    }

    Rectangle {
      Layout.fillWidth: true
      implicitHeight: 1
      visible: textActionChooser.visible
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.06)
    }

    Item {
      id: mainArea
      Layout.fillWidth: true
      Layout.fillHeight: true

      Flickable {
        id: turnScroll
        anchors.fill: parent
        visible: root.viewMode === "chat"
        contentWidth: width
        contentHeight: Math.max(height, turnColumn.implicitHeight)
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: turnColumn.implicitHeight > height
        property bool followLatest: true
        readonly property real bottomThreshold: Style.space(56)

        function maximumContentY() {
          return Math.max(0, contentHeight - height)
        }

        function followContentIfNeeded() {
          if (!followLatest) return
          followContent.restart()
        }

        // A Timer, not `Qt.callLater`: this tree is unloaded at runtime when
        // the surface changes, and a callLater outlives the object whose
        // closure it captured — it lands on a Flickable whose meta-object is
        // already gone and throws. The timer is a child here, so it dies with
        // the viewport it was going to scroll.
        Timer {
          id: followContent
          interval: 0
          onTriggered: if (turnScroll.followLatest)
            turnScroll.contentY = turnScroll.maximumContentY()
        }

        function resetForNewTurn() {
          followLatest = true
          contentY = 0
        }

        onContentHeightChanged: followContentIfNeeded()
        onHeightChanged: followContentIfNeeded()
        onContentYChanged: if (dragging || flicking)
          followLatest = Presentation.isNearBottom(contentY, contentHeight, height, bottomThreshold)
        onMovementEnded: followLatest = Presentation.isNearBottom(
          contentY, contentHeight, height, bottomThreshold)

        Column {
          id: turnColumn
          width: turnScroll.width
          // Anchored to the bottom of the viewport while it fits, so the
          // conversation grows upward from the composer like any chat — the
          // stretched-panel layout left its dead space at the bottom instead.
          y: Math.max(0, turnScroll.height - implicitHeight)
          spacing: Style.space(18)

          // The conversation so far. Every turn is its own record and what
          // makes a run of them one conversation is sharing an acpId, so the
          // thread is grouped on that and never on adjacency — thirty records
          // across every session the user has had are otherwise flat.
          //
          // The live turn below is not repeated here: it is painted from
          // `question` and `answerMarkdown`, and it lands in history the moment
          // it completes. Painting the finished turns above it rather than in a
          // region of their own is what stops "answering" and "in the history"
          // being a visible jump.
          Repeater {
            model: root.backend
              ? Protocol.threadBefore(root.backend.history, root.backend.currentChatId) : []

            delegate: OmaPilot.ConsoleTurn {
              // Declared, not inherited: a delegate in its own file only gets
              // the model role if it asks for it, and without this the turn
              // arrives undefined and renders as an empty bubble.
              required property var modelData

              width: turnColumn.width
              backend: root.backend
              turn: modelData
              foreground: root.foreground
              background: root.background
              accent: root.accent
              fontFamily: root.fontFamily
              onPreviewRequested: function(source, alt) {
                root.previewSource = source
                root.previewAlt = alt
              }
            }
          }

          // The user's turn: an accent bubble with a tail toward the composer
          // it came from. Alpha over the theme roles, never a new grey.
          Item {
            width: parent.width
            height: bubble.height
            visible: root.backend && root.backend.question !== ""

            Rectangle {
              id: bubble
              anchors.right: parent.right
              width: Math.min(bubbleText.implicitWidth + Style.space(28), parent.width * 0.86)
              height: bubbleText.implicitHeight + Style.space(20)
              radius: Style.space(10)
              bottomRightRadius: Style.space(4)
              color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.10)
              border.width: Style.normalBorderWidth
              border.color: Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.22)

              Text {
                id: bubbleText
                anchors.fill: parent
                anchors.leftMargin: Style.space(14)
                anchors.rightMargin: Style.space(14)
                anchors.topMargin: Style.space(10)
                anchors.bottomMargin: Style.space(10)
                text: root.backend ? root.backend.question : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.Wrap
                Accessible.role: Accessible.StaticText
                Accessible.name: text
              }
            }
          }

          Text {
            id: activityStatus
            width: parent.width
            visible: root.responseActivityActive
            text: root.activityStatusText
            color: Qt.darker(root.foreground, 1.25)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.weight: Font.Medium
            elide: Text.ElideRight
            maximumLineCount: 1
            Accessible.role: Accessible.StaticText
            Accessible.name: text
          }

          // The answer plate: prose and provenance in one quiet container.
          Rectangle {
            id: answerPlate
            width: parent.width
            // The plate exists for delivered content. While a turn is only a
            // question in flight, the bubble and the status line carry it —
            // an empty plate under them reads as a broken response.
            visible: root.failureVisible || (root.backend
              && (root.backend.answerMarkdown !== "" || root.backend.images.length > 0))
            implicitHeight: plateColumn.implicitHeight + Style.space(30)
            radius: Style.space(10)
            color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.035)
            border.width: Style.normalBorderWidth
            border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)

            ColumnLayout {
              id: plateColumn
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.top: parent.top
              anchors.leftMargin: Style.space(14)
              anchors.rightMargin: Style.space(14)
              anchors.topMargin: Style.space(15)
              spacing: Style.spacing.lg

              OmaPilot.ErrorNotice {
                Layout.fillWidth: true
                visible: root.failureVisible
                message: root.backend ? root.backend.statusMessage : ""
                foreground: root.foreground
                background: root.background
                accent: root.accent
                fontFamily: root.fontFamily
                onDetailsRequested: root.openErrorDetails()
              }

              Button {
                visible: root.backend && root.backend.canRetry
                text: "Retry"
                tooltipText: "Restart the OmaPilot broker"
                foreground: root.foreground
                background: root.background
                accent: root.accent
                bordered: true
                focusable: true
                Accessible.name: tooltipText
                onClicked: root.backend.retryBroker()
              }

              OmaPilot.MarkdownView {
                Layout.fillWidth: true
                visible: root.backend && (root.backend.answerMarkdown !== ""
                  || root.backend.images.length > 0)
                markdown: root.backend ? root.backend.answerMarkdown : ""
                images: root.backend ? root.backend.images : []
                foreground: root.foreground
                background: root.background
                accent: root.accent
                fontFamily: root.fontFamily
                onLinkActivated: function(url) { root.backend.activateLink(url) }
                onImageLoadRequested: function(image) {
                  if (typeof root.backend.requestImage === "function") root.backend.requestImage(image)
                }
                onImagePreviewRequested: function(source, alt) {
                  root.previewSource = source
                  root.previewAlt = alt
                }
                onCopyRequested: function(text) { root.backend.copyText(text) }
              }

              // Provenance closes the plate on its own line; at 404px the
              // buttons below would otherwise elide the harness name to
              // nothing — the exact failure the old panel header had.
              Text {
                Layout.fillWidth: true
                elide: Text.ElideRight
                text: root.backend
                  ? Protocol.providerShortLabel(root.backend.provider)
                    + (root.backend.model !== "" ? " · " + root.backend.model : "")
                  : ""
                color: Qt.darker(root.foreground, 1.4)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                Accessible.role: Accessible.StaticText
                Accessible.name: text
              }

              // What a text action has to tell the user: that nothing was
              // selected, that the replacement landed, or why it did not. The
              // store's toast signal has no consumer in this shell, so these
              // messages get a surface of their own rather than going nowhere.
              Text {
                Layout.fillWidth: true
                text: root.backend ? root.backend.notice : ""
                visible: text !== ""
                color: Qt.darker(root.foreground, 1.45)
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WordWrap
              }

              RowLayout {
                Layout.fillWidth: true
                spacing: Style.spacing.md

                Button {
                  text: "Replace"
                  tooltipText: "Type this over the text you selected"
                  visible: root.backend && root.backend.textActionActive
                    && !root.backend.selectionChoosing
                  enabled: root.backend && root.backend.textActionReady
                    && root.backend.answerMarkdown !== ""
                  foreground: root.foreground
                  background: root.background
                  accent: root.accent
                  bordered: true
                  focusable: true
                  onClicked: root.backend.replaceSelectionWithAnswer()
                }

                Button {
                  text: "Regenerate"
                  tooltipText: "Run the same action on the same selection again"
                  visible: root.backend && root.backend.textActionActive
                    && !root.backend.selectionChoosing
                  enabled: root.backend && root.backend.textActionReady
                  foreground: Qt.darker(root.foreground, 1.4)
                  background: root.background
                  bordered: false
                  focusable: true
                  onClicked: root.backend.regenerateTextAction()
                }

                OmaPilot.CopyButton {
                  idleTooltip: "Copy answer"
                  doneTooltip: "Answer copied"
                  sourceText: root.backend ? root.backend.answerMarkdown : ""
                  idleForeground: Qt.darker(root.foreground, 1.4)
                  doneForeground: root.accent
                  enabled: root.backend && root.backend.answerMarkdown !== ""
                  onCopyRequested: function(text) { root.backend.copyText(text) }
                }

                Item { Layout.fillWidth: true }

                Button {
                  text: "Continue in Herdr"
                  tooltipText: "Continue with native harness permissions · Super+Alt+H"
                  visible: root.backend && root.backend.currentChatId !== ""
                  foreground: Qt.darker(root.foreground, 1.4)
                  background: root.background
                  accent: root.accent
                  bordered: false
                  focusable: true
                  onClicked: root.backend.continueInHerdr()
                }
              }
            }
          }

          // The approval, outside the plate with its own frame, so agreeing to
          // something never reads as part of the answer's prose. At full height
          // the exact request fits without the 140px clamp the panel needs.
          BorderSurface {
            id: permissionCard
            width: parent.width
            visible: root.backend && root.backend.pendingPermission !== null
            implicitHeight: permissionContent.implicitHeight + contentTopInset
              + contentBottomInset + Style.spacing.xl * 2
            color: Style.normalFillFor(root.foreground, root.accent)
            borderSpec: Border.controlSpec("focus", root.foreground, root.accent)
            radius: Style.space(8)

            OmaPilotInternal.PermissionFocusGuard {
              permissionId: root.backend && root.backend.pendingPermission
                ? String(root.backend.pendingPermission.id || "") : ""
              defaultTarget: denyPermission.visible ? denyPermission : permissionChoices.itemAt(0)
            }

            ColumnLayout {
              id: permissionContent
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.top: parent.top
              anchors.margins: Style.spacing.xl
              spacing: Style.spacing.md

              Text {
                Layout.fillWidth: true
                text: root.backend && root.backend.pendingPermission
                  ? "Approval required: " + root.backend.pendingPermission.title : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                wrapMode: Text.Wrap
              }

              Text {
                Layout.fillWidth: true
                text: "Review the exact request and choose how long this agent may retain the approval. Esc rejects once."
                color: Qt.darker(root.foreground, 1.45)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.Wrap
              }

              TextEdit {
                Layout.fillWidth: true
                text: root.backend && root.backend.pendingPermission
                  ? root.backend.pendingPermission.detail : ""
                color: Qt.darker(root.foreground, 1.25)
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WrapAnywhere
                textFormat: Text.PlainText
                readOnly: true
                selectByMouse: true
              }

              Flow {
                Layout.fillWidth: true
                Layout.preferredHeight: implicitHeight
                spacing: Style.spacing.md

                Button {
                  id: denyPermission
                  text: "Deny"
                  foreground: root.foreground
                  background: root.background
                  bordered: true
                  focusable: true
                  visible: root.backend && root.backend.hasPermissionDecision("reject_once")
                  onClicked: root.backend.respondPermission(
                    "reject_once", root.backend.permissionChoiceId("reject_once"))
                }

                Repeater {
                  id: permissionChoices
                  model: root.backend ? root.backend.permissionOptionsWithoutDenyOnce() : []
                  delegate: Button {
                    required property var modelData
                    text: modelData.label
                    foreground: root.foreground
                    background: root.background
                    accent: root.accent
                    active: modelData.decision === "allow_once"
                    bordered: true
                    focusable: true
                    onClicked: root.backend.respondPermission(modelData.decision, modelData.id)
                  }
                }
              }
            }
          }
        }
      }

      OmaPilot.HistoryView {
        id: historyView
        anchors.fill: parent
        visible: root.viewMode === "history"
        history: root.backend && root.backend.history ? root.backend.history : []
        motionEnabled: root.motionEnabled
        foreground: root.foreground
        background: root.background
        accent: root.accent
        fontFamily: root.fontFamily
        onChatSelected: function(chat) {
          root.backend.loadChat(chat)
          turnScroll.resetForNewTurn()
          root.showChat()
        }
        onDeleteRequested: function(chatId) { root.backend.deleteHistory(chatId) }
        onClearRequested: root.backend.clearHistory()
        onCloseRequested: root.showChat()
      }

      OmaPilot.SettingsView {
        id: settingsView
        anchors.fill: parent
        visible: root.viewMode === "settings"
        backend: root.backend
        dangerousAutoApprove: root.dangerousAutoApprove
        webHandoffProvider: root.backend ? root.backend.webHandoffProvider : "duckduckgo"
        desktopContextEnabled: root.backend && root.backend.desktopContextEnabled === true
        voiceEnabled: root.backend && root.backend.voiceEnabled === true
        ttsProvider: root.backend ? root.backend.ttsProvider : "elevenlabs"
        ttsModel: root.backend ? root.backend.ttsModel : ""
        ttsVoice: root.backend ? root.backend.ttsVoice : ""
        quickActions: root.quickActionItems
        motionEnabled: root.motionEnabled
        foreground: root.foreground
        background: root.background
        accent: root.accent
        fontFamily: root.fontFamily
        onDangerousAutoApproveRequested: function(enabled) {
          root.requestPersist({ dangerousAutoApprove: enabled === true })
        }
        onDesktopContextRequested: function(enabled) {
          root.requestPersist({ desktopContext: enabled === true ? "On" : "Off" })
        }
        onWebHandoffProviderRequested: function(provider) {
          root.requestPersist({ webHandoffProvider: Protocol.normalizedWebHandoffProvider(provider) || "duckduckgo" })
        }
        onCapabilityEnabledRequested: function(capabilityId, enabled) {
          root.backend.setCapabilityEnabled(capabilityId, enabled)
        }
        onCapabilityFilesRootRequested: function(path) {
          root.backend.setCapabilityFilesRoot(path)
        }
        onCapabilitiesRefreshRequested: root.backend.requestCapabilities()
        onProviderChanged: function(provider) {
          if (String(provider || "") !== "") root.requestPersist({ provider: String(provider) })
        }
        onModelChanged: function(provider, model) {
          var values = {}
          values[String(provider) + "Model"] = model
          root.requestPersist(values)
        }
        onQuickActionsEdited: function(actions) {
          root.requestPersist({ quickActionsJson: ActionCatalog.serializedActions(actions) })
        }
        onBrowserCompanionInstallRequested: root.backend.installBrowserCompanion()
        onBrowserCompanionUninstallRequested: root.backend.uninstallBrowserCompanion()
        onBrowserCompanionRefreshRequested: root.backend.requestBrowserCompanionStatus()
        onBrowserCompanionOpenSettingsRequested: function(family) { root.backend.openBrowserCompanionSettings(family) }
        onBrowserCompanionCopyPathRequested: function(family) { root.backend.copyBrowserCompanionPath(family) }
        onHotkeyInstallRequested: root.backend.installHotkeys()
        onHotkeyRemoveRequested: root.backend.removeHotkeys()
        onCustomProviderAddRequested: function(id, name, baseUrl, api, models, apiKey) {
          root.backend.addCustomProvider(id, name, baseUrl, api, models, apiKey)
        }
        onCustomProviderTestRequested: function(baseUrl, apiKey) {
          root.backend.testCustomProvider(baseUrl, apiKey)
        }
        onCustomProviderRemoveRequested: function(id) {
          root.backend.removeCustomProvider(id)
        }
        onVoxtypeOsdRequested: function(enabled) { root.backend.setVoxtypeOsd(enabled) }
        onVoiceEnabledRequested: function(enabled) {
          root.requestPersist({ voiceEnabled: enabled === true })
        }
        onTtsProviderRequested: function(provider) {
          var selected = Protocol.normalizedTtsProvider(provider) || "elevenlabs"
          var catalog = Protocol.ttsProviderStatus(root.backend.voiceStatus, selected)
          var model = Protocol.ttsDefaultModel(catalog)
          root.requestPersist({ ttsProvider: selected, ttsModel: model,
            ttsVoice: Protocol.ttsDefaultVoice(catalog, model) })
        }
        onTtsModelRequested: function(model) {
          var catalog = Protocol.ttsProviderStatus(root.backend.voiceStatus,
            root.backend.ttsProvider)
          var selected = String(model || "")
          var voice = root.backend.ttsVoice
          if (!Protocol.ttsVoiceAvailable(catalog, selected, voice))
            voice = Protocol.ttsDefaultVoice(catalog, selected)
          root.requestPersist({ ttsModel: selected, ttsVoice: voice })
        }
        onTtsVoiceRequested: function(voice) {
          root.requestPersist({ ttsVoice: String(voice || "") })
        }
        onTtsKeySetRequested: function(provider, apiKey) { root.backend.setTtsKey(provider, apiKey) }
        onTtsKeyClearRequested: function(provider) { root.backend.clearTtsKey(provider) }
        onTtsKeyTestRequested: function(provider, apiKey) { root.backend.testTtsKey(provider, apiKey) }
        onDismissed: root.showChat()
      }

      OmaPilot.ErrorDetailsView {
        id: errorView
        anchors.fill: parent
        visible: root.viewMode === "error"
        backend: root.backend
        details: root.backend ? root.backend.errorDetails : null
        foreground: root.foreground
        background: root.background
        accent: root.accent
        fontFamily: root.fontFamily
        onAuthenticationRequested: root.openSettings()
        onDismissed: root.showChat()
      }
    }

    OmaPilot.Composer {
      id: composer
      Layout.fillWidth: true
      visible: root.viewMode === "chat"
      // The header above carries the surface switch here. The bar panel has no
      // header, so there it stays in the composer's own action row.
      showSurfaceSwitch: false
      backend: root.backend
      foreground: root.foreground
      background: root.background
      accent: root.accent
      fontFamily: root.fontFamily
      onSubmitted: turnScroll.resetForNewTurn()
      onHistoryRequested: root.viewMode === "history" ? root.showChat() : root.openHistory()
      onEscapeRequested: root.handleEscape()
    }

    OmaPilot.QuickActions {
      id: quickActions
      Layout.fillWidth: true
      visible: root.viewMode === "chat" && !root.hasTurn
        && root.backend && !root.backend.busy
        && !root.backend.selectionChoosing && quickActions.actions.length > 0
      actions: root.quickActionItems
      foreground: root.foreground
      background: root.background
      accent: root.accent
      fontFamily: root.fontFamily
      onActionRequested: function(actionId, prompt) { composer.setDraft(prompt) }
    }

    // One quiet row teaches the shortcuts. The lanes have buttons in the header
    // now; this is what tells you the keys.
    RowLayout {
      Layout.fillWidth: true
      visible: root.viewMode === "chat"
      spacing: Style.spacing.md

      Item { Layout.fillWidth: true }

      Repeater {
        model: [
          { label: "Super+Alt+P settings", lane: "settings" },
          { label: "Ctrl+H history", lane: "history" }
        ]

        delegate: Text {
          id: hintLabel
          required property var modelData
          required property int index
          text: (index > 0 ? "·  " : "") + modelData.label
          color: hint.hovered ? root.accent : Qt.darker(root.foreground, 1.5)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          Accessible.role: Accessible.Button
          Accessible.name: "Open " + modelData.lane

          HoverHandler {
            id: hint
            cursorShape: Qt.PointingHandCursor
          }

          TapHandler {
            onTapped: {
              if (root.viewMode === hintLabel.modelData.lane) root.showChat()
              else if (hintLabel.modelData.lane === "settings") root.openSettings()
              else root.openHistory()
            }
          }
        }
      }
    }
  }

  Rectangle {
    anchors.fill: parent
    visible: root.previewSource !== ""
    z: 100
    color: Qt.rgba(Color.background.r, Color.background.g, Color.background.b, 0.82)

    // MouseAreas, not TapHandlers: two stacked TapHandlers with the default
    // passive grab both fire for one tap, so a click on the image would also
    // dismiss the overlay. The card's MouseArea takes the exclusive grab and
    // genuinely swallows clicks inside it.
    MouseArea {
    anchors.fill: parent
    onClicked: root.previewSource = ""
    }

    BorderSurface {
    anchors.centerIn: parent
    width: parent.width - Style.spacing.xxl * 2
    height: Math.min(parent.height - Style.spacing.xxl * 2, Style.space(500))
    color: root.background
    borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.normalBorderWidth))
    radius: Style.cornerRadius

    MouseArea {
      anchors.fill: parent
      onClicked: function(mouse) { mouse.accepted = true }
    }

    Image {
      anchors.fill: parent
      anchors.margins: Style.spacing.xxl
      source: root.previewSource
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      cache: false
      Accessible.name: root.previewAlt
    }

    PanelActionButton {
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.margins: Style.spacing.sm
      iconText: "󰅙"
      tooltipText: "Close image preview"
      foreground: root.foreground
      focusable: true
      Accessible.name: tooltipText
      onClicked: root.previewSource = ""
    }
    }
  }
}
