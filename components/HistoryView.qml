import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "Protocol.js" as Protocol
import "internal" as OmaPilotInternal

Item {
  id: root

  property var history: []
  property color foreground: Color.popups.text
  property color background: Color.popups.background
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property bool motionEnabled: true
  property bool confirmingClear: false
  // The id of the chat whose delete is armed, "" for none. One at a time, and
  // never at the same time as the clear-all confirmation.
  property string confirmingDeleteId: ""
  readonly property bool modalInteractionActive: confirmingClear || confirmingDeleteId !== ""

  signal chatSelected(var chat)
  signal deleteRequested(string chatId)
  signal clearRequested()
  signal closeRequested()

  // Deleting one chat unlinks its record, its images and its Pi session, with
  // no undo — the same irreversibility that made "Clear all" ask twice. It
  // asked, and this did not, which is the worse half of an inconsistency: the
  // cheap action was guarded and the one sitting under the pointer, on a row
  // that arms itself on hover, was not.
  //
  // Same two-step as clear-all rather than a dialog, so both destructive
  // actions in this view are answered the same way and neither steals focus.
  function requestDelete(chatId) {
    if (root.confirmingDeleteId === chatId) {
      root.confirmingDeleteId = ""
      root.deleteRequested(chatId)
      return
    }
    root.confirmingClear = false
    root.confirmingDeleteId = chatId
  }

  function forceInitialFocus() {
    if (list.visible && list.count > 0) list.forceActiveFocus()
    else closeHistory.forceActiveFocus()
  }

  ColumnLayout {
    anchors.fill: parent
    spacing: Style.spacing.md

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md

      PanelActionButton {
        id: closeHistory
        iconText: "󰁍"
        tooltipText: "Back to conversation"
        foreground: root.foreground
        focusable: true
        Accessible.name: tooltipText
        onClicked: root.closeRequested()
      }

      Text {
        text: "History"
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        font.bold: true
        Accessible.role: Accessible.StaticText
        Accessible.name: "Recent chats"
      }

      Item { Layout.fillWidth: true }

      Text {
        id: clearHistory
        visible: root.history.length > 0
        text: root.confirmingClear ? "Clear all?" : "Clear"
        color: root.confirmingClear
          ? Color.urgent
          : (activeFocus || clearHover.hovered ? root.foreground : Qt.darker(root.foreground, 1.35))
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        font.underline: clearHover.hovered || root.confirmingClear || activeFocus
        activeFocusOnTab: visible
        Accessible.role: Accessible.Button
        Accessible.name: root.confirmingClear ? "Confirm clear all chats" : "Clear all chats"

        Behavior on color {
          enabled: root.motionEnabled
          ColorAnimation { duration: 120 }
        }

        HoverHandler {
          id: clearHover
          cursorShape: Qt.PointingHandCursor
        }

        TapHandler { onTapped: clearHistory.activate() }
        Keys.onReturnPressed: clearHistory.activate()
        Keys.onEnterPressed: clearHistory.activate()
        Keys.onSpacePressed: clearHistory.activate()

        function activate() {
          if (root.confirmingClear) {
            root.clearRequested()
            root.confirmingClear = false
          } else {
            root.confirmingDeleteId = ""
            root.confirmingClear = true
          }
        }
      }
    }

    ActivityFilament {
      Layout.fillWidth: true
      foreground: root.foreground
      accent: root.accent
      focused: list.activeFocus || closeHistory.activeFocus
      active: false
      motionEnabled: root.motionEnabled
    }

    Item {
      Layout.fillWidth: true
      Layout.fillHeight: true

      Text {
        visible: root.history.length === 0
        anchors.centerIn: parent
        width: parent.width - Style.spacing.xxl * 2
        text: "No saved chats yet.\nThe latest 30 completed answers appear here."
        color: Qt.darker(root.foreground, 1.55)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
      }

      ListView {
        id: list
        visible: root.history.length > 0
        anchors.fill: parent
        model: root.history
        spacing: 0
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        activeFocusOnTab: true
        currentIndex: count > 0 ? 0 : -1

        // An armed delete belongs to the row it is armed on. Leaving that row —
        // by arrow key, or by hovering another, which moves the cursor here too
        // — disarms it, so the confirmation can never outlive the sight of what
        // it would delete.
        onCurrentIndexChanged: root.confirmingDeleteId = ""

        Keys.onPressed: function(event) { historyKeyboard.handleKey(event) }

        OmaPilotInternal.HistoryListKeyboardHandler {
          id: historyKeyboard
          list: list
          history: root.history
          confirmingClear: root.confirmingClear
          confirmingDelete: root.confirmingDeleteId !== ""
          onChatSelected: function(chat) { root.chatSelected(chat) }
          // Routed through the same two-step the button uses, so Delete arms on
          // the first press and deletes on the second whichever way it came.
          onDeleteRequested: function(chatId) { root.requestDelete(chatId) }
          onCloseRequested: root.closeRequested()
          onConfirmationCancelled: {
            if (root.confirmingDeleteId !== "") {
              root.confirmingDeleteId = ""
              return
            }
            root.confirmingClear = false
            clearHistory.forceActiveFocus()
          }
        }

        delegate: Item {
          id: row
          required property var modelData
          required property int index
          width: list.width
          height: rowContent.implicitHeight + Style.spacing.lg * 2
          Accessible.role: Accessible.ListItem
          Accessible.name: String(modelData.title || "Chat")

          readonly property bool current: index === list.currentIndex
          readonly property bool hot: current || rowHover.hovered

          Rectangle {
            anchors.fill: parent
            color: Style.hoverFillFor(root.foreground, root.accent)
            opacity: row.hot ? 1 : 0
            Behavior on opacity {
              enabled: root.motionEnabled
              NumberAnimation { duration: 120 }
            }
          }

          Rectangle {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            width: 2
            height: Math.max(Style.space(18), parent.height * 0.42)
            radius: 1
            color: root.accent
            opacity: row.current ? 0.95 : 0
            Behavior on opacity {
              enabled: root.motionEnabled
              NumberAnimation { duration: 140 }
            }
          }

          HoverHandler {
            id: rowHover
            onHoveredChanged: if (hovered) list.currentIndex = index
          }
          TapHandler { onTapped: root.chatSelected(modelData) }

          RowLayout {
            id: rowContent
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Style.spacing.lg
            anchors.rightMargin: Style.spacing.xs
            spacing: Style.spacing.md

            ColumnLayout {
              Layout.fillWidth: true
              spacing: Style.spacing.xxs

              Text {
                Layout.fillWidth: true
                text: modelData.title
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
              }

              Text {
                Layout.fillWidth: true
                text: Protocol.providerLabel(modelData.provider)
                  + (modelData.model ? " · " + modelData.model : "")
                  + (modelData.timestamp ? " · " + modelData.timestamp : "")
                color: Qt.darker(root.foreground, 1.5)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }
            }

            PanelActionButton {
              readonly property bool confirming:
                root.confirmingDeleteId === String(row.modelData.id)

              Layout.alignment: Qt.AlignVCenter
              iconText: "󰆴"
              tooltipText: confirming ? "Delete chat?" : "Delete chat"
              // Armed, the button borrows the urgent role and puts a border
              // round itself. Colour alone would be the whole signal otherwise,
              // and colour alone is not a signal for everyone.
              foreground: confirming ? Color.urgent : root.foreground
              hoverColor: Color.urgent
              bordered: confirming
              // Opacity 0 still receives taps, so non-current rows would delete
              // from empty space on pointers that never hover. Disable the
              // control until the row is current, hovered, or this button is
              // focused. List Delete remains the keyboard path.
              enabled: row.hot || activeFocus || confirming
              focusable: enabled
              opacity: enabled ? 1 : 0
              Accessible.name: confirming ? "Confirm deleting this chat" : tooltipText
              onClicked: root.requestDelete(String(row.modelData.id))
              Behavior on opacity {
                enabled: root.motionEnabled
                NumberAnimation { duration: 120 }
              }
            }
          }
        }
      }
    }
  }
}
