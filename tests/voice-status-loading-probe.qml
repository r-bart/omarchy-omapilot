import QtQuick
import QtQuick.Window
import Quickshell
import "components" as OmaPilot

ShellRoot {
  id: root
  property bool failed: false

  function fail(message) {
    failed = true
    console.error("omapilot voice status probe failed: " + message)
  }

  function statusEvent(source, available) {
    return {
      type: "voice",
      source: source,
      dictation: { available: false, message: "" },
      tts: [{
        id: "elevenlabs", name: "ElevenLabs", kind: "cloud",
        available: available, configured: available, message: "",
        models: [], voices: []
      }]
    }
  }

  Window {
    width: 900
    height: 900
    visible: true

    OmaPilot.SettingsView {
      id: view
      anchors.fill: parent
      backend: OmaPilot.OmaPilotStore
      selectedTab: "voice"
      ttsProvider: "elevenlabs"
    }
  }

  Component.onCompleted: OmaPilot.OmaPilotStore.beginVoiceStatus()

  Timer {
    interval: 300
    running: true
    repeat: false
    onTriggered: {
      if (OmaPilot.OmaPilotStore.voiceStatusLoading)
        root.fail("the delayed footer appeared before its grace period")
    }
  }

  Timer {
    interval: 750
    running: true
    repeat: false
    onTriggered: {
      if (!OmaPilot.OmaPilotStore.voiceStatusLoading)
        root.fail("the delayed footer did not appear for a slow probe")

      OmaPilot.OmaPilotStore.applyEvent({
        type: "tts_test_failed", provider: "elevenlabs", message: "Rejected"
      })
      if (!OmaPilot.OmaPilotStore.voiceStatusLoading)
        root.fail("an unrelated key-test failure hid the pending footer")

      OmaPilot.OmaPilotStore.applyEvent(root.statusEvent("status", false))
      if (OmaPilot.OmaPilotStore.voiceStatusLoading)
        root.fail("a terminal voice status did not hide the footer")

      OmaPilot.OmaPilotStore.ttsTestError = ""
      view.ttsKeyBusy = true
      view.ttsKeyAction = "save"
      view.ttsDraftKey = "keep-this-draft"
      OmaPilot.OmaPilotStore.applyEvent(root.statusEvent("status", false))
      if (!view.ttsKeyBusy || view.ttsDraftKey !== "keep-this-draft"
          || view.ttsFormNotice !== "")
        root.fail("an unrelated voice status falsely acknowledged the key save")

      OmaPilot.OmaPilotStore.applyEvent(root.statusEvent("key_set", true))
      if (view.ttsKeyBusy || view.ttsKeyAction !== "" || view.ttsDraftKey !== ""
          || view.ttsFormNotice !== "API key saved.")
        root.fail("the matching key-save status did not complete the form")

      if (!root.failed) console.log("OMAPILOT_VOICE_STATUS_PROBE_OK")
      Qt.quit()
    }
  }
}
