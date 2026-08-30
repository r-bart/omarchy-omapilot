#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
omarchy_shell="${OMARCHY_PATH:-/usr/share/omarchy}/shell"
smoke_root=""
preview_root=""

# A standalone `! grep` is exempt from Bash's errexit semantics, so it does
# not enforce a negative contract under `set -e`. Every absence assertion goes
# through a real conditional that returns failure for forbidden text.
absent() {
  if grep "$@"; then
    return 1
  fi
}

cleanup() {
  if [[ -n $smoke_root && -d $smoke_root ]]; then rm -rf -- "$smoke_root"; fi
  if [[ -n $preview_root && -d $preview_root ]]; then rm -rf -- "$preview_root"; fi
}
trap cleanup EXIT

qml_files=(
  "$repo_dir/BarWidget.qml"
  "$repo_dir/ContextCaptureOverlay.qml"
  "$repo_dir/Panel.qml"
  "$repo_dir/components/Composer.qml"
  "$repo_dir/components/Console.qml"
  "$repo_dir/components/ConsoleContent.qml"
  "$repo_dir/components/ConsolePlacement.qml"
  "$repo_dir/components/ConsoleTurn.qml"
  "$repo_dir/components/ContextAttachmentPreview.qml"
  "$repo_dir/components/CopyButton.qml"
  "$repo_dir/components/ErrorDetailsView.qml"
  "$repo_dir/components/ErrorNotice.qml"
  "$repo_dir/components/HistoryView.qml"
  "$repo_dir/components/MarkdownView.qml"
  "$repo_dir/components/OmaPilotHeader.qml"
  "$repo_dir/components/OmaPilotMark.qml"
  "$repo_dir/components/QuickActions.qml"
  "$repo_dir/components/QuickActionEditor.qml"
  "$repo_dir/components/SettingsView.qml"
  "$repo_dir/components/SettingsTabs.qml"
  "$repo_dir/components/SetupGuide.qml"
  "$repo_dir/components/StateLightBar.qml"
  "$repo_dir/components/TextActionChooser.qml"
  "$repo_dir/components/ThinkingScanner.qml"
  "$repo_dir/components/VoiceNode.qml"
  "$repo_dir/components/VoiceWave.qml"
  "$repo_dir/components/ActivityFilament.qml"
  "$repo_dir/components/ResponseActivityBorder.qml"
  "$repo_dir/components/internal/PermissionFocusGuard.qml"
  "$repo_dir/components/internal/PanelKeyboardNavigation.qml"
  "$repo_dir/components/internal/HistoryListKeyboardHandler.qml"
  "$repo_dir/components/OmaPilotStore.qml"
  "$repo_dir/components/DesktopContext.qml"
  "$repo_dir/components/Protocol.js"
  "$repo_dir/components/Placement.js"
  "$repo_dir/components/Presentation.js"
  "$repo_dir/components/QuickActions.js"
  "$repo_dir/tests/composer-growth-probe.qml"
  "$repo_dir/tests/motion-preview.qml"
  "$repo_dir/tests/state-motion-preview.qml"
  "$repo_dir/tests/voice-node-preview.qml"
)

/usr/lib/qt6/bin/qmllint -I "$omarchy_shell" -I "$repo_dir" "${qml_files[@]}" >/dev/null 2>&1

grep -Fq 'Qt.resolvedUrl("../runtime/bin/omapilot-broker")' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Quickshell.env("OMAPILOT_BROKER_PATH") || bundledBrokerPath' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Qt.resolvedUrl("../scripts/install-hotkeys.sh")' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'command: [root.hotkeyInstallerPath, "--installed-plugin-only"]' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'running: false' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'function installHotkeys()' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'onHotkeyInstallRequested: OmaPilot.OmaPilotStore.installHotkeys()' \
  "$repo_dir/Panel.qml"
grep -Fq 'text: root.hotkeyBusy ? "Updating hotkeys…" : "Install global hotkeys"' \
  "$repo_dir/components/SettingsView.qml"
grep -Fq 'OmaPilot.SetupGuide {' "$repo_dir/Panel.qml"
grep -Fq 'function setupStage(providerReady, voiceEnabled, ttsReady, onboardingComplete)' \
  "$repo_dir/components/Presentation.js"
grep -Fq 'onActionRequested: root.openSettings(root.setupStage === "voice" ? "voice" : "desktop")' \
  "$repo_dir/Panel.qml"
grep -Fq 'function onHotkeyInstalled()' "$repo_dir/Panel.qml"
grep -Fq 'if (root.voiceSetupReady) root.persistSettings({ onboardingComplete: true })' \
  "$repo_dir/Panel.qml"
grep -Fq 'signal hotkeyInstalled()' "$repo_dir/components/OmaPilotStore.qml"
if grep -Fq 'command: [root.hotkeyInstallerPath, "--once"' \
  "$repo_dir/components/OmaPilotStore.qml"; then
  printf 'Hotkey installation must require an explicit settings action\n' >&2
  exit 1
fi

# The console is a real window, not a layer-shell surface. This is not a style
# preference: it was measured. A probe of two pure OnDemand surfaces, one on
# Overlay and one on Top, trapped the keyboard in both — on Hyprland 0.56.2 a
# layer-shell surface does not hand focus back whatever its interactivity, and
# an open console could strand the session. Going back is going back to that.
grep -Fq 'FloatingWindow {' "$repo_dir/components/Console.qml"
# Anchored so the comments above may still name what this file stopped being;
# the import is the real gate, since WlrLayershell cannot be used without it.
absent -qE '^import Quickshell\.Wayland' "$repo_dir/components/Console.qml"
absent -qE '^[[:space:]]*PanelWindow[[:space:]]*\{' "$repo_dir/components/Console.qml"
absent -qE '^[[:space:]]*WlrLayershell\.' "$repo_dir/components/Console.qml"
# Quickshell sets app_id per process, so every toplevel of the shell arrives as
# org.quickshell and the title is the only stable identifier — Omarchy singles
# out its own dev gallery the same way. One source of truth for it, because the
# placement lookup matches on it: a title that drifts is a console that cannot
# be found, and therefore cannot be focused or placed.
grep -Fq 'readonly property string windowTitle: "OmaPilot"' \
  "$repo_dir/components/Console.qml"
grep -Fq 'title: root.windowTitle' "$repo_dir/components/Console.qml"
# Focus is derived and includes `visible`, never stored. Measured: after the
# compositor closes the window Qt never emits active=false, so a stored flag
# keeps a stale true and the next open never corrects it — it was already true.
grep -Fq 'readonly property bool windowActive: Window.active' \
  "$repo_dir/components/Console.qml"
grep -Fq 'readonly property bool focused: surface.visible && shellItem.windowActive' \
  "$repo_dir/components/Console.qml"
# Closing from the compositor is closing, not hiding. The desktop-context latch
# freezes the active window and workspace from the moment the console opened;
# held past a close, it attaches a desktop that no longer exists to the next
# question.
grep -Fq 'onClosed: root.close()' "$repo_dir/components/Console.qml"

# Three states, not two: a window can be visible without holding the keyboard.
# Pressed over a console the user can already see but is not typing into, the
# bar icon means "take me there" — hiding what someone just asked for is the
# surprise this project has already paid for twice.
grep -Fq 'function toggle() {' "$repo_dir/components/Console.qml"
# takeFocus, not focus: QQuickItem has a final `focus` property, and shadowing
# it with a method is a warning today and a silent misbinding tomorrow.
grep -Fq 'else if (!root.focused) takeFocus()' "$repo_dir/components/Console.qml"
# No fold-to-a-handle state: it would spend a column of the surface on a gesture
# the bar icon already performs, from a control the user has to discover.
absent -q 'collapsed' "$repo_dir/components/Console.qml"
# All compositor coupling lives in one place. Console.qml is about a window;
# ConsolePlacement is about Hyprland. Keeping the import out is what keeps that
# true, and what makes the no-Hyprland path a single check instead of a habit.
absent -qE '^import Quickshell\.Hyprland' "$repo_dir/components/Console.qml"
grep -Fq 'singleton ConsolePlacement 1.0 ConsolePlacement.qml' "$repo_dir/components/qmldir"
grep -Fq 'readonly property bool available' "$repo_dir/components/ConsolePlacement.qml"
# The toplevel model is populated lazily and starts empty, so a lookup that runs
# before the first refresh finds nothing and says nothing about why.
grep -Fq 'Hyprland.refreshToplevels()' "$repo_dir/components/ConsolePlacement.qml"
# Focusing has a floor, and the floor is checked rather than assumed. Measured:
# activating our own toplevel moved focus three times out of three one night and
# was silently ignored the next morning, unchanged probe, unchanged compositor.
# The request's return value says only that it went out, so the console looks at
# whether the keyboard actually arrived and remaps if it did not — a window
# hidden and shown again comes back focused, every time it has been tried.
grep -Fq 'ConsolePlacement.activate(root.windowTitle)' "$repo_dir/components/Console.qml"
grep -Fq 'if (!root.opened || root.focused) return' "$repo_dir/components/Console.qml"
absent -Fq 'if (ConsolePlacement.activate(' "$repo_dir/components/Console.qml"
# To the compositor a remap is a brand-new window: it comes back tiled at a
# default size. Measured. The shape is carried across rather than recomputed,
# because recomputing overwrites a drag that until the next of the three
# moments belongs to the user.
grep -Fq 'root.pendingShape = ConsolePlacement.snapshot(root.windowTitle)' \
  "$repo_dir/components/Console.qml"
grep -Fq 'function snapshot(' "$repo_dir/components/ConsolePlacement.qml"
# A remap hides the window and means the opposite of a close, so the lane reset
# hangs off the close itself. Measured: closing mid-remap skipped it entirely
# and the console reopened in whatever lane it had been left in.
grep -Fq 'onTriggered: if (!root.opened) content.reset()' \
  "$repo_dir/components/Console.qml"
absent -Fq 'onVisibleChanged: if (!visible' "$repo_dir/components/Console.qml"

# The dispatch acts on the active window, so it may only run once the active
# window is known to be ours. Placing someone else's window is worse than
# leaving ours where the compositor put it.
grep -Fq 'function place(' "$repo_dir/components/ConsolePlacement.qml"
grep -Fq 'Hyprland.activeToplevel' "$repo_dir/components/ConsolePlacement.qml"
# Measured, at the cost of a whole round of tests: in this Hyprland a dispatch
# in the classic syntax does not fail, it does nothing. Nothing checks a return
# value because there is none — dispatch() is void and the socket's `ok` means
# "accepted", not "had an effect" — so the compositor is asked which language
# it speaks instead of one of the two being guessed at.
grep -Fq 'Hyprland.usingLua' "$repo_dir/components/ConsolePlacement.qml"
# float and pin are toggles. Sending them without reading the current state is
# how a second placement undoes the first.
grep -Fq 'if (state.floating !== shape.floating)' "$repo_dir/components/ConsolePlacement.qml"
# Placed at three moments and no others, so a window the user dragged stays
# where they put it until the next of the three.
grep -Fq 'if (!pendingShape) applyPlacement()' "$repo_dir/components/Console.qml"
grep -Fq 'onSurfaceWidthChanged: applyPlacement()' "$repo_dir/components/Console.qml"
grep -Fq 'onReservesSpaceChanged: applyPlacement()' "$repo_dir/components/Console.qml"
# Holding the column open is now "do not float": tiled, the compositor puts the
# user's windows beside the console instead of behind it. Same promise the
# exclusive zone made, same cost, kept the way a window can keep it.
grep -Fq '!root.reservesSpace, root.fullscreen)' "$repo_dir/components/Console.qml"
# Placing means focusing first, because a dispatch acts on the active window.
# So a placement that would have to take the keyboard waits until the console
# has it: a setting changed from elsewhere must not yank the user out of what
# they were doing.
grep -Fq 'if (!pendingShape || !engaged || !focused) return' \
  "$repo_dir/components/Console.qml"
grep -Fq 'onFocusedChanged: if (focused) flushShape()' "$repo_dir/components/Console.qml"
absent -Fq 'root.activate(root.pendingTitle)' "$repo_dir/components/ConsolePlacement.qml"
# A dispatch reports nothing, so the only way to know is to look afterwards.
# One retry, then say so: a console silently the wrong shape is the hardest
# kind of bug to be told about.
grep -Fq 'function checkPlacement(' "$repo_dir/components/ConsolePlacement.qml"
grep -Fq 'console.warn(' "$repo_dir/components/ConsolePlacement.qml"
# The column is measured against the bar's reserved strip, so a stale monitor
# is a stale strip.
grep -Fq 'Hyprland.refreshMonitors()' "$repo_dir/components/ConsolePlacement.qml"
# The three delays are related and named where the relation is written down.
grep -Fq 'interval: ConsolePlacement.focusGraceDelay' "$repo_dir/components/Console.qml"
grep -Fq 'interval: ConsolePlacement.remapDelay' "$repo_dir/components/Console.qml"
grep -Fq '"consoleReservesSpace": false' "$repo_dir/manifest.json"

# Maximized, never fullscreen. Real fullscreen covers the bar, and the bar holds
# the icon that dismisses the console: a state that hides its own exit.
grep -Fq 'maximized: root.fullscreen' "$repo_dir/components/Console.qml"
absent -qE '^[[:space:]]*fullscreen:[[:space:]]*(true|root\.fullscreen)' \
  "$repo_dir/components/Console.qml"
# Measured live: Hyprland ignores a client's own xdg maximize request, so the
# window property alone leaves the console exactly where it was. It stays as the
# portable half, and the compositor is asked for the state that stops at the
# usable area — 1, maximized, not 2, which would cover the bar.
grep -Fq 'window.fullscreen_state({ internal = 1, client = 1 })' \
  "$repo_dir/components/ConsolePlacement.qml"
absent -Fq 'internal = 2' "$repo_dir/components/ConsolePlacement.qml"
# Leaving maximized hands the window back to the compositor, not to us, so the
# column has to be asked for again.
# Changing surface is the request itself, so it may take the keyboard — over
# IPC it arrives with the console unfocused, and deferring it means pressing a
# hotkey and watching nothing happen. A width or tiling change is a consequence
# of something done elsewhere and still waits.
grep -Fq 'if (engaged && !focused) takeFocus()' "$repo_dir/components/Console.qml"
# The stored value keeps its name: it is the word the user sees and the one the
# surface cycle advances through. The implementation changes, not the vocabulary.
grep -Fq 'fullscreen: OmaPilot.OmaPilotStore.configuredSurface === "fullscreen"' \
  "$repo_dir/Ambient.qml"

# The ladder has no focus rung and no host that could use one. Releasing the
# keyboard was something only a layer-shell surface could do; both hosts are
# ordinary windows now, and no protocol lets a window unfocus itself. Leaving
# the rung in place would be a branch no caller can reach and a test asserting
# behaviour that cannot happen.
absent -q 'releasesFocus' "$repo_dir/components/ConsoleContent.qml" \
  "$repo_dir/components/Console.qml"
absent -q 'releaseFocusRequested' "$repo_dir/components/ConsoleContent.qml"
absent -q 'release-focus' "$repo_dir/components/Presentation.js" \
  "$repo_dir/components/ConsoleContent.qml"
grep -Fq 'previewOpen, busy) {' "$repo_dir/components/Presentation.js"
# The content still does not know what window hosts it. That is what lets all 24
# of its states render offscreen in the preview harness, and it is the reason the
# migration touches one file instead of eight hundred lines.
absent -qE '^import Quickshell\.(Wayland|Hyprland)' "$repo_dir/components/ConsoleContent.qml"
# The surface switch lives with the composer, the one piece all three surfaces
# share, so it is reachable to enter a surface and not only to leave one.
grep -Fq 'onClicked: {' "$repo_dir/components/Composer.qml"
# All three surfaces are offered at once. A single cycling button showed the
# icon of the *next* surface, so the one the user wanted was one click away or
# two and never named — reaching the bar panel from the console meant passing
# through fullscreen to find out where it was.
grep -Fq 'Presentation.surfaceIcon(surfaceName)' "$repo_dir/components/Composer.qml"
grep -Fq 'root.backend.selectSurface(surfaceName)' "$repo_dir/components/Composer.qml"
absent -Fq 'cycleSurface()' "$repo_dir/components/Composer.qml"
# The switch lives in each surface's own chrome: the console has a header with
# room beside the gear, the bar panel has no header at all. That asymmetry is
# the reason the switch left the header in the first place, so the composer copy
# stays and the console turns it off rather than the header being the only home.
grep -Fq 'showSurfaceSwitch: false' "$repo_dir/components/ConsoleContent.qml"
grep -Fq 'model: root.showSurfaceSwitch ? Protocol.surfaceOrder() : []' \
  "$repo_dir/components/Composer.qml"
grep -Fq 'model: Protocol.surfaceOrder()' "$repo_dir/components/OmaPilotHeader.qml"
grep -Fq 'signal surfaceRequested(string name)' "$repo_dir/components/OmaPilotHeader.qml"
grep -Fq 'root.backend.selectSurface(name)' "$repo_dir/components/ConsoleContent.qml"
# The reading measure. The shell font is monospace, so the column holds
# width / (0.6 * Style.font.body) characters, and cap and font scale together:
# 560 is 78 characters at any base-size, against 128 for the 920 it replaced.
# `tightMeta` compares against the cap rather than repeating it, because the
# two being equal is what keeps the header on one row at fullscreen.
grep -Fq 'readonly property int maxContentWidth: Style.space(560)' \
  "$repo_dir/components/ConsoleContent.qml"
grep -Fq 'readonly property bool tightMeta: contentWidth < maxContentWidth' \
  "$repo_dir/components/ConsoleContent.qml"
# One control in two places, so it is marked the same way in both.
grep -Fq 'current ? root.accent' "$repo_dir/components/Composer.qml"
grep -Fq 'current ? root.accent' "$repo_dir/components/OmaPilotHeader.qml"
# Every control in the header sits in one cluster against the right edge;
# spread across the row they read as decoration between the title and the gear.
# An explicit spacer, because a nested layout only stretches when one of its own
# children does: the title column stopped taking the slack the moment the
# tagline went hidden, and the cluster bunched up against the title.
grep -Fq 'Item { Layout.fillWidth: true }' "$repo_dir/components/OmaPilotHeader.qml"
# History gets a button beside the gear. It is the other lane you enter and
# leave, and it had only a keyboard hint and a line of small print.
grep -Fq 'signal historyRequested()' "$repo_dir/components/OmaPilotHeader.qml"
grep -Fq 'onHistoryRequested:' "$repo_dir/components/ConsoleContent.qml"
# Starting over belongs with the other two, not among the actions of one turn:
# "New chat" ends the whole conversation, and it sat in the answer plate beside
# copy and retry, which are things you do to a single answer.
grep -Fq 'signal newChatRequested()' "$repo_dir/components/OmaPilotHeader.qml"
# Starting a new conversation is also going to it: clearing the chat from
# history or settings used to leave the user in the lane they were reading,
# with the new chat behind them and the caret nowhere.
grep -Fq 'onNewChatRequested: root.startNewChat()' "$repo_dir/components/ConsoleContent.qml"
grep -Fq 'function startNewChat()' "$repo_dir/components/ConsoleContent.qml"
absent -Fq 'text: "New chat"' "$repo_dir/components/ConsoleContent.qml"
# Harness and model are a choice, not a label, so they are pickers in the footer
# rather than static text in the header. Naming them in both places would be the
# same identity said twice, which is what the header line was already doing.
# Under the title, not in the footer, and that is not taste: Omarchy's Dropdown
# only opens downwards and clips to its window, so a picker in the last 250px of
# the console shows a list with its bottom cut off.
grep -Fq 'options: Protocol.harnessOptions()' "$repo_dir/components/OmaPilotHeader.qml"
grep -Fq 'Accessible.name: "AI model"' "$repo_dir/components/OmaPilotHeader.qml"
grep -Fq 'onHarnessChanged:' "$repo_dir/components/ConsoleContent.qml"
grep -Fq 'onModelPicked:' "$repo_dir/components/ConsoleContent.qml"
# A window's border is drawn outside the box hyprctl reports, so a column flush
# against the bar's reserved strip has its top border underneath the bar. The
# same inset every tiled window gets is what stops that, and it lines the
# console up with the rest of the screen.
grep -Fq 'readonly property int edgeInset: outerGap + borderSize' \
  "$repo_dir/components/ConsolePlacement.qml"
absent -Fq 'providerLabel' "$repo_dir/components/OmaPilotHeader.qml"
# The model appears only as the selected value of the editable picker above;
# providerLabel remains forbidden because static identity text would duplicate
# that control.
# The harness label does not carry the product name. Every place it is shown
# already says OmaPilot; what the row chooses between is built-in, Codex and
# OpenCode.
grep -Fq 'if (provider === "builtin") return "Built-in"' \
  "$repo_dir/components/Protocol.js"
absent -q 'surfaceCycle' "$repo_dir/components/OmaPilotHeader.qml"
# The console shows the conversation, not one turn of it. That is what a column
# ten times the height of the bar panel is for; before this it showed exactly
# what the panel showed. Every turn is its own record, so the thread is the run
# of them sharing an acpId — grouping by adjacency would invent a conversation
# the broker cannot reconstruct.
grep -Fq 'function threadBefore(history, chatId)' "$repo_dir/components/Protocol.js"
grep -Fq 'acpId: String((row.session && row.session.acpId) || row.acpId || "")' \
  "$repo_dir/components/Protocol.js"
grep -Fq 'Protocol.threadBefore(root.backend.history, root.backend.currentChatId)' \
  "$repo_dir/components/ConsoleContent.qml"
grep -Fq 'ConsoleTurn 1.0 ConsoleTurn.qml' "$repo_dir/components/qmldir"
# The live turn is painted above by the same shapes and is not repeated in the
# thread: it lands in history the moment it completes, and showing it twice
# would make finishing a turn look like it happened again.
grep -Fq 'if (String(source[j].acpId || "") === key) thread.push(source[j])' \
  "$repo_dir/components/Protocol.js"
# A finished turn can be read and copied; retrying, cancelling and the Herdr
# handoff belong to the one that is still running.
absent -q 'onRetryRequested\|backend.cancel()\|continueInHerdr' \
  "$repo_dir/components/ConsoleTurn.qml"
# Every answer wears the same plate, live or finished, and the two must not
# drift into two sets of numbers — a reader should not be able to tell which
# answer is which by its shape. Same tint, same radius, same border, same
# padding, asserted in both files rather than trusted to stay in step.
for literal in \
  'radius: Style.space(10)' \
  'color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.035)' \
  'border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)' \
  'implicitHeight: plateColumn.implicitHeight + Style.space(30)' \
  'anchors.topMargin: Style.space(15)'; do
  grep -Fq "$literal" "$repo_dir/components/ConsoleContent.qml"
  grep -Fq "$literal" "$repo_dir/components/ConsoleTurn.qml"
done
# The armed delete tells you the way out. Colour and a border say the state
# changed; neither says what to do about it, and this control has no visible
# label to turn into a question the way "Clear all" does.
grep -Fq 'confirming ? "Click again to delete" : "Delete chat"' \
  "$repo_dir/components/HistoryView.qml"
# Provenance per turn, not per conversation: a thread can change harness or
# model partway through and the record carries what answered each turn.
grep -Fq 'Protocol.providerShortLabel(provider)' "$repo_dir/components/ConsoleTurn.qml"
# The panel and the curtain stay single-turn. They are the glance surfaces; the
# console is the deliberate one, and that distinction is design/ambient-ux.md.
absent -q 'threadBefore' "$repo_dir/Panel.qml" "$repo_dir/components/AnswerCurtain.qml"

# The content column stops growing past a readable measure and centres instead.
# min() keeps every docked width inert, so the docked render is unchanged.
grep -Fq 'readonly property int contentWidth: Math.min(' \
  "$repo_dir/components/ConsoleContent.qml"
grep -Fq 'anchors.horizontalCenter: parent.horizontalCenter' \
  "$repo_dir/components/ConsoleContent.qml"
# The ladder keeps its terminal name: "close-panel" names the final step, not a
# surface, and each host maps it to its own close.
grep -Fq 'return "close-panel"' "$repo_dir/components/Presentation.js"
# A pending approval pins the console: Escape answers it, never dismisses it.
grep -Fq 'backend.respondPermission("reject_once", backend.permissionChoiceId("reject_once"))' \
  "$repo_dir/components/ConsoleContent.qml"
# The default surface stays the panel; the console is strictly opt-in.
grep -Fq 'property string configuredSurface: "panel"' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq '"surface": "panel"' "$repo_dir/manifest.json"
# Exactly one host answers each IPC route: the console window for both of its
# geometries, the bar widget for the panel. The two guards stay complementary.
grep -Fq 'enabled: root.consoleSurfaceLive' "$repo_dir/Ambient.qml"
grep -Fq 'OmaPilot.OmaPilotStore.configuredSurface === "console"' "$repo_dir/Ambient.qml"
grep -Fq 'OmaPilot.OmaPilotStore.configuredSurface === "fullscreen"' "$repo_dir/Ambient.qml"
grep -Fq 'OmaPilot.OmaPilotStore.configuredSurface === "panel"' "$repo_dir/BarWidget.qml"
# A voice answer never paints twice: the curtain stands down behind the console.
grep -Fq '&& !root.consoleOpened' "$repo_dir/Ambient.qml"
# The console tree only exists for users who opted in — to either geometry — and
# the loader is driven rather than bound, so deciding whether `item` should exist
# never reads `item` and no surface change trips a binding loop.
grep -Fq 'if (!consoleSurfaceLive) return' "$repo_dir/Ambient.qml"
grep -Fq 'consoleLoader.active = true' "$repo_dir/Ambient.qml"
# Closing a window unmaps it in the same tick, so the engaged handler has
# usually already destroyed the item by the time this line runs. The guard is
# not defensive habit: without it every switch back to the panel is a TypeError.
grep -Fq 'if (consoleLoader.item && !consoleLoader.item.engaged) consoleTeardown.restart()' \
  "$repo_dir/Ambient.qml"
# Unloading destroys the window, and destroying a window mid-exit takes its
# close animation with it. Switching back to the panel did that in the same tick
# as the close, which is why the console vanished there and slid away elsewhere.
grep -Fq 'id: consoleTeardown' "$repo_dir/Ambient.qml"
grep -Fq 'active: root.surfaceRoutesHere' "$repo_dir/BarWidget.qml"
# That loader unloads the panel tree while it may still be open, and a
# KeyboardPanel only returns the bar's one-popout-at-a-time claim from its own
# close. Without the release on the way out, the bar keeps the accent underline
# lit under an icon whose panel no longer exists, for the rest of the session.
# It has to happen in the widget: measured, a Component.onDestruction inside
# the panel tree does not run on this teardown.
grep -Fq 'bar.activePopout === root' "$repo_dir/BarWidget.qml"
grep -Fq 'bar.releasePopout(root)' "$repo_dir/BarWidget.qml"
grep -Fq 'releaseBarPopout()' "$repo_dir/BarWidget.qml"
absent -Fq 'Component.onDestruction' "$repo_dir/Panel.qml"
# The filament is the state light generalized, never a parallel component.
grep -Fq 'property bool vertical: false' "$repo_dir/components/StateLightBar.qml"
grep -Fq 'vertical: true' "$repo_dir/components/ConsoleContent.qml"
grep -Fq -- '-- BEGIN OmaPilot managed hotkeys' \
  "$repo_dir/scripts/install-hotkeys.sh"
grep -Fq 'property string configuredProvider: "builtin"' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'harness: provider' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'readonly property var modeProviders: Protocol.harnessOptions()' \
  "$repo_dir/components/SettingsView.qml"
grep -Fq 'text: "Open sign-in page"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'sendCommand(Protocol.command("auth_begin", { methodId: selected }))' \
  "$repo_dir/components/OmaPilotStore.qml"
if grep -Fq 'PI_CODING_AGENT_DIR' "$repo_dir/components/OmaPilotStore.qml"; then
  printf 'Built-in authentication must stay embedded instead of launching Pi\n' >&2
  exit 1
fi
if grep -Fq 'backendSelection' "$repo_dir/components/OmaPilotStore.qml"; then
  printf 'Harness selection must not be split into backend and provider settings\n' >&2
  exit 1
fi
grep -Fq 'property bool desktopContextEnabled: true' \
  "$repo_dir/components/OmaPilotStore.qml"
# Reading a selection is not consent to send it anywhere. A selection arriving
# with no action already named has to leave the chooser standing, and only the
# direct hotkey routes may run something the moment the text lands.
grep -Fq 'else selectionChoosing = true' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (TextActions.runsOnArrival(selectionAction)) runTextAction(selectionAction, "")' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'function textAction(): string' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'function rewriteSelection(): string' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'function translateSelection(): string' "$repo_dir/components/OmaPilotStore.qml"
# The guard is chosen by the action that ran. Dropping this field would judge
# every free prompt by the rule written for a correction.
grep -Fq 'action: selectionAction' "$repo_dir/components/OmaPilotStore.qml"
# Asking something else leaves the selection behind, or an unrelated answer
# stays behind the same Replace button aimed at text selected minutes ago.
grep -Fq 'if (!selectionSubmitting && (textActionActive || selectionPending)) endTextAction()' \
  "$repo_dir/components/OmaPilotStore.qml"
# One read at a time, and the answer to a read the user walked away from is
# dropped: the protocol carries no request id, so a stale reply would put one
# window's text behind another window's address.
grep -Fq 'if (!wasPending || selectionTarget === "") return' \
  "$repo_dir/components/OmaPilotStore.qml"
# A late replacement is matched by the window it was sent for, not by a flag an
# unrelated error can clear, or the same text is pasted twice.
grep -Fq 'if (selectionReplaceTarget === "") return' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'replacing: selectionReplaceTarget !== ""' "$repo_dir/components/OmaPilotStore.qml"
# The quote is a reminder of what is about to be worked on, not a viewer: the
# selection can be eight thousand characters. And it is not editable, because a
# replacement is typed over the text still sitting in the other window, which an
# edited copy here would no longer match.
grep -Fq 'maximumLineCount: 6' "$repo_dir/components/TextActionChooser.qml"
if grep -Eq 'TextInput|TextEdit|TextField|TextArea' "$repo_dir/components/TextActionChooser.qml"; then
  printf 'The quoted selection must not be editable\n' >&2
  exit 1
fi
# The three actions are full-width rows inside one decision card. Translation
# owns the native selector here: at the top of the chat body its downward popup
# has room and does not clip against the panel edge.
grep -Fq 'What do you want to do with this selection?' "$repo_dir/components/TextActionChooser.qml"
grep -Fq 'Grammar and syntax, without changing the tone' "$repo_dir/components/TextActionChooser.qml"
grep -Fq 'Clearer, while preserving the meaning' "$repo_dir/components/TextActionChooser.qml"
grep -Fq 'Accessible.name: "Translate to"' "$repo_dir/components/TextActionChooser.qml"
grep -Fq 'onLanguageRequested: function(language)' "$repo_dir/Panel.qml"
grep -Fq 'onLanguageRequested: function(language)' "$repo_dir/components/ConsoleContent.qml"
# No tooltip on a row: it would cover the quoted selection it explains.
if grep -Fq 'tooltipText' "$repo_dir/components/TextActionChooser.qml"; then
  printf 'an action tooltip is drawn over the quote it explains\n' >&2
  exit 1
fi
# The composer is the fourth action while a selection waits, in both fields.
test "$(grep -Fc 'What should I do with this text?' "$repo_dir/components/Composer.qml")" -eq 2
# Both surfaces put the chooser where their empty state already lives, and
# neither shows the desktop quick actions over it.
grep -Fq 'OmaPilot.TextActionChooser {' "$repo_dir/Panel.qml"
grep -Fq '&& !OmaPilot.OmaPilotStore.selectionChoosing' "$repo_dir/Panel.qml"
grep -Fq 'OmaPilot.TextActionChooser {' "$repo_dir/components/ConsoleContent.qml"
grep -Fq '&& !root.backend.selectionChoosing' "$repo_dir/components/ConsoleContent.qml"
# In the sidebar, the chooser is fixed immediately below the header metadata
# and its divider, before the scrollable conversation. That placement is what
# gives the language Dropdown room to open downward.
chooser_line="$(grep -n 'id: textActionChooser' "$repo_dir/components/ConsoleContent.qml" | cut -d: -f1)"
main_line="$(grep -n 'id: mainArea' "$repo_dir/components/ConsoleContent.qml" | cut -d: -f1)"
if [[ -z "$chooser_line" || -z "$main_line" || "$chooser_line" -ge "$main_line" ]]; then
  printf 'the sidebar text-action chooser must sit above the conversation body\n' >&2
  exit 1
fi
# Regenerate runs whatever ran, not the proofread, and both surfaces say so.
test "$(grep -Fc 'Run the same action on the same selection again' \
  "$repo_dir/Panel.qml" "$repo_dir/components/ConsoleContent.qml" | grep -c ':1$')" -eq 2
# Where Translate sends text is the user's, and empty means their locale.
grep -Fq 'Accessible.name: "Translate to"' "$repo_dir/components/SettingsView.qml"
# Replace and Regenerate belong to an action that has run. While the chooser
# stands, whatever is on screen answers an older question, and offering it for
# the text just highlighted types the wrong thing into someone's document.
grep -Fq 'if (source.choosing === true) return "choosing"' "$repo_dir/components/TextActions.js"
grep -Fq 'choosing: selectionChoosing' "$repo_dir/components/OmaPilotStore.qml"
test "$(grep -Fc '&& !OmaPilot.OmaPilotStore.selectionChoosing' "$repo_dir/Panel.qml")" -eq 3
test "$(grep -Fc '&& !root.backend.selectionChoosing' "$repo_dir/components/ConsoleContent.qml")" -eq 3
grep -Fq 'if (!textActionActive || busy || selectionChoosing) return' \
  "$repo_dir/components/OmaPilotStore.qml"
# One rule for whether the text-action controls can be pressed, in one place.
grep -Fq 'readonly property bool textActionReady: !busy && !selectionReplacing' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'backend.textActionReady === true' "$repo_dir/components/TextActionChooser.qml"
test "$(grep -Fc 'OmaPilot.OmaPilotStore.textActionReady' "$repo_dir/Panel.qml")" -eq 2
test "$(grep -Fc 'root.backend.textActionReady' "$repo_dir/components/ConsoleContent.qml")" -eq 2
# Only the composer turns typed text into the fourth action. Every other caller
# of submit — the voice lane above all — is asking its own question.
grep -Fq 'function submitFromComposer(text)' "$repo_dir/components/OmaPilotStore.qml"
if grep -Fq 'if (selectionChoosing) {' "$repo_dir/components/OmaPilotStore.qml"; then
  printf 'submit must not decide for itself that it is a free prompt\n' >&2
  exit 1
fi
grep -Fq 'textActionLanguage: String(text || "")' "$repo_dir/components/SettingsView.qml"
grep -Fq 'property string webHandoffProvider: "duckduckgo"' \
  "$repo_dir/components/OmaPilotStore.qml"
# The submit call now carries the shown question after the handoff provider,
# so a text action can send the harness its envelope while the panel and the
# chat record keep the text the user selected.
grep -Fq 'webHandoffProvider, shown, !textActionActive))' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'var resumeChatId = textActionActive ? "" : committedChatId' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'function submit(text, shownText)' "$repo_dir/components/OmaPilotStore.qml"
# The hotkey listing reads the user's bindings and never writes them. Only
# the installer script may touch that file, and only its own marked block.
grep -Fq 'watchChanges: true' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Hotkeys.installedChords' "$repo_dir/components/OmaPilotStore.qml"
if grep -nE 'hyprlandBindings\.(setText|write)|bindings\.lua"\)*\s*,\s*"w' "$repo_dir/components/OmaPilotStore.qml"; then
  fail "the store must never write the user's Hyprland bindings"
fi
grep -Fq 'DesktopContext.snapshot()' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Protocol.hasFeature(event.features, "desktop-context")' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'import Quickshell.Hyprland' "$repo_dir/components/DesktopContext.qml"
grep -Fq 'import Quickshell.Services.Mpris' "$repo_dir/components/DesktopContext.qml"
awk '
  /^[[:space:]]*function / { latched = 0 }
  /OmaPilot\.OmaPilotStore\.latchDesktopContext\(\)/ { latched = 1 }
  /root\.controller\.show\(\)/ { if (!latched) exit 1; shows += 1 }
  END { if (shows < 3) exit 1 }
' "$repo_dir/Panel.qml"
awk '
  /^[[:space:]]*function / { cleared = 0 }
  /OmaPilot\.OmaPilotStore\.clearDesktopContextLatch\(\)/ { cleared = 1 }
  /root\.controller\.hide\(\)/ { if (!cleared) exit 1; hides += 1 }
  END { if (hides < 2) exit 1 }
' "$repo_dir/Panel.qml"
awk '
  /function desktopContextForSubmit\(\)/ { inside = 1; gated = 0 }
  inside && /if \(!desktopContextActive\) return null/ { gated = 1 }
  inside && /DesktopContext\.snapshot\(\)/ { if (!gated) exit 1; found = 1; exit }
  END { if (!found) exit 1 }
' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (context && context.activeWindow) latchedActiveWindow = context.activeWindow' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (!changed) return' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'model = desiredModel' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (providers.length > 0) selectProvider(provider)' \
  "$repo_dir/components/OmaPilotStore.qml"
test "$(grep -Fc 'root.pendingPermission = null' "$repo_dir/components/OmaPilotStore.qml")" -ge 2
test "$(grep -Fc 'root.permissionQueue = []' "$repo_dir/components/OmaPilotStore.qml")" -ge 2
grep -Fq 'signal escapeRequested()' "$repo_dir/components/Composer.qml"
grep -Fq 'Protocol.providerPolicyDescription(root.backend.provider, root.backend.providerPolicy)' "$repo_dir/components/SettingsView.qml"
grep -Fq 'policy.web === "search"' "$repo_dir/components/Protocol.js"
grep -Fq 'policy.web === "approved-command"' "$repo_dir/components/Protocol.js"
if grep -Fq 'ButtonGroup {' "$repo_dir/components/Composer.qml"; then
  printf 'Composer must not expose a capability mode selector\n' >&2
  exit 1
fi
grep -Fq 'Protocol.hasFeature(event.features, "capability-packs")' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'sendCommand(Protocol.command("capability_set_enabled"' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'sendCommand(Protocol.command("capability_files_root_set"' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'visible: root.selectedTab === "skills"' \
  "$repo_dir/components/SettingsView.qml"
if grep -Eqi 'if .*local_action|local_action.*sendCommand' \
    "$repo_dir/Panel.qml" "$repo_dir/components/OmaPilotStore.qml"; then
  printf 'QML must not hardcode local-action execution routing\n' >&2
  exit 1
fi
grep -Fq 'visible: !root.backend || root.backend.pendingPermission === null' \
  "$repo_dir/components/Composer.qml"
if grep -Eq 'sandboxed|Device commands stay blocked|sandbox limits stay active' \
  "$repo_dir/Panel.qml" "$repo_dir/components/Protocol.js"; then
  printf 'QML permission copy must not retain unreachable legacy policy branches\n' >&2
  exit 1
fi
grep -Fq 'Review the exact request and choose how long this agent may retain the approval.' \
  "$repo_dir/Panel.qml"
grep -Fq 'readonly property bool popupOpen:' "$repo_dir/components/Composer.qml"
grep -Fq 'var action = Presentation.escapeAction(root.viewMode, composer.popupOpen,' "$repo_dir/Panel.qml"
grep -Fq 'if (action === "close-composer-popup") composer.closePopups()' "$repo_dir/Panel.qml"
grep -Fq 'OmaPilot.SettingsView {' "$repo_dir/Panel.qml"
grep -Fq 'visible: root.viewMode === "settings"' "$repo_dir/Panel.qml"
grep -Fq 'settingsView.popupOpen' "$repo_dir/Panel.qml"
# The ambient redesign removed the panel header (logo, tagline, gear). The
# chrome assertions below pin the replacement instead: a borderless hero prompt,
# one answer seam, and a hint row carrying provider identity, permission posture,
# the desktop-global settings binding, and focused-panel history navigation.
if grep -Fq 'OmaPilot.OmaPilotHeader {' "$repo_dir/Panel.qml"; then
  printf 'Panel must not reintroduce the OmaPilot header chrome\n' >&2
  exit 1
fi
if grep -Fq 'ActivityFilament {' "$repo_dir/components/Composer.qml"; then
  printf 'The composer must not draw a second rule above the answer seam\n' >&2
  exit 1
fi
grep -Fq 'OmaPilot.StateLightBar {' "$repo_dir/Panel.qml"
grep -Fq 'Layout.minimumHeight: contentVisible ? Style.space(120) : stateLightBar.implicitHeight' \
  "$repo_dir/Panel.qml"
grep -Fq 'visible: answerCard.contentVisible' "$repo_dir/Panel.qml"
grep -Fq 'readonly property bool atmosphereActive: motionEnabled' \
  "$repo_dir/components/StateLightBar.qml"
grep -Fq '&& (phase === "listening" || phase === "thinking")' \
  "$repo_dir/components/StateLightBar.qml"
grep -Fq 'running: root.atmosphereActive' "$repo_dir/components/StateLightBar.qml"
grep -Fq 'StateColor.forPhase' "$repo_dir/components/StateLightBar.qml"
grep -Fq 'colorizationColor: root.displayedColor' "$repo_dir/components/StateLightBar.qml"
grep -Fq 'readonly property real glowCenter: thinking' "$repo_dir/components/StateLightBar.qml"
grep -Fq 'root.travel = (root.travel + 0.0095) % 1' "$repo_dir/components/StateLightBar.qml"
grep -Fq 'id: promptRow' "$repo_dir/components/Composer.qml"
grep -Fq 'iconText: "󰹑"' "$repo_dir/components/Composer.qml"
grep -Fq '󰍬' "$repo_dir/components/Composer.qml"
if grep -Fq 'Active window, open apps, workspaces, and playing media' \
    "$repo_dir/components/Composer.qml"; then
  printf 'Desktop context disclosure must be the hostname, not a capability list\n' >&2
  exit 1
fi
grep -Fq 'Protocol.providerShortLabel(OmaPilot.OmaPilotStore.provider)' "$repo_dir/Panel.qml"
grep -Fq 'font.pixelSize: Style.font.heading' "$repo_dir/components/Composer.qml"
grep -Fq 'sequences: ["Ctrl+H"]' "$repo_dir/Panel.qml"
grep -Fq '{ label: "Super+Alt+P settings", lane: "settings" }' "$repo_dir/Panel.qml"
if grep -Fq 'Ctrl+,' "$repo_dir/Panel.qml" "$repo_dir/components/Composer.qml"; then
  printf 'Settings must use only the desktop-global Super+Alt+P binding\n' >&2
  exit 1
fi
if grep -Fq 'id: caret' "$repo_dir/components/Composer.qml"; then
  printf 'Prompt text must share the content left edge without a decorative caret\n' >&2
  exit 1
fi
grep -Fq 'Presentation.permissionNotice(root.dangerousAutoApprove)' "$repo_dir/Panel.qml"
grep -Fq 'text: "OmaPilot"' "$repo_dir/components/OmaPilotHeader.qml"
grep -Fq 'source: Qt.resolvedUrl("../assets/omapilot-mark.png")' \
  "$repo_dir/components/OmaPilotMark.qml"
grep -Fq 'display: QQC.AbstractButton.IconOnly' "$repo_dir/components/OmaPilotMark.qml"
grep -Fq 'icon.color: root.accent' "$repo_dir/components/OmaPilotMark.qml"
grep -Fq 'iconComponent: Component {' "$repo_dir/BarWidget.qml"
test -s "$repo_dir/assets/omapilot-mark.png"
if grep -RFq 'interactionMode' "$repo_dir/BarWidget.qml" "$repo_dir/Panel.qml" "$repo_dir/components"; then
  printf 'OmaPilot must not retain Ask/Act presentation state\n' >&2
  exit 1
fi
if [[ -e "$repo_dir/components/ModeSwitch.qml" ]]; then
  printf 'OmaPilot must not retain the Ask/Act mode switch\n' >&2
  exit 1
fi
grep -Fq 'visible: OmaPilot.OmaPilotStore.pendingPermission !== null' "$repo_dir/Panel.qml"
grep -Fq 'OmaPilot.QuickActions {' "$repo_dir/Panel.qml"
grep -Fq 'workInAppShortcutText: "Ctrl+Shift+A"' "$repo_dir/Panel.qml"
grep -Fq 'sequence: "Ctrl+Shift+A"' \
  "$repo_dir/components/internal/PanelKeyboardNavigation.qml"
if grep -RFq 'Ctrl+Alt+A' "$repo_dir/Panel.qml" "$repo_dir/components"; then
  printf 'OmaPilot production QML must not retain the AltGr-aliased shortcut\n' >&2
  exit 1
fi
grep -Fq 'var prompt = ActionCatalog.promptFor(root.quickActionItems, "work-in-app")' \
  "$repo_dir/Panel.qml"
grep -Fq 'composer.setDraft(prompt)' "$repo_dir/Panel.qml"
test "$(grep -Fc '&& !OmaPilot.OmaPilotStore.busy' "$repo_dir/Panel.qml")" -ge 2
grep -Fq 'modalInteractionActive: root.modalInteractionActive' \
  "$repo_dir/Panel.qml"
grep -Fq 'Accessible.name: tooltipText' "$repo_dir/components/QuickActions.qml"
grep -Fq 'quickActionsJson' "$repo_dir/Panel.qml"
grep -Fq 'onQuickActionsEdited:' "$repo_dir/Panel.qml"
grep -Fq 'Accessible.name: "OmaPilot settings"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'SettingsTabs {' "$repo_dir/components/SettingsView.qml"
grep -Fq 'property string selectedTab: "agent"' "$repo_dir/components/SettingsView.qml"
grep -Fq '{ id: "agent", label: "Agent" }' "$repo_dir/components/Presentation.js"
grep -Fq 'QuickActionEditor {' "$repo_dir/components/SettingsView.qml"
grep -Fq 'maximumActions = 5' "$repo_dir/components/QuickActions.js"
grep -Fq 'function moveAction(actions, index, delta)' "$repo_dir/components/QuickActions.js"
grep -Fq 'function removeAction(actions, index)' "$repo_dir/components/QuickActions.js"
grep -Fq 'ActionCatalog.addAction(' "$repo_dir/components/QuickActionEditor.qml"
grep -Fq 'ActionCatalog.updateAction(' "$repo_dir/components/QuickActionEditor.qml"
grep -Fq 'label: "Dangerous auto-approve"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'label: "Desktop context"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'text: "Search provider"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'Accessible.name: "Search provider"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'onWebHandoffProviderRequested:' "$repo_dir/Panel.qml"
grep -Fq '"webHandoffProvider": "duckduckgo"' "$repo_dir/manifest.json"
grep -Fq '{ id: "voice", label: "Voice" }' "$repo_dir/components/Presentation.js"
grep -Fq 'visible: root.selectedTab === "voice"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'label: "Enable voice"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'text: "Listening"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'text: "Speaking"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'Accessible.name: "TTS provider"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'Accessible.name: "TTS model"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'Accessible.name: "TTS voice"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'function requestVoiceStatus()' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Protocol.command("voice_status")' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Protocol.ttsKeySetCommand(provider, apiKey)' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'onVoiceEnabledRequested:' "$repo_dir/Panel.qml"
grep -Fq 'if (!OmaPilot.OmaPilotStore.voiceEnabled)' "$repo_dir/Ambient.qml"
grep -Fq 'function newVoiceChat() {' "$repo_dir/Ambient.qml"
grep -Fq 'function onIpcNewVoiceChatRequested() { root.newVoiceChat() }' \
  "$repo_dir/Ambient.qml"
grep -Fq 'property bool voiceSessionActive: false' "$repo_dir/Ambient.qml"
grep -Fq 'SessionLifecycle.voiceActivationMode(' "$repo_dir/Ambient.qml"
grep -Fq 'voiceSessionActive = false' "$repo_dir/Ambient.qml"
grep -Fq 'function status(): string { return "store=" + root.state }' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'freshVoiceStartPending = freshVoiceStartPending || freshChat' \
  "$repo_dir/Ambient.qml"
grep -Fq 'property bool freshChatResetInProgress: false' "$repo_dir/Ambient.qml"
grep -Fq 'if (freshChatResetInProgress) return' "$repo_dir/Ambient.qml"
grep -Fq 'if (freshChat && !freshChatReset) resetFreshVoiceChat()' \
  "$repo_dir/Ambient.qml"
grep -Fq 'function continueInHerdr() { root.continueInHerdr() }' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq '|| (pendingHerdrChatId === "" && currentId !== "" && busy)' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (root.newChatPending && !root.busy) root.resetChat()' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'submittedResumeChatId = committedChatId' "$repo_dir/components/OmaPilotStore.qml"
test "$(grep -Fc 'restoreSubmittedContinuation()' \
  "$repo_dir/components/OmaPilotStore.qml")" -ge 3
grep -Fq 'pendingHerdrChatId = currentChatId' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'String(event.chatId || "") !== pendingHerdrChatId' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'SUPER + SHIFT + A' "$repo_dir/README.md"
grep -Fq 'io.github.spencerbull.omapilot newVoiceChat' "$repo_dir/README.md"
grep -Fq 'SUPER + ALT + N' "$repo_dir/README.md"
grep -Fq 'io.github.spencerbull.omapilot continueInHerdr' "$repo_dir/README.md"
if grep -Fq 'text: "Voice indicator"' "$repo_dir/components/SettingsView.qml"; then
  printf 'Voice settings must own listening and speaking, not only the Voxtype OSD\n' >&2
  exit 1
fi
grep -Fq 'voice-auth.json' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'id: "kokoro"' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'elevenlabs: "ElevenLabs"' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v2/voices"' \
  "$repo_dir/runtime/src/tts.ts"
grep -Fq 'url.searchParams.set("page_size", String(ELEVENLABS_VOICE_PAGE_SIZE))' \
  "$repo_dir/runtime/src/tts.ts"
grep -Fq 'wyWA56cQNU2KqUW4eCsI' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'wyWA56cQNU2KqUW4eCsI' "$repo_dir/components/Protocol.js"
grep -Fq 'function ttsSpeakCommand' "$repo_dir/components/Protocol.js"
grep -Fq 'function speakAnswer' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'property bool ttsPlaybackMetered: false' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (type === "tts_level")' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'playbackLevel: OmaPilot.OmaPilotStore.ttsLevel' "$repo_dir/Ambient.qml"
grep -Fq 'function normalizedTtsLevel(event)' "$repo_dir/components/Protocol.js"
grep -Fq 'OmaPilot.OmaPilotStore.speakAnswer(answer)' "$repo_dir/Ambient.qml"
grep -Fq 'https://api.elevenlabs.io/v1/text-to-speech/' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'https://api.openai.com/v1/audio/speech' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'export function pcm16Envelope(' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'type: "tts_level"' "$repo_dir/runtime/src/types.ts"
grep -Fq 'https://api.openai.com/v1/models' "$repo_dir/runtime/src/tts.ts"
grep -Fq 'text: "Browser context"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'onDesktopContextRequested:' "$repo_dir/Panel.qml"
grep -Fq 'text: "History"' "$repo_dir/components/HistoryView.qml"
grep -Fq 'ActivityFilament {' "$repo_dir/components/HistoryView.qml"
grep -Fq 'text: root.browserCompanion.relayInstalled === true ? "Repair browser setup" : "Enable browser context"' \
  "$repo_dir/components/SettingsView.qml"
grep -Fq 'onBrowserCompanionInstallRequested:' "$repo_dir/Panel.qml"
grep -Fq 'Protocol.command("browser_companion_install")' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Protocol.command("browser_companion_uninstall")' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Protocol.command("browser_companion_open_settings", { family: selected })' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'text: "Open Firefox debugging"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'Accessible.name: "Copy Firefox extension folder path"' \
  "$repo_dir/components/SettingsView.qml"
grep -Fq 'text: root.browserRemoveConfirmation ? "Confirm removal" : "Remove browser context"' \
  "$repo_dir/components/SettingsView.qml"
grep -Fq 'onDangerousAutoApproveRequested:' "$repo_dir/Panel.qml"
awk '
  /function close\(\)/ { inside = 1; cleared = 0 }
  inside && /OmaPilot\.OmaPilotStore\.clearContextAttachments\(\)/ { cleared = 1 }
  inside && /root\.controller\.hide\(\)/ { if (!cleared) exit 1; found = 1; exit }
  END { if (!found) exit 1 }
' "$repo_dir/Panel.qml"
# The composer sends the draft it holds, and it sends it through the one entry
# point that knows a typed sentence can be a text action. It used to call
# submit directly, which made every other caller of submit — the voice lane
# above all — into a free prompt applied to whatever was selected.
grep -Fq 'backend.submitFromComposer(draftText)' \
  "$repo_dir/components/Composer.qml"
grep -Fq 'var autoApprove = configuredDangerousAutoApprove' \
  "$repo_dir/components/OmaPilotStore.qml"
if grep -Fq 'tooltipText: "Close OmaPilot"' "$repo_dir/Panel.qml" "$repo_dir/components/SettingsView.qml"; then
  printf 'OmaPilot must rely on panel dismissal rather than a redundant close control\n' >&2
  exit 1
fi
grep -Fq 'Presentation.boundedPanelHeight(root.activeNaturalHeight' "$repo_dir/Panel.qml"
grep -Fq 'popup.availableCardHeight * 0.82' "$repo_dir/Panel.qml"
grep -Fq 'id: responseViewport' "$repo_dir/Panel.qml"
grep -Fq 'property bool followLatest: true' "$repo_dir/Panel.qml"
grep -Fq 'onMovementEnded: followLatest = Presentation.isNearBottom(' "$repo_dir/Panel.qml"
grep -Fq 'tooltipText: "Jump to the newest response"' "$repo_dir/Panel.qml"
# The perimeter runner circled the answer card's border. The redesign removed
# that border, so state now lives in the persistent answer seam. The old
# component remains for its motion probe and preview fixtures, but the panel
# must not put a runner back around the response.
if grep -Fq 'OmaPilot.ResponseActivityBorder {' "$repo_dir/Panel.qml"; then
  printf 'Panel must not reintroduce the response perimeter runner\n' >&2
  exit 1
fi
grep -Fq 'id: sweepSource' "$repo_dir/components/ActivityFilament.qml"
# Every state must resolve through one mapping rather than hardcoding accent.
grep -Fq 'StateColor.forPhase' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'anchors { left: parent.left; right: parent.right }' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'property real tide: 0.35' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'property real drift: 0' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'readonly property bool atmosphereActive: motionEnabled' "$repo_dir/components/VoiceNode.qml"
grep -Fq '&& (phase === "listening" || phase === "thinking" || speaking)' \
  "$repo_dir/components/VoiceNode.qml"
grep -Fq 'readonly property bool voiceWaveActive: phase === "listening" || speaking' \
  "$repo_dir/components/VoiceNode.qml"
grep -Fq 'readonly property bool thinkingScannerActive: phase === "thinking"' \
  "$repo_dir/components/VoiceNode.qml"
grep -Fq 'id: thinkingScanner' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'active: root.thinkingScannerActive' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'playbackMetered ? Math.max(0, Math.min(1, playbackLevel))' \
  "$repo_dir/components/VoiceNode.qml"
grep -Fq 'running: root.atmosphereActive' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'running: root.motionEnabled && root.lit && root.phase !== "listening"' "$repo_dir/components/VoiceNode.qml"
grep -Fq '0.50 + root.organicDrift * 0.075' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'Math.sin(livingPhase * 1.618 + 1.1)' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'motionStyle: root.speaking ? "speaking" : root.phase' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'readonly property real motionPace: thinking ? 0.084 : (speaking ? 0.056 : 0.022)' \
  "$repo_dir/components/VoiceWave.qml"
grep -Fq 'var travel = (root.phase * 0.095) % 1' "$repo_dir/components/VoiceWave.qml"
grep -Fq 'readonly property real speakingLevel: boundedLevel <= 0.025 ? 0' \
  "$repo_dir/components/VoiceWave.qml"
grep -Fq 'Math.pow((boundedLevel - 0.025) / 0.975, 0.62) * 1.18' \
  "$repo_dir/components/VoiceWave.qml"
grep -Fq 'interval: 2800' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'running: root.phase === "thinking" && root.motionEnabled' \
  "$repo_dir/components/VoiceNode.qml"
grep -Fq 'readonly property bool thinkingPhraseRunning: thinkingPhraseTimer.running' \
  "$repo_dir/components/VoiceNode.qml"
grep -Fq 'StatePhrases.thinkingAt(thinkingPhraseIndex)' \
  "$repo_dir/components/VoiceNode.qml"
grep -Fq 'readonly property string captionDetail:' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'id: scannerTravel' "$repo_dir/components/ThinkingScanner.qml"
grep -Fq 'property: "progress"; from: 0; to: 1' \
  "$repo_dir/components/ThinkingScanner.qml"
grep -Fq 'property: "progress"; from: 1; to: 0' \
  "$repo_dir/components/ThinkingScanner.qml"
grep -Fq 'source: scannerGlowSource' "$repo_dir/components/ThinkingScanner.qml"
grep -Fq 'onMotionEnabledChanged: {' "$repo_dir/components/VoiceNode.qml"
grep -Fq 'readonly property bool rotatingActivityStatus:' "$repo_dir/Panel.qml"
grep -Fq 'onRotatingActivityStatusChanged:' "$repo_dir/Panel.qml"
grep -Fq 'text: root.activityStatusText' "$repo_dir/Panel.qml"
grep -Fq 'StatePhrases.thinkingAt(0)' "$repo_dir/tests/visual-preview.qml"
grep -Fq 'StateColor.forPhase' "$repo_dir/components/AnswerCurtain.qml"
grep -Fq 'colorizationColor: root.accent' "$repo_dir/components/ActivityFilament.qml"
grep -Fq 'id: responseStatusSlot' "$repo_dir/Panel.qml"
grep -Fq 'Layout.minimumWidth: Style.space(140)' "$repo_dir/Panel.qml"
grep -Fq 'import QtQuick.Effects' "$repo_dir/components/ResponseActivityBorder.qml"
grep -Fq 'import QtQuick.Shapes' "$repo_dir/components/ResponseActivityBorder.qml"
grep -Fq 'id: perimeterTravel' "$repo_dir/components/ResponseActivityBorder.qml"
grep -Fq 'loops: Animation.Infinite' "$repo_dir/components/ResponseActivityBorder.qml"
grep -Fq 'objectName: "responseActivityBloom"' "$repo_dir/components/ResponseActivityBorder.qml"
grep -Fq 'blurMax: root.glowBlurMax' "$repo_dir/components/ResponseActivityBorder.qml"
grep -Fq 'blurMultiplier: 1.1' "$repo_dir/components/ResponseActivityBorder.qml"
grep -Fq 'colorizationColor: root.accent' "$repo_dir/components/ResponseActivityBorder.qml"
test "$(grep -Fc 'strokeColor: root.accent' "$repo_dir/components/ResponseActivityBorder.qml")" -eq 1
test "$(grep -Fc 'dashOffset: (1 - root.phase) * root.trackPerimeter' \
  "$repo_dir/components/ResponseActivityBorder.qml")" -eq 1
test "$(grep -Ec '(^|[^[:alnum:]_.])Shape \{' \
  "$repo_dir/components/ResponseActivityBorder.qml")" -eq 1
test "$(grep -Fc 'MultiEffect {' "$repo_dir/components/ResponseActivityBorder.qml")" -eq 1
grep -Fq 'source: runnerGlowSource' "$repo_dir/components/ResponseActivityBorder.qml"
if ! awk '
  /^  Shape \{/ { inside = 1; next }
  /^  [A-Z]/ { inside = 0 }
  inside && /^    visible: false([[:space:]]|$)/ { hidden = 1 }
  END { if (!hidden) exit 1 }
' "$repo_dir/components/ResponseActivityBorder.qml"; then
  printf 'OmaPilot perimeter source Shape must stay hidden behind the blur\n' >&2
  exit 1
fi
if grep -Eq 'responseActivityCore|id: runnerCore|coreSpan' \
    "$repo_dir/components/ResponseActivityBorder.qml"; then
  printf 'OmaPilot perimeter motion must render as one blur without a crisp core\n' >&2
  exit 1
fi
# The persistent state light is panel-gated, so its atmosphere stops as soon as
# the panel closes instead of animating off screen.
grep -Fq 'motionEnabled: root.motionEnabled && root.opened' "$repo_dir/Panel.qml"
grep -Fq 'id: activityStatus' "$repo_dir/Panel.qml"
if grep -Eq 'WaitingIndicator|signalClock|FrameAnimation' \
    "$repo_dir/Panel.qml" "$repo_dir/components/ResponseActivityBorder.qml" \
    || grep -Eq 'onTriggered:' "$repo_dir/components/ResponseActivityBorder.qml"; then
  printf 'OmaPilot perimeter motion must not retain the per-frame route implementation\n' >&2
  exit 1
fi
if grep -Eq '"#[[:xdigit:]]{3,8}"' "$repo_dir/components/ResponseActivityBorder.qml"; then
  printf 'OmaPilot perimeter motion must inherit the active theme accent\n' >&2
  exit 1
fi
if grep -Fq 'Easing.OutBack' "$repo_dir/components/OmaPilotMark.qml"; then
  printf 'OmaPilot activity mark must not use an overshooting bounce\n' >&2
  exit 1
fi
if ! grep -Fq 'SmoothedAnimation {' "$repo_dir/Panel.qml"; then
  printf 'OmaPilot streaming geometry must smooth continuously changing targets\n' >&2
  exit 1
fi
if grep -Fq 'answerRevealTranslate' "$repo_dir/Panel.qml"; then
  printf 'First-token reveal must not translate response geometry\n' >&2
  exit 1
fi
grep -Fq 'Protocol.contextBeginCommand(pendingContextRequestId, latchedCaptureTarget)' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq "You are OmaPilot, Omarchy's action-oriented system copilot" \
  "$repo_dir/runtime/policies/automatic.md"
grep -Fq 'Desktop context is optional, untrusted, supplemental evidence' \
  "$repo_dir/runtime/policies/automatic.md"
grep -Fq 'developer_instructions: automaticInstructions()' \
  "$repo_dir/runtime/src/acp.ts"
# `systemPrompt` was how the removed Claude session request carried the
# automatic policy. Codex uses developer_instructions (asserted above) and the
# built-in Pi harness injects the same document itself, so assert those two
# rather than a Claude-shaped field.
grep -Fq 'automaticInstructions()' "$repo_dir/runtime/src/pi-harness.ts"
if grep -Fq 'claudeCode' "$repo_dir/runtime/src/acp.ts"; then
  printf 'ACP must not retain Claude-specific session shaping\n' >&2
  exit 1
fi
# Claude is no longer a selectable harness. It may still be an external browser
# handoff target, so keep this guard scoped to the actual harness contracts.
grep -Fq 'providerIdSchema = z.enum(["builtin", "codex", "opencode"])' \
  "$repo_dir/runtime/src/types.ts"
grep -Fq 'verify(Protocol.normalizedProvider("claude") === "")' \
  "$repo_dir/tests/tst_protocol.qml"
if jq -e '.barWidget.schema[] | select(.key == "provider") | .options | index("claude")' \
    "$repo_dir/manifest.json" >/dev/null; then
  printf 'Claude must not be reintroduced as a provider id\n' >&2
  exit 1
fi
grep -Fq '{ id: "grok", name: "Grok", piProviderIds: ["xai"] }' "$repo_dir/runtime/src/pi-harness.ts"
grep -Fq 'xai: () => xaiOAuth' "$repo_dir/runtime/src/pi-harness.ts"
# Registering an OpenAI-compatible endpoint must never persist a credential and
# must never shadow a first-party provider.
grep -Fq 'openai-responses' "$repo_dir/runtime/src/custom-providers.ts"
grep -Fq 'RESERVED_IDS' "$repo_dir/runtime/src/custom-providers.ts"
grep -Fq 'Plain http is only allowed for localhost or Tailscale .ts.net endpoints' "$repo_dir/runtime/src/custom-providers.ts"
grep -Fq 'type: "custom_provider_saved"' "$repo_dir/runtime/src/broker.ts"
grep -Fq 'type: "custom_provider_tested"' "$repo_dir/runtime/src/broker.ts"
grep -Fq 'property bool customProviderSavePending: false' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'readonly property bool providerReady: initialized && providerAvailable(provider)' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'readonly property bool canSubmit: providerReady && !continuationBlocked && !busy' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'continuationProvider = currentChatId !== "" ? historicalProvider : ""' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'Protocol.historyContinuationBlocked(' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (!providerReady || continuationBlocked || busy) return false' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'if (!OmaPilot.OmaPilotStore.submit(spoken))' "$repo_dir/Ambient.qml"
# The broker's Voxtype OSD switch is a separate config-write boundary from the
# opt-in hotkey helper. It must stay a single-key, comment-preserving,
# backed-up, user-initiated edit, and the exception must stay documented.
grep -Fq '.omapilot.bak' "$repo_dir/runtime/src/voxtype-osd.ts"
grep -Fq 'One separate, narrowly scoped exception exists for Voxtype' \
  "$repo_dir/docs/architecture.md"
if grep -Eq 'writeFileSync\(configPath' "$repo_dir/runtime/src/voxtype-osd.ts"; then
  printf 'Voxtype config must be replaced atomically, not written in place\n' >&2
  exit 1
fi
if grep -Eq '^[[:space:]]+apiKey[[:space:]]*:' "$repo_dir/runtime/src/custom-providers.ts"; then
  printf 'Custom provider definitions must not persist credentials\n' >&2
  exit 1
fi
grep -Fq 'instructions: [automaticInstructionPath()]' \
  "$repo_dir/runtime/src/providers.ts"
grep -Fq 'runtime/policies/automatic.md' "$repo_dir/scripts/package-runtime.sh"
grep -Fq 'runtime/dist/capability-mcp.js' "$repo_dir/scripts/package-runtime.sh"
if grep -Fq 'Animation.Infinite' "$repo_dir/Panel.qml"; then
  printf 'Panel-owned transitions must remain finite\n' >&2
  exit 1
fi
grep -Fq 'OmaPilot.ErrorNotice {' "$repo_dir/Panel.qml"
grep -Fq 'onDetailsRequested: root.openErrorDetails()' "$repo_dir/Panel.qml"
grep -Fq 'OmaPilot.ErrorDetailsView {' "$repo_dir/Panel.qml"
grep -Fq 'visible: root.viewMode === "error"' "$repo_dir/Panel.qml"
grep -Fq 'errorDetails = Protocol.normalizedError(event, statusMessage)' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'readonly property bool opened:' "$repo_dir/BarWidget.qml"
# Switching surface is a move, not a dismissal: the outgoing surface hands the
# open state to the incoming one. Without it the console closed and nothing
# appeared, and the bar icon had to be pressed a second time to see what had
# just been asked for — in both directions.
grep -Fq 'function closeForPopoutSwitch()' "$repo_dir/BarWidget.qml"
# The intent is captured when the surface is asked for, not read back when the
# setting lands: the bar panel is a popout and has dismissed itself by then, so
# "was the old one open" is always no and the console never appeared.
# Armed only when the surface actually moves: asking for the one you are on
# would otherwise leave the intent pending and open a surface later that the
# user had deliberately closed.
grep -Fq 'if (next !== configuredSurface) surfaceHandoffPending = true' \
  "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'function takeSurfaceHandoff()' "$repo_dir/components/OmaPilotStore.qml"
# Consumed on both transitions. Console and fullscreen are one live surface
# wearing two geometries, so moving between them never changes
# `consoleSurfaceLive` — measured: the intent sat armed and the next switch
# opened a surface the user had closed in between.
test "$(grep -Fc 'OmaPilot.OmaPilotStore.takeSurfaceHandoff()' "$repo_dir/Ambient.qml")" -eq 2
grep -Fq 'OmaPilot.OmaPilotStore.takeSurfaceHandoff()' "$repo_dir/BarWidget.qml"
# One-shot and set nowhere else, so a shell restart reading the same value off
# disk does not pop a surface open at login.
absent -Fq 'surfaceHandoffPending' "$repo_dir/Ambient.qml"
absent -Fq 'surfaceHandoffPending' "$repo_dir/BarWidget.qml"
test "$(grep -Fc 'IpcHandler {' "$repo_dir/components/OmaPilotStore.qml")" -eq 1
if grep -Fq 'IpcHandler {' "$repo_dir/BarWidget.qml" \
    || grep -Fq 'IpcHandler {' "$repo_dir/Ambient.qml"; then
  printf 'Only OmaPilotStore may register the plugin IPC target\n' >&2
  exit 1
fi
grep -Fq 'function voiceToggle(): string {' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'signal ipcVoiceToggleRequested()' "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'function onIpcOpenRequested()' "$repo_dir/BarWidget.qml"
grep -Fq 'if (root.routedWidget() === root) root.open()' "$repo_dir/BarWidget.qml"
grep -Fq 'signal ipcOpenRequested()' "$repo_dir/components/OmaPilotStore.qml"
manifest_id="$(jq -r '.id' "$repo_dir/manifest.json")"
grep -Fq "target: \"$manifest_id\"" "$repo_dir/components/OmaPilotStore.qml"
grep -Fq 'bar.findPanelWidget(moduleName)' "$repo_dir/BarWidget.qml"
if grep -Fq 'Accessible.name: plainText' "$repo_dir/components/MarkdownView.qml"; then
  printf 'MarkdownView uses TextEdit.plainText, which is unavailable in Qt Quick\n' >&2
  exit 1
fi

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_protocol.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_permission_focus.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_panel_keyboard_navigation.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_history_keyboard.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_placement.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_presentation.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_state_color.qml" \
  -import "$repo_dir" || fail "state colour tests failed"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_state_phrases.qml" \
  -import "$repo_dir" || fail "state phrase tests failed"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_session_lifecycle.qml" \
  -import "$repo_dir" || fail "session lifecycle tests failed"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_quick_actions.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_text_actions.qml" \
  -import "$repo_dir" || fail "text action tests failed"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_hotkeys.qml" \
  -import "$repo_dir" || fail "hotkey listing tests failed"

smoke_root="$(mktemp -d)"
cp "$repo_dir/tests/smoke.qml" "$smoke_root/shell.qml"
cp "$repo_dir/Ambient.qml" "$repo_dir/BarWidget.qml" \
  "$repo_dir/ContextCaptureOverlay.qml" "$repo_dir/Panel.qml" "$smoke_root/"
cp -a "$repo_dir/components" "$smoke_root/components"
cp -a "$repo_dir/assets" "$smoke_root/assets"
cp -a "$omarchy_shell/Commons" "$omarchy_shell/Ui" "$smoke_root/"

OMAPILOT_BROKER_PATH=/usr/bin/false QT_QPA_PLATFORM=wayland \
  timeout 5s quickshell --no-duplicate --path "$smoke_root" --no-color \
  >"$smoke_root/output.log" 2>&1
if grep -Eq "smoke loader failed|overlay smoke loader failed|Failed to load|Type .* unavailable|Cannot assign|Handler was registered but will not be used" "$smoke_root/output.log"; then
  cat "$smoke_root/output.log"
  exit 1
fi

cp "$repo_dir/tests/ambient-session-lifecycle-probe.qml" "$smoke_root/shell.qml"
if ! OMAPILOT_BROKER_PATH=/usr/bin/false QT_QPA_PLATFORM=wayland \
    timeout 5s quickshell --no-duplicate --path "$smoke_root" --no-color \
    >"$smoke_root/ambient-session-lifecycle.log" 2>&1; then
  cat "$smoke_root/ambient-session-lifecycle.log"
  exit 1
fi
if grep -Eq "omapilot ambient session lifecycle probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError|ReferenceError" \
    "$smoke_root/ambient-session-lifecycle.log" \
    || ! grep -Fq 'OMAPILOT_AMBIENT_SESSION_LIFECYCLE_PROBE_OK' \
      "$smoke_root/ambient-session-lifecycle.log"; then
  cat "$smoke_root/ambient-session-lifecycle.log"
  exit 1
fi

cp "$repo_dir/tests/settings-server-save-probe.qml" "$smoke_root/shell.qml"
if ! QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
    --path "$smoke_root" --no-color >"$smoke_root/server-save.log" 2>&1; then
  cat "$smoke_root/server-save.log"
  exit 1
fi
if grep -Eq "omapilot server save probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError|ReferenceError" \
    "$smoke_root/server-save.log" \
    || ! grep -Fq 'OMAPILOT_SERVER_SAVE_PROBE_OK' "$smoke_root/server-save.log"; then
  cat "$smoke_root/server-save.log"
  exit 1
fi

cp "$repo_dir/tests/BackendStub.qml" "$smoke_root/"
cp "$repo_dir/tests/console-escape-probe.qml" "$smoke_root/shell.qml"
if ! QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
    --path "$smoke_root" --no-color >"$smoke_root/console-escape.log" 2>&1; then
  cat "$smoke_root/console-escape.log"
  exit 1
fi
if grep -Eq "omapilot console escape probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError|ReferenceError" \
    "$smoke_root/console-escape.log" \
    || ! grep -Fq 'OMAPILOT_CONSOLE_ESCAPE_PROBE_OK' "$smoke_root/console-escape.log"; then
  cat "$smoke_root/console-escape.log"
  exit 1
fi

# The prompt row stops growing. Two drafts that both clear the cap have to
# produce the same height — a pixel count would only pin today's spacing scale.
cp "$repo_dir/tests/composer-growth-probe.qml" "$smoke_root/shell.qml"
if ! QT_QPA_PLATFORM=offscreen timeout 10s quickshell --no-duplicate \
    --path "$smoke_root" --no-color >"$smoke_root/composer-growth.log" 2>&1; then
  cat "$smoke_root/composer-growth.log"
  exit 1
fi
if grep -Eq "omapilot composer growth probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError|ReferenceError" \
    "$smoke_root/composer-growth.log" \
    || ! grep -Fq 'OMAPILOT_COMPOSER_GROWTH_PROBE_OK' "$smoke_root/composer-growth.log"; then
  cat "$smoke_root/composer-growth.log"
  exit 1
fi

# The console window with no compositor to talk to: D11, the decision that had
# been read and never executed. Unsetting the signature is what makes
# ConsolePlacement report itself unavailable, which is the whole point — on a
# machine with Hyprland running, this would quietly test the happy path instead.
cp "$repo_dir/tests/console-window-probe.qml" "$smoke_root/shell.qml"
if ! env -u HYPRLAND_INSTANCE_SIGNATURE QT_QPA_PLATFORM=offscreen timeout 15s \
    quickshell --no-duplicate --path "$smoke_root" --no-color \
    >"$smoke_root/console-window.log" 2>&1; then
  cat "$smoke_root/console-window.log"
  exit 1
fi
if grep -Eq "omapilot console window probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError|ReferenceError" \
    "$smoke_root/console-window.log" \
    || ! grep -Fq 'OMAPILOT_CONSOLE_WINDOW_PROBE_OK' "$smoke_root/console-window.log"; then
  cat "$smoke_root/console-window.log"
  exit 1
fi

# A text action end to end, through the real store: a protocol event in, the
# chooser standing with nothing sent, the chip the user pressed leaving as a
# prompt, and Replace aimed at the window the action was latched to. The broker
# path points at nothing so every command lands in queuedCommands, which is what
# lets this read back what would have gone over the wire.
cp "$repo_dir/tests/text-action-probe.qml" "$smoke_root/shell.qml"
if ! OMAPILOT_BROKER_PATH=/nonexistent/omapilot-broker QT_QPA_PLATFORM=offscreen \
    timeout 15s quickshell --no-duplicate --path "$smoke_root" --no-color \
    >"$smoke_root/text-action.log" 2>&1; then
  cat "$smoke_root/text-action.log"
  exit 1
fi
if grep -Eq "omapilot text action probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError|ReferenceError" \
    "$smoke_root/text-action.log" \
    || ! grep -Fq 'OMAPILOT_TEXT_ACTION_PROBE_OK' "$smoke_root/text-action.log"; then
  cat "$smoke_root/text-action.log"
  exit 1
fi

# The chooser as a surface renders it, against real buttons and the real
# theme. qmltestrunner cannot load anything importing qs.Ui, so this is where
# the six-line quote, the primary chip and the console's empty state are held.
cp "$repo_dir/tests/text-action-surface-probe.qml" "$smoke_root/shell.qml"
if ! QT_QPA_PLATFORM=offscreen timeout 15s quickshell --no-duplicate \
    --path "$smoke_root" --no-color >"$smoke_root/text-action-surface.log" 2>&1; then
  cat "$smoke_root/text-action-surface.log"
  exit 1
fi
if grep -Eq "omapilot text action surface probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError|ReferenceError" \
    "$smoke_root/text-action-surface.log" \
    || ! grep -Fq 'OMAPILOT_TEXT_ACTION_SURFACE_PROBE_OK' "$smoke_root/text-action-surface.log"; then
  cat "$smoke_root/text-action-surface.log"
  exit 1
fi

cp "$repo_dir/tests/response-activity-border-probe.qml" "$smoke_root/shell.qml"
if ! QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
    --path "$smoke_root" --no-color >"$smoke_root/motion.log" 2>&1; then
  cat "$smoke_root/motion.log"
  exit 1
fi
if grep -Eq "omapilot motion probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$smoke_root/motion.log" || ! grep -Fq 'OMAPILOT_MOTION_PROBE_OK' "$smoke_root/motion.log"; then
  cat "$smoke_root/motion.log"
  exit 1
fi

cp "$repo_dir/tests/voice-node-lifecycle-probe.qml" "$smoke_root/shell.qml"
if ! QT_QPA_PLATFORM=wayland timeout 5s quickshell --no-duplicate \
    --path "$smoke_root" --no-color >"$smoke_root/voice-node-lifecycle.log" 2>&1; then
  cat "$smoke_root/voice-node-lifecycle.log"
  exit 1
fi
if grep -Eq "omapilot voice node lifecycle probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$smoke_root/voice-node-lifecycle.log" \
    || ! grep -Fq 'OMAPILOT_VOICE_NODE_LIFECYCLE_PROBE_OK' "$smoke_root/voice-node-lifecycle.log"; then
  cat "$smoke_root/voice-node-lifecycle.log"
  exit 1
fi

cp "$repo_dir/tests/state-light-bar-lifecycle-probe.qml" "$smoke_root/shell.qml"
if ! QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
    --path "$smoke_root" --no-color >"$smoke_root/state-light-bar-lifecycle.log" 2>&1; then
  cat "$smoke_root/state-light-bar-lifecycle.log"
  exit 1
fi
if grep -Eq "omapilot state light bar lifecycle probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$smoke_root/state-light-bar-lifecycle.log" \
    || ! grep -Fq 'OMAPILOT_STATE_LIGHT_BAR_LIFECYCLE_PROBE_OK' \
      "$smoke_root/state-light-bar-lifecycle.log"; then
  cat "$smoke_root/state-light-bar-lifecycle.log"
  exit 1
fi

motion_frame_root="$smoke_root/motion-frames"
mkdir -p "$motion_frame_root"
cp "$repo_dir/tests/motion-preview.qml" "$smoke_root/shell.qml"
if ! OMAPILOT_MOTION_FRAME_DIR="$motion_frame_root" QT_QPA_PLATFORM=offscreen \
    timeout 5s quickshell --no-duplicate --path "$smoke_root" --no-color \
    >"$smoke_root/motion-preview.log" 2>&1; then
  cat "$smoke_root/motion-preview.log"
  exit 1
fi
if grep -Eq "omapilot motion preview failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$smoke_root/motion-preview.log" \
    || ! grep -Fq 'OMAPILOT_MOTION_PREVIEW_OK' "$smoke_root/motion-preview.log" \
    || [[ $(find "$motion_frame_root" -maxdepth 1 -type f -name 'frame-*.png' | wc -l) -ne 14 ]]; then
  cat "$smoke_root/motion-preview.log"
  exit 1
fi

state_frame_root="$smoke_root/state-frames"
mkdir -p "$state_frame_root"
cp "$repo_dir/tests/state-motion-preview.qml" "$smoke_root/shell.qml"
if ! OMAPILOT_STATE_FRAME_DIR="$state_frame_root" QT_QPA_PLATFORM=offscreen \
    timeout 7s quickshell --no-duplicate --path "$smoke_root" --no-color \
    >"$smoke_root/state-motion-preview.log" 2>&1; then
  cat "$smoke_root/state-motion-preview.log"
  exit 1
fi
if grep -Eq "omapilot state motion preview failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$smoke_root/state-motion-preview.log" \
    || ! grep -Fq 'OMAPILOT_STATE_MOTION_PREVIEW_OK' "$smoke_root/state-motion-preview.log" \
    || [[ $(find "$state_frame_root" -maxdepth 1 -type f -name 'state-*.png' | wc -l) -ne 8 ]]; then
  cat "$smoke_root/state-motion-preview.log"
  exit 1
fi

preview_root="$(mktemp -d)"
preview_output="$repo_dir/screenshots/implementation-omapilot-empty.png"
mkdir -p "$repo_dir/screenshots"
cp "$repo_dir/tests/visual-preview.qml" "$preview_root/shell.qml"
cp -a "$repo_dir/components" "$preview_root/components"
cp -a "$repo_dir/assets" "$preview_root/assets"
cp -a "$omarchy_shell/Commons" "$omarchy_shell/Ui" "$preview_root/"

OMAPILOT_PREVIEW_PATH="$preview_output" QT_QPA_PLATFORM=offscreen \
  timeout 5s quickshell --no-duplicate --path "$preview_root" --no-color \
  >"$preview_root/output.log" 2>&1
if grep -Eq "visual preview failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$preview_root/output.log" || [[ ! -s "$preview_output" ]]; then
  cat "$preview_root/output.log"
  exit 1
fi

preview_output="$repo_dir/screenshots/implementation-omapilot-dangerous-settings.png"
OMAPILOT_PREVIEW_STATE=dangerous-settings OMAPILOT_PREVIEW_PATH="$preview_output" \
  QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
  --path "$preview_root" --no-color >"$preview_root/settings-output.log" 2>&1
if grep -Eq "visual preview failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$preview_root/settings-output.log" || [[ ! -s "$preview_output" ]]; then
  cat "$preview_root/settings-output.log"
  exit 1
fi

for preview_state in settings skills-settings voice-settings desktop-settings actions-settings \
    setup-voice setup-hotkeys history waiting streaming error error-details context \
    console-empty console-streaming console-answer console-thread console-permission \
    console-history console-settings; do
  preview_output="$repo_dir/screenshots/implementation-omapilot-$preview_state.png"
  OMAPILOT_PREVIEW_STATE="$preview_state" OMAPILOT_PREVIEW_PATH="$preview_output" \
    QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
    --path "$preview_root" --no-color >"$preview_root/$preview_state-output.log" 2>&1
  if grep -Eq "visual preview failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
      "$preview_root/$preview_state-output.log" || [[ ! -s "$preview_output" ]]; then
    cat "$preview_root/$preview_state-output.log"
    exit 1
  fi
done

# The same content at the fullscreen surface's real geometry. Rendered separately
# because it is the same states at a different size, and because a sidebar layout
# stretched to 2560px renders without a single error while being unreadable —
# only looking at it catches that, so the states have to exist to be looked at.
for preview_state in console-answer console-thread console-permission console-settings; do
  preview_output="$repo_dir/screenshots/implementation-omapilot-fullscreen-${preview_state#console-}.png"
  OMAPILOT_PREVIEW_STATE="$preview_state" OMAPILOT_PREVIEW_PATH="$preview_output" \
    OMAPILOT_PREVIEW_WIDTH=2560 OMAPILOT_PREVIEW_HEIGHT=1405 \
    QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
    --path "$preview_root" --no-color >"$preview_root/fullscreen-$preview_state.log" 2>&1
  if grep -Eq "visual preview failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
      "$preview_root/fullscreen-$preview_state.log" || [[ ! -s "$preview_output" ]]; then
    cat "$preview_root/fullscreen-$preview_state.log"
    exit 1
  fi
done
