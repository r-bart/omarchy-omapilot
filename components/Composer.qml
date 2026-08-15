import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Protocol.js" as Protocol

Item {
  id: root

  required property var backend
  property bool inlineMode: false
  property string draftText: ""
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal providerChanged(string provider)
  signal modelChanged(string provider, string model)
  signal submitted()
  signal escapeRequested()

  readonly property bool inputActive: inlineMode ? inlineInput.activeFocus : promptInput.activeFocus
  readonly property bool popupOpen: inlineProvider.popupOpen || providerPicker.popupOpen || modelPicker.popupOpen

  implicitWidth: inlineMode ? Style.space(360) : Style.space(520)
  implicitHeight: inlineMode ? Style.bar.sizeHorizontal : panelComposer.implicitHeight

  function submit() {
    if (!backend || !backend.submit(draftText)) return
    submitted()
  }

  function forceInputFocus() {
    if (inlineMode) inlineInput.forceActiveFocus()
    else promptInput.forceActiveFocus()
  }

  function closePopups() {
    inlineProvider.close()
    providerPicker.close()
    modelPicker.close()
    forceInputFocus()
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
      enabled: root.backend && !root.backend.busy
      text: root.draftText
      placeholderText: root.backend && root.backend.initialized ? "Ask anything…" : "Starting…"
      foreground: root.foreground
      horizontalPadding: Style.spacing.md
      verticalPadding: Style.spacing.xxs
      Accessible.name: "Quickchat question"
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
      tooltipText: root.backend && root.backend.state === "dictating" ? "Stop dictation" : "Dictate"
      foreground: root.foreground
      focusable: true
      enabled: root.backend && root.backend.initialized && root.backend.state !== "streaming" && root.backend.state !== "preparing"
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
    spacing: Style.spacing.lg

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md

      Dropdown {
        id: providerPicker
        Layout.preferredWidth: Style.space(132)
        showLabel: false
        options: root.backend ? root.backend.providers : []
        value: root.backend ? root.backend.provider : ""
        enabled: root.backend && !root.backend.busy
        foreground: root.foreground
        background: root.background
        Accessible.name: "AI harness"
        onChanged: function(value) {
          root.backend.selectProvider(value)
          root.providerChanged(value)
        }
      }

      Dropdown {
        id: modelPicker
        Layout.fillWidth: true
        showLabel: false
        options: root.backend && root.backend.modelOptions.length > 0
          ? root.backend.modelOptions
          : [{ value: "", label: "Harness default" }]
        value: root.backend ? root.backend.model : ""
        enabled: root.backend && !root.backend.busy
        foreground: root.foreground
        background: root.background
        Accessible.name: "AI model"
        onChanged: function(value) {
          root.backend.model = value
          root.modelChanged(root.backend.provider, value)
        }
      }

    }

    Text {
      Layout.fillWidth: true
      visible: root.backend
      text: !root.backend ? "" : root.backend.providerPolicy.tools === "sandboxed"
        ? Protocol.providerLabel(root.backend.provider) + " chooses when to search the web or use disposable scratch. Host files, credentials, direct network access, and outside writes stay blocked."
        : root.backend.providerPolicy.tools === "blocked"
          ? Protocol.providerLabel(root.backend.provider) + " chooses when to search the web. Device commands stay blocked until its harness can present an exact approval."
          : Protocol.providerLabel(root.backend.provider) + " uses device tools when useful. It may read user-readable files; network access and broader commands require Allow once."
      color: Qt.darker(root.foreground, 1.45)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.Wrap
      Accessible.role: Accessible.StaticText
      Accessible.name: text
    }

    Text {
      Layout.fillWidth: true
      visible: root.backend && root.backend.modelOptions.length === 0
      text: "Using the harness default. This harness did not expose a model catalog."
      color: Qt.darker(root.foreground, 1.45)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.Wrap
      Accessible.role: Accessible.StaticText
      Accessible.name: text
    }

    BorderSurface {
      Layout.fillWidth: true
      Layout.preferredHeight: Style.space(108)
      visible: !root.backend || root.backend.pendingPermission === null
      color: Style.normalFillFor(root.foreground, root.accent)
      borderSpec: Border.controlSpec(promptInput.activeFocus ? "focus" : (promptHover.hovered ? "hover-cursor" : "normal"), root.foreground, root.accent)
      radius: Style.cornerRadius

      HoverHandler { id: promptHover }

      TextArea {
        id: promptInput
        anchors.fill: parent
        anchors.margins: Style.spacing.xs
        enabled: root.backend && root.backend.state !== "streaming" && root.backend.state !== "preparing"
        text: root.draftText
        placeholderText: root.backend && root.backend.initialized ? "Ask anything…" : "Starting Quickchat…"
        placeholderTextColor: Qt.darker(root.foreground, 1.55)
        color: root.foreground
        selectionColor: Style.selectionFillFor(root.foreground, root.accent)
        selectedTextColor: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        wrapMode: TextEdit.Wrap
        background: null
        Accessible.name: "Quickchat question"
        onTextEdited: {
          root.draftText = text
        }

        Keys.onPressed: function(event) {
          if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
              && !(event.modifiers & Qt.ShiftModifier)) {
            root.submit()
            event.accepted = true
          } else if (event.key === Qt.Key_Escape) {
            if (root.backend && root.backend.busy) root.backend.cancel()
            else root.escapeRequested()
            event.accepted = true
          }
        }
      }
    }

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md

      Text {
        Layout.fillWidth: true
        text: root.backend ? root.backend.statusMessage : ""
        visible: text !== ""
        color: root.backend && root.backend.state === "error" ? Color.urgent : Qt.darker(root.foreground, 1.45)
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
        Accessible.role: Accessible.StaticText
        Accessible.name: text
      }

      Button {
        visible: root.backend && root.backend.canRetry
        text: "Retry"
        tooltipText: "Restart the Quickchat broker"
        foreground: root.foreground
        background: root.background
        bordered: true
        focusable: true
        Accessible.name: tooltipText
        onClicked: root.backend.retryBroker()
      }

      Button {
        iconText: root.backend && root.backend.state === "dictating" ? "󰓛" : "󰍬"
        text: root.backend && root.backend.state === "dictating" ? "Stop listening" : "Dictate"
        tooltipText: root.backend && root.backend.state === "dictating" ? "Finish dictation" : "Dictate with Voxtype"
        foreground: root.foreground
        background: root.background
        bordered: true
        focusable: true
        enabled: root.backend && root.backend.initialized && root.backend.state !== "streaming" && root.backend.state !== "preparing"
        Accessible.name: tooltipText
        onClicked: {
          if (root.backend.state === "dictating") root.backend.stopDictation()
          else root.backend.startDictation()
        }
      }

      Button {
        iconText: root.backend && root.backend.busy ? "󰓛" : "󰒊"
        text: root.backend && root.backend.busy ? "Stop" : "Send"
        tooltipText: root.backend && root.backend.busy ? "Stop response" : "Send question"
        foreground: root.foreground
        background: root.background
        accent: root.accent
        active: root.backend && !root.backend.busy && root.draftText.trim() !== ""
        bordered: true
        focusable: true
        enabled: root.backend && (root.backend.busy || (root.backend.canSubmit && root.draftText.trim() !== ""))
        Accessible.name: tooltipText
        onClicked: {
          if (root.backend.busy) root.backend.cancel()
          else root.submit()
        }
      }
    }
  }
}
