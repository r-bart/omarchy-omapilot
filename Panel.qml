import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "components" as Quickchat

Panel {
  id: root
  moduleName: "io.github.spencerbull.quickchat"
  ipcTarget: moduleName
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root
  property bool openedFromHotkey: false
  property string viewMode: "chat"
  property string previewSource: ""
  property string previewAlt: ""

  readonly property color foreground: bar ? bar.foreground : Color.popups.text
  readonly property color surface: Color.popups.background
  readonly property color accent: Color.accent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function persistSettings(values) {
    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) entry[key] = values[key]
    root.settings = entry
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  function open() {
    openedFromHotkey = false
    viewMode = "chat"
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
    Qt.callLater(function() { composer.forceInputFocus() })
  }

  function openFromHotkey() {
    openedFromHotkey = true
    viewMode = "chat"
    root.controller.show()
    Qt.callLater(function() {
      if (root.opened) root.setCenterHoverRevealSuppressed(true)
      composer.forceInputFocus()
    })
  }

  function openHistory() {
    viewMode = "history"
    root.controller.show()
    Quickchat.QuickchatStore.requestHistory()
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    previewSource = ""
    root.controller.hide()
    if (hostWidget) Qt.callLater(function() {
      if (typeof hostWidget.restoreFocus === "function") hostWidget.restoreFocus()
      else hostWidget.forceActiveFocus()
    })
  }

  function toggle() {
    if (opened) close()
    else openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function providerModelKey(provider) { return String(provider) + "Model" }

  onSettingsChanged: Quickchat.QuickchatStore.configure(settings)
  Component.onCompleted: Quickchat.QuickchatStore.configure(settings)
  onOpenedChanged: if (opened) {
    Quickchat.QuickchatStore.configure(settings)
    if (viewMode === "history") Quickchat.QuickchatStore.requestHistory()
    else Qt.callLater(function() { composer.forceInputFocus() })
  }

  IpcHandler {
    target: root.ipcTarget
    function open() { root.openFromHotkey() }
    function close() { root.close() }
    function show() { root.openFromHotkey() }
    function hide() { root.close() }
    function toggle() { root.toggle() }
    function history() { root.openHistory() }
    function newChat() { Quickchat.QuickchatStore.newChat(); root.openFromHotkey() }
  }

  Shortcut {
    enabled: root.opened
    sequence: "Escape"
    onActivated: {
      if (root.previewSource !== "") root.previewSource = ""
      else if (Quickchat.QuickchatStore.busy) Quickchat.QuickchatStore.cancel()
      else root.close()
    }
  }

  KeyboardPanel {
    id: popup
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: panelFocus
    contentWidth: popup.fittedContentWidth(Style.space(560))
    contentHeight: popup.fittedContentHeight(Style.space(620))

    Item {
      id: panelFocus
      anchors.fill: parent
      focus: true

      ColumnLayout {
        id: chatView
        anchors.fill: parent
        visible: root.viewMode === "chat"
        spacing: Style.spacing.xxl

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.md

          ColumnLayout {
            Layout.fillWidth: true
            spacing: 0

            Text {
              text: "Quickchat"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.heading
              font.bold: true
            }

            Text {
              text: Quickchat.QuickchatStore.state === "streaming" ? "Answering with " + Quickchat.QuickchatStore.provider
                : "One question, right when you need it"
              color: Qt.darker(root.foreground, 1.45)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          PanelActionButton {
            iconText: "󰋚"
            tooltipText: "Recent chats"
            foreground: root.foreground
            focusable: true
            Accessible.name: tooltipText
            onClicked: root.openHistory()
          }

          PanelActionButton {
            iconText: "󰅙"
            tooltipText: "Close Quickchat"
            foreground: root.foreground
            focusable: true
            Accessible.name: tooltipText
            onClicked: root.close()
          }
        }

        Quickchat.Composer {
          id: composer
          Layout.fillWidth: true
          backend: Quickchat.QuickchatStore
          foreground: root.foreground
          background: root.surface
          accent: root.accent
          fontFamily: root.fontFamily
          onProviderChanged: function(provider) { root.persistSettings({ provider: provider }) }
          onModelChanged: function(provider, model) {
            var values = {}; values[root.providerModelKey(provider)] = model; root.persistSettings(values)
          }
          onSubmitted: answerScroll.contentY = 0
          onEscapeRequested: root.close()
        }

        BorderSurface {
          id: answerCard
          Layout.fillWidth: true
          Layout.fillHeight: true
          color: Style.normalFillFor(root.foreground, root.accent)
          borderSpec: Border.controlSpec("normal", root.foreground, root.accent)
          radius: Style.cornerRadius
          visible: Quickchat.QuickchatStore.question !== ""
            || Quickchat.QuickchatStore.answerMarkdown !== ""
            || Quickchat.QuickchatStore.state === "error"
            || Quickchat.QuickchatStore.state === "unavailable"

          ColumnLayout {
            anchors.fill: parent
            anchors.leftMargin: parent.contentLeftInset + Style.spacing.xxl
            anchors.rightMargin: parent.contentRightInset + Style.spacing.xxl
            anchors.topMargin: parent.contentTopInset + Style.spacing.xl
            anchors.bottomMargin: parent.contentBottomInset + Style.spacing.lg
            spacing: Style.spacing.lg

            RowLayout {
              Layout.fillWidth: true
              visible: Quickchat.QuickchatStore.question !== ""

              Text {
                Layout.fillWidth: true
                text: Quickchat.QuickchatStore.question
                color: Qt.darker(root.foreground, 1.35)
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }

              Text {
                text: Quickchat.QuickchatStore.state === "streaming" ? "STREAMING"
                  : Quickchat.QuickchatStore.state === "canceled" ? "CANCELED"
                  : Quickchat.QuickchatStore.state === "complete" ? "ANSWER" : ""
                color: Quickchat.QuickchatStore.state === "canceled" ? Color.urgent : root.accent
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
                font.letterSpacing: 1
              }
            }

            Flickable {
              id: answerScroll
              Layout.fillWidth: true
              Layout.fillHeight: true
              contentWidth: width
              contentHeight: answerContent.implicitHeight
              clip: true
              boundsBehavior: Flickable.StopAtBounds
              interactive: contentHeight > height

              Column {
                id: answerContent
                width: answerScroll.width
                spacing: Style.spacing.xl

                Text {
                  visible: Quickchat.QuickchatStore.answerMarkdown === ""
                    && Quickchat.QuickchatStore.statusMessage !== ""
                  width: parent.width
                  text: Quickchat.QuickchatStore.statusMessage
                  color: Quickchat.QuickchatStore.state === "error" || Quickchat.QuickchatStore.state === "unavailable"
                    ? Color.urgent : Qt.darker(root.foreground, 1.35)
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  wrapMode: Text.Wrap
                  Accessible.role: Accessible.StaticText
                  Accessible.name: text
                }

                Quickchat.MarkdownView {
                  width: parent.width
                  visible: Quickchat.QuickchatStore.answerMarkdown !== "" || Quickchat.QuickchatStore.images.length > 0
                  markdown: Quickchat.QuickchatStore.answerMarkdown
                  images: Quickchat.QuickchatStore.images
                  foreground: root.foreground
                  background: root.surface
                  accent: root.accent
                  fontFamily: root.fontFamily
                  onLinkActivated: function(url) { Quickchat.QuickchatStore.activateLink(url) }
                  onImageLoadRequested: function(image) { Quickchat.QuickchatStore.requestImage(image) }
                  onImagePreviewRequested: function(source, alt) {
                    root.previewSource = source
                    root.previewAlt = alt
                  }
                  onCopyRequested: function(text) { Quickchat.QuickchatStore.copyText(text) }
                }
              }
            }

            RowLayout {
              Layout.fillWidth: true
              visible: Quickchat.QuickchatStore.answerMarkdown !== ""
              spacing: Style.spacing.md

              Button {
                iconText: "󰆏"
                text: "Copy"
                tooltipText: "Copy answer"
                foreground: root.foreground
                background: root.surface
                bordered: true
                focusable: true
                onClicked: Quickchat.QuickchatStore.copyText(Quickchat.QuickchatStore.answerMarkdown)
              }

              Item { Layout.fillWidth: true }

              Button {
                text: "New chat"
                foreground: root.foreground
                background: root.surface
                bordered: true
                focusable: true
                onClicked: Quickchat.QuickchatStore.newChat()
              }

              Button {
                iconText: "󰆍"
                text: "Continue in Herdr"
                tooltipText: "Create a durable Herdr tab from this chat"
                visible: Quickchat.QuickchatStore.currentChatId !== ""
                foreground: root.foreground
                background: root.surface
                accent: root.accent
                active: true
                bordered: true
                focusable: true
                onClicked: Quickchat.QuickchatStore.continueInHerdr()
              }
            }
          }
        }

        Item {
          Layout.fillHeight: true
          visible: !answerCard.visible
        }
      }

      Quickchat.HistoryView {
        anchors.fill: parent
        visible: root.viewMode === "history"
        history: Quickchat.QuickchatStore.history
        foreground: root.foreground
        background: root.surface
        accent: root.accent
        fontFamily: root.fontFamily
        onChatSelected: function(chat) {
          Quickchat.QuickchatStore.loadChat(chat)
          root.viewMode = "chat"
        }
        onDeleteRequested: function(chatId) { Quickchat.QuickchatStore.deleteHistory(chatId) }
        onClearRequested: Quickchat.QuickchatStore.clearHistory()
        onCloseRequested: {
          root.viewMode = "chat"
          Qt.callLater(function() { composer.forceInputFocus() })
        }
      }

      Rectangle {
        anchors.fill: parent
        visible: root.previewSource !== ""
        z: 100
        color: Qt.rgba(Color.background.r, Color.background.g, Color.background.b, 0.82)

        TapHandler { onTapped: root.previewSource = "" }

        BorderSurface {
          anchors.centerIn: parent
          width: Math.min(parent.width - Style.spacing.xxl * 2, Style.space(500))
          height: Math.min(parent.height - Style.spacing.xxl * 2, Style.space(500))
          color: root.surface
          borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.normalBorderWidth))
          radius: Style.cornerRadius

          TapHandler { onTapped: function(eventPoint) { eventPoint.accepted = true } }

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
  }
}
