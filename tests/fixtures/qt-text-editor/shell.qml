import Quickshell
import QtQuick
import QtQuick.Controls

ShellRoot {
  FloatingWindow {
    visible: true
    title: "OmaPilot Qt text action lab"
    implicitWidth: 560
    implicitHeight: 240

    TextArea {
      anchors.fill: parent
      padding: 24
      wrapMode: TextEdit.Wrap
      text: "teh cat sat on teh mat"
      Component.onCompleted: forceActiveFocus()
      onTextChanged: console.log("OMAPILOT_QT_VALUE:" + JSON.stringify(text))
    }
  }
}
