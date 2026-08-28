import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "components" as OmaPilot

BarWidget {
  id: root
  moduleName: "io.github.spencerbull.omapilot"

  // Quattro does not currently expose free space for a bar section. Inline
  // composition is therefore opt-in-by-capability: a future host can expose
  // `availableInlineWidth` or `availableWidgetWidth`; today the safe path is
  // the icon plus anchored panel, which cannot compress the crowded clock and
  // status widgets.
  readonly property real hostInlineAllowance: {
    if (!bar) return 0
    if ("availableInlineWidth" in bar) return Number(bar.availableInlineWidth) || 0
    if ("availableWidgetWidth" in bar) return Number(bar.availableWidgetWidth) || 0
    return 0
  }
  readonly property bool canInline: !vertical && hostInlineAllowance >= Style.space(390)
  property bool inlineExpanded: false
  readonly property bool inlineActive: canInline && inlineExpanded
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: inlineActive ? inlineComposer.width : button.width

  function injectPanel() {
    var target = panelLoader.item
    if (target) {
      if ("bar" in target) target.bar = root.bar
      if ("settings" in target) target.settings = root.settings
      if ("anchorItem" in target) target.anchorItem = root.inlineActive ? inlineComposer : button
      if ("hostWidget" in target) target.hostWidget = root
    }
    // Configuring the store is not part of injecting the panel, and must not
    // depend on one being loaded. This widget owns the settings entry on both
    // surfaces, so with the console live and `panelLoader` inactive this is the
    // only path a console-side settings edit has back into the store. Behind
    // the item guard, those edits reached shell.json and stopped there — the
    // running store kept the old values until the next shell restart, and every
    // control bound to a `configured*` mirror snapped back after being changed.
    OmaPilot.OmaPilotStore.configure(root.settings)
  }

  function persist(values) {
    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) entry[key] = values[key]
    root.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function open() {
    inlineExpanded = false
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    inlineExpanded = false
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function openHistory() {
    if (panelLoader.item && panelLoader.item.openHistory) panelLoader.item.openHistory()
  }

  // A global route into settings. The in-panel key depends on the panel already
  // being open and focused, and the panel dismisses on focus loss, so a hotkey
  // that opens straight into settings is the reliable path.
  function openSettings() {
    if (!panelLoader.item) return
    // Use the same show path as the working open/history routes. openFromHotkey
    // additionally suppresses the bar's centre hover reveal, and that variant
    // does not survive being summoned while focus sits in another window.
    root.open()
    if (panelLoader.item.openSettings) panelLoader.item.openSettings()
  }

  function routedWidget() {
    if (bar && typeof bar.findPanelWidget === "function") {
      var target = bar.findPanelWidget(moduleName)
      if (target) return target
    }
    return root
  }

  function routeOpen() { routedWidget().open() }
  function routeClose() { routedWidget().close() }
  function routeToggle() { routedWidget().togglePanel() }
  function routeHistory() { routedWidget().openHistory() }
  function routeSettings() { routedWidget().openSettings() }

  function closeForPopoutSwitch() {
    inlineExpanded = false
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
    releaseBarPopout()
  }

  // The bar coordinates one popout at a time and underlines whichever module
  // holds the claim with a 2px accent rule. A KeyboardPanel hands the claim
  // back from its own close, which is enough for every first-party module
  // because none of them is ever destroyed while the shell runs.
  //
  // This one is. `panelLoader` unloads the whole panel tree the moment another
  // surface takes the routes, and the loader wins that race: the line above
  // finds `panelLoader.item` already null, so nothing closes and nothing
  // releases. `bar.activePopout` kept pointing at this widget — which is very
  // much alive — so the bar went on believing the panel was open and left the
  // mark underlined until some other module happened to open a popout of its
  // own. For anyone living in the console, never.
  //
  // Measured, and this is what decided where the release goes: a
  // `Component.onDestruction` inside Panel.qml does not run on this path. The
  // same teardown leaves delayed calls failing with "attempted to evaluate a
  // function in an invalid context", so the dying tree cannot be asked to give
  // anything back. This widget outlives it, so the release belongs here.
  //
  // Safe in the other caller too: `Bar.requestPopout` calls
  // `closeForPopoutSwitch` on the outgoing owner *before* assigning the new
  // one, so clearing the claim here is overwritten a line later.
  function releaseBarPopout() {
    if (bar && typeof bar.releasePopout === "function" && bar.activePopout === root)
      bar.releasePopout(root)
  }

  function restoreFocus() {
    if (root.inlineActive) inlineComposer.forceInputFocus()
    else button.forceActiveFocus()
  }

  function activate() {
    // With the console configured, the bar button becomes the console toggle,
    // routed over the store like the compositor hotkeys — the console lives in
    // the overlay tree and this widget cannot reach it directly.
    if (!root.surfaceRoutesHere) {
      OmaPilot.OmaPilotStore.ipcToggleRequested()
      return
    }
    if (root.opened) {
      root.close()
      return
    }
    OmaPilot.OmaPilotStore.latchDesktopContext()
    if (root.canInline) {
      root.inlineExpanded = true
      Qt.callLater(function() { inlineComposer.forceInputFocus() })
    } else root.open()
  }

  implicitWidth: inlineActive ? inlineComposer.implicitWidth : button.implicitWidth
  implicitHeight: inlineActive ? inlineComposer.implicitHeight : button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()
  onInlineActiveChanged: injectPanel()
  onCanInlineChanged: if (!canInline) inlineExpanded = false

  // When the configured surface is the console these routes belong to
  // Ambient.qml, which connects the same signals with the inverse guard.
  readonly property bool surfaceRoutesHere:
    OmaPilot.OmaPilotStore.configuredSurface === "panel"

  // The other half of the surface handoff, and unguarded on purpose: it has to
  // run both when the panel stops being the routed surface and when it becomes
  // one, and the block below is disabled in the first of those.
  Connections {
    target: OmaPilot.OmaPilotStore
    function onConfiguredSurfaceChanged() {
      if (!root.surfaceRoutesHere) {
        root.closeForPopoutSwitch()
        return
      }
      // Asking for this surface is asking to see it. The intent is carried on
      // the store rather than read from "was the old one open", because by now
      // the popout has dismissed itself and the answer would always be no.
      if (OmaPilot.OmaPilotStore.takeSurfaceHandoff())
        Qt.callLater(function() { if (root.routedWidget() === root) root.open() })
    }
  }

  // One guard for the whole route block, so the next route added here cannot
  // forget it and fire on both surfaces.
  Connections {
    target: OmaPilot.OmaPilotStore
    enabled: root.surfaceRoutesHere
    function onIpcOpenRequested() {
      if (root.routedWidget() === root) root.open()
    }
    function onIpcCloseRequested() {
      if (root.routedWidget() === root) root.close()
    }
    function onIpcToggleRequested() {
      if (root.routedWidget() === root) root.togglePanel()
    }
    function onIpcHistoryRequested() {
      if (root.routedWidget() === root) root.openHistory()
    }
    function onIpcSettingsRequested() {
      if (root.routedWidget() === root) root.openSettings()
    }
    function onContextAttachmentAdded() {
      if (root.routedWidget() === root) root.open()
    }
    // The store has already latched the source window and started the read by
    // the time this arrives; the panel only has to show itself.
    function onIpcSelectionRequested() {
      if (root.routedWidget() === root) root.open()
    }
  }

  Connections {
    target: OmaPilot.OmaPilotStore
    function onSettingsPersistRequested(values) {
      // Deliberately not surface-guarded: the console has no settings
      // injection of its own, so its settings edits persist through the bar
      // widget precisely while this widget owns the settings entry.
      if (root.routedWidget() === root) root.persist(values)
    }
  }

  Loader {
    id: panelLoader
    // A console user should not pay for a per-widget Panel tree that can
    // never open; settings persistence flows through root.persist, not the
    // loaded item, so nothing else needs it alive.
    active: root.surfaceRoutesHere
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    visible: !root.inlineActive
    bar: root.bar
    text: ""
    iconComponent: Component {
      OmaPilot.OmaPilotMark {
        anchors.fill: parent
        size: Math.min(width, height)
        accent: button.active && button.useActiveColor
          ? button.activeColor : button.foreground
        active: OmaPilot.OmaPilotStore.busy
      }
    }
    active: root.opened || OmaPilot.OmaPilotStore.busy
    tooltipText: OmaPilot.OmaPilotStore.busy ? "OmaPilot is working" : "OmaPilot"
    Accessible.name: tooltipText

    onPressed: function(b) {
      if (b === Qt.RightButton) {
        root.inlineExpanded = false
        if (!root.surfaceRoutesHere) OmaPilot.OmaPilotStore.ipcHistoryRequested()
        else if (panelLoader.item) panelLoader.item.openHistory()
      } else root.activate()
    }
  }

  OmaPilot.Composer {
    id: inlineComposer
    anchors.fill: parent
    visible: root.inlineActive
    inlineMode: true
    backend: OmaPilot.OmaPilotStore
    foreground: root.bar ? root.bar.foreground : Color.bar.text
    background: Color.bar.background
    fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
    onProviderChanged: function(provider) { root.persist({ provider: provider }) }
    onModelChanged: function(provider, model) {
      var key = provider + "Model"
      var value = {}; value[key] = model; root.persist(value)
    }
    onSubmitted: {
      root.inlineExpanded = false
      root.open()
    }
    onEscapeRequested: {
      root.inlineExpanded = false
      OmaPilot.OmaPilotStore.clearDesktopContextLatch()
      button.forceActiveFocus()
    }
  }
}
