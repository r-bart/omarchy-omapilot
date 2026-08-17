import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "QuickActions.js" as ActionCatalog

ColumnLayout {
  id: root

  property var actions: []
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property bool adding: false
  readonly property bool atLimit: actions.length >= ActionCatalog.maximumActions
  readonly property bool canSaveNew: String(newLabel.text || "").trim() !== ""
    && String(newPrompt.text || "").trim() !== ""

  signal actionsEdited(var actions)

  spacing: Style.spacing.md

  function beginAdding() {
    if (atLimit) return
    adding = true
    newLabel.text = ""
    newPrompt.text = ""
    Qt.callLater(function() { newLabel.forceActiveFocus() })
  }

  function cancelAdding() {
    adding = false
    newLabel.text = ""
    newPrompt.text = ""
    Qt.callLater(function() { addButton.forceActiveFocus() })
  }

  function saveNew() {
    if (!canSaveNew || atLimit) return
    actionsEdited(ActionCatalog.addAction(
      actions, newLabel.text, newPrompt.text, Date.now()))
    adding = false
    newLabel.text = ""
    newPrompt.text = ""
    Qt.callLater(function() { addButton.forceActiveFocus() })
  }

  Repeater {
    model: root.actions

    delegate: BorderSurface {
      id: actionCard
      required property int index
      required property var modelData

      Layout.fillWidth: true
      implicitHeight: actionFields.implicitHeight + contentTopInset + contentBottomInset
        + Style.spacing.xl * 2
      color: Style.normalFillFor(root.foreground, root.accent)
      borderSpec: Border.controlSpec("normal", root.foreground, root.accent)
      radius: Style.cornerRadius

      function commitFields() {
        if (String(actionLabel.text || "").trim() === ""
            || String(actionPrompt.text || "").trim() === "") {
          actionLabel.text = String(modelData.label || "")
          actionPrompt.text = String(modelData.prompt || "")
          return
        }
        root.actionsEdited(ActionCatalog.updateAction(
          root.actions, actionCard.index, actionLabel.text, actionPrompt.text))
      }

      ColumnLayout {
        id: actionFields
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: parent.contentLeftInset + Style.spacing.xl
        anchors.rightMargin: parent.contentRightInset + Style.spacing.xl
        anchors.topMargin: parent.contentTopInset + Style.spacing.xl
        spacing: Style.spacing.sm

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          Text {
            Layout.fillWidth: true
            text: "Action " + String(actionCard.index + 1)
            color: Qt.darker(root.foreground, 1.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          PanelActionButton {
            iconText: "󰁝"
            tooltipText: "Move action up"
            foreground: root.foreground
            focusable: true
            enabled: actionCard.index > 0
            Accessible.name: tooltipText
            onClicked: root.actionsEdited(
              ActionCatalog.moveAction(root.actions, actionCard.index, -1))
          }

          PanelActionButton {
            iconText: "󰁅"
            tooltipText: "Move action down"
            foreground: root.foreground
            focusable: true
            enabled: actionCard.index < root.actions.length - 1
            Accessible.name: tooltipText
            onClicked: root.actionsEdited(
              ActionCatalog.moveAction(root.actions, actionCard.index, 1))
          }

          PanelActionButton {
            iconText: "󰆴"
            tooltipText: "Remove action"
            foreground: root.foreground
            hoverColor: Color.urgent
            focusable: true
            Accessible.name: tooltipText
            onClicked: root.actionsEdited(
              ActionCatalog.removeAction(root.actions, actionCard.index))
          }
        }

        TextField {
          id: actionLabel
          Layout.fillWidth: true
          text: String(actionCard.modelData.label || "")
          placeholderText: "Button label"
          maximumLength: 48
          foreground: root.foreground
          accent: root.accent
          Accessible.name: "Quick action label"
          onEditingFinished: actionCard.commitFields()
        }

        TextField {
          id: actionPrompt
          Layout.fillWidth: true
          text: String(actionCard.modelData.prompt || "")
          placeholderText: "Prompt inserted into the composer"
          maximumLength: 1200
          foreground: root.foreground
          accent: root.accent
          Accessible.name: "Quick action prompt"
          onEditingFinished: actionCard.commitFields()
        }
      }
    }
  }

  BorderSurface {
    Layout.fillWidth: true
    visible: root.adding
    implicitHeight: newActionFields.implicitHeight + contentTopInset + contentBottomInset
      + Style.spacing.xl * 2
    color: Style.focusFillFor(root.foreground, root.accent)
    borderSpec: Border.controlSpec("focus", root.foreground, root.accent)
    radius: Style.cornerRadius

    ColumnLayout {
      id: newActionFields
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.leftMargin: parent.contentLeftInset + Style.spacing.xl
      anchors.rightMargin: parent.contentRightInset + Style.spacing.xl
      anchors.topMargin: parent.contentTopInset + Style.spacing.xl
      spacing: Style.spacing.sm

      Text {
        Layout.fillWidth: true
        text: "New quick action"
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
      }

      TextField {
        id: newLabel
        Layout.fillWidth: true
        placeholderText: "Button label"
        maximumLength: 48
        foreground: root.foreground
        accent: root.accent
        Accessible.name: "New quick action label"
      }

      TextField {
        id: newPrompt
        Layout.fillWidth: true
        placeholderText: "Prompt inserted into the composer"
        maximumLength: 1200
        foreground: root.foreground
        accent: root.accent
        Accessible.name: "New quick action prompt"
        Keys.onReturnPressed: root.saveNew()
      }

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.md

        Item { Layout.fillWidth: true }

        Button {
          text: "Cancel"
          foreground: root.foreground
          background: root.background
          bordered: true
          focusable: true
          onClicked: root.cancelAdding()
        }

        Button {
          text: "Add"
          foreground: root.foreground
          background: root.background
          accent: root.accent
          active: true
          bordered: true
          focusable: true
          enabled: root.canSaveNew && !root.atLimit
          onClicked: root.saveNew()
        }
      }
    }
  }

  RowLayout {
    Layout.fillWidth: true
    spacing: Style.spacing.md

    Text {
      Layout.fillWidth: true
      text: String(root.actions.length) + " of "
        + String(ActionCatalog.maximumActions) + " actions"
      color: Qt.darker(root.foreground, 1.45)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      Accessible.role: Accessible.StaticText
      Accessible.name: text
    }

    Button {
      id: addButton
      iconText: "󰐕"
      text: "Add action"
      tooltipText: root.atLimit ? "Remove an action before adding another" : "Add a quick action"
      visible: !root.adding
      enabled: !root.atLimit
      foreground: root.foreground
      background: root.background
      accent: root.accent
      bordered: true
      focusable: true
      Accessible.name: tooltipText
      onClicked: root.beginAdding()
    }
  }
}
