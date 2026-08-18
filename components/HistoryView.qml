import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Protocol.js" as Protocol
import "internal" as QuickchatInternal

Item {
  id: root

  property var history: []
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property bool confirmingClear: false
  readonly property bool modalInteractionActive: confirmingClear

  signal chatSelected(var chat)
  signal deleteRequested(string chatId)
  signal clearRequested()
  signal closeRequested()

  function forceInitialFocus() {
    if (list.visible && list.count > 0) list.forceActiveFocus()
    else closeHistory.forceActiveFocus()
  }

  ColumnLayout {
    anchors.fill: parent
    spacing: Style.spacing.lg

    RowLayout {
      Layout.fillWidth: true

      Text {
        Layout.fillWidth: true
        text: "Recent chats"
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.heading
        font.bold: true
      }

      Button {
        id: clearHistory
        text: root.confirmingClear ? "Confirm clear" : "Clear all"
        visible: root.history.length > 0
        foreground: root.confirmingClear ? Color.urgent : root.foreground
        background: root.background
        bordered: true
        focusable: true
        onClicked: {
          if (root.confirmingClear) {
            root.clearRequested()
            root.confirmingClear = false
          } else root.confirmingClear = true
        }
      }

      PanelActionButton {
        id: closeHistory
        iconText: "󰁍"
        tooltipText: "Back to conversation"
        foreground: root.foreground
        focusable: true
        Accessible.name: tooltipText
        onClicked: root.closeRequested()
      }
    }

    Item {
      Layout.fillWidth: true
      Layout.fillHeight: true

      Text {
        visible: root.history.length === 0
        anchors.centerIn: parent
        width: parent.width - Style.spacing.xxl * 2
        text: "No saved chats yet\nYour latest 30 completed answers appear here."
        color: Qt.darker(root.foreground, 1.45)
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
      }

      ListView {
        id: list
        visible: root.history.length > 0
        anchors.fill: parent
        model: root.history
        spacing: Style.spacing.sm
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        activeFocusOnTab: true
        currentIndex: count > 0 ? 0 : -1

        Keys.onPressed: function(event) { historyKeyboard.handleKey(event) }

        QuickchatInternal.HistoryListKeyboardHandler {
          id: historyKeyboard
          list: list
          history: root.history
          confirmingClear: root.confirmingClear
          onChatSelected: function(chat) { root.chatSelected(chat) }
          onDeleteRequested: function(chatId) { root.deleteRequested(chatId) }
          onCloseRequested: root.closeRequested()
          onConfirmationCancelled: {
            root.confirmingClear = false
            clearHistory.forceActiveFocus()
          }
        }

        delegate: BorderSurface {
          id: row
          required property var modelData
          required property int index
          width: list.width
          height: Style.space(62)
          color: index === list.currentIndex || rowHover.hovered
            ? Style.hoverFillFor(root.foreground, root.accent)
            : Style.normalFillFor(root.foreground, root.accent)
          borderSpec: Border.controlSpec(index === list.currentIndex ? "hover-cursor" : "normal", root.foreground, root.accent)
          radius: Style.cornerRadius

          HoverHandler { id: rowHover; onHoveredChanged: if (hovered) list.currentIndex = index }
          TapHandler { onTapped: root.chatSelected(modelData) }

          RowLayout {
            anchors.fill: parent
            anchors.leftMargin: row.contentLeftInset + Style.spacing.lg
            anchors.rightMargin: row.contentRightInset + Style.spacing.sm
            anchors.topMargin: row.contentTopInset + Style.spacing.md
            anchors.bottomMargin: row.contentBottomInset + Style.spacing.md
            spacing: Style.spacing.lg

            ColumnLayout {
              Layout.fillWidth: true
              spacing: Style.spacing.xxs

              Text {
                Layout.fillWidth: true
                text: modelData.title
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                elide: Text.ElideRight
              }

              Text {
                Layout.fillWidth: true
                text: Protocol.providerLabel(modelData.provider)
                  + (modelData.model ? " · " + modelData.model : "")
                  + (modelData.timestamp ? " · " + modelData.timestamp : "")
                color: Qt.darker(root.foreground, 1.45)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }
            }

            PanelActionButton {
              Layout.alignment: Qt.AlignVCenter
              iconText: "󰆴"
              tooltipText: "Delete chat"
              foreground: root.foreground
              hoverColor: Color.urgent
              focusable: true
              Accessible.name: tooltipText
              onClicked: root.deleteRequested(String(modelData.id))
            }
          }
        }
      }
    }
  }
}
