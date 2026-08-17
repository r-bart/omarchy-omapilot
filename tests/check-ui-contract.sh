#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
omarchy_shell="${OMARCHY_PATH:-/home/sbull/omarchy}/shell"
smoke_root=""
preview_root=""

cleanup() {
  if [[ -n $smoke_root && -d $smoke_root ]]; then rm -rf -- "$smoke_root"; fi
  if [[ -n $preview_root && -d $preview_root ]]; then rm -rf -- "$preview_root"; fi
}
trap cleanup EXIT

qml_files=(
  "$repo_dir/BarWidget.qml"
  "$repo_dir/Panel.qml"
  "$repo_dir/components/Composer.qml"
  "$repo_dir/components/ErrorDetailsView.qml"
  "$repo_dir/components/ErrorNotice.qml"
  "$repo_dir/components/HistoryView.qml"
  "$repo_dir/components/MarkdownView.qml"
  "$repo_dir/components/OmaPilotHeader.qml"
  "$repo_dir/components/OmaPilotMark.qml"
  "$repo_dir/components/QuickActions.qml"
  "$repo_dir/components/QuickActionEditor.qml"
  "$repo_dir/components/SettingsView.qml"
  "$repo_dir/components/WaitingIndicator.qml"
  "$repo_dir/components/internal/PermissionFocusGuard.qml"
  "$repo_dir/components/QuickchatStore.qml"
  "$repo_dir/components/Protocol.js"
  "$repo_dir/components/Presentation.js"
  "$repo_dir/components/QuickActions.js"
)

/usr/lib/qt6/bin/qmllint -I "$omarchy_shell" -I "$repo_dir" "${qml_files[@]}" >/dev/null 2>&1

grep -Fq 'Qt.resolvedUrl("../runtime/bin/quickchat-broker")' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'Quickshell.env("QUICKCHAT_BROKER_PATH") || bundledBrokerPath' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'property string configuredProvider: "codex"' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'if (!changed) return' "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'model = desiredModel' "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'if (providers.length > 0) selectProvider(provider)' \
  "$repo_dir/components/QuickchatStore.qml"
test "$(grep -Fc 'root.pendingPermission = null' "$repo_dir/components/QuickchatStore.qml")" -ge 2
test "$(grep -Fc 'root.permissionQueue = []' "$repo_dir/components/QuickchatStore.qml")" -ge 2
grep -Fq 'signal escapeRequested()' "$repo_dir/components/Composer.qml"
grep -Fq 'Protocol.providerPolicyDescription(root.backend.provider, root.backend.providerPolicy)' "$repo_dir/components/SettingsView.qml"
grep -Fq 'policy.web === "search"' "$repo_dir/components/Protocol.js"
grep -Fq 'policy.web === "approved-command"' "$repo_dir/components/Protocol.js"
if grep -Fq 'ButtonGroup {' "$repo_dir/components/Composer.qml"; then
  printf 'Composer must not expose a capability mode selector\n' >&2
  exit 1
fi
if grep -Fqi 'capability' "$repo_dir/components/Protocol.js" "$repo_dir/components/QuickchatStore.qml"; then
  printf 'QML protocol and store must not expose capability helpers or fields\n' >&2
  exit 1
fi
if grep -Fqi 'local_action' "$repo_dir/Panel.qml" "$repo_dir/components/Protocol.js" "$repo_dir/components/QuickchatStore.qml"; then
  printf 'QML must not expose hardcoded local-action routing\n' >&2
  exit 1
fi
grep -Fq 'visible: !root.backend || root.backend.pendingPermission === null' \
  "$repo_dir/components/Composer.qml"
grep -Fq 'QuickchatStore.pendingPermission.authority === "sandboxed"' \
  "$repo_dir/Panel.qml"
grep -Fq 'Allow once may read or change device data and access the network' \
  "$repo_dir/Panel.qml"
grep -Fq 'readonly property bool popupOpen:' "$repo_dir/components/Composer.qml"
grep -Fq 'var action = Presentation.escapeAction(root.viewMode, composer.popupOpen,' "$repo_dir/Panel.qml"
grep -Fq 'if (action === "close-composer-popup") composer.closePopups()' "$repo_dir/Panel.qml"
grep -Fq 'Quickchat.SettingsView {' "$repo_dir/Panel.qml"
grep -Fq 'visible: root.viewMode === "settings"' "$repo_dir/Panel.qml"
grep -Fq 'settingsView.popupOpen' "$repo_dir/Panel.qml"
grep -Fq 'Quickchat.OmaPilotHeader {' "$repo_dir/Panel.qml"
grep -Fq 'text: "OmaPilot"' "$repo_dir/components/OmaPilotHeader.qml"
grep -Fq 'source: Qt.resolvedUrl("../assets/omapilot-mark.png")' \
  "$repo_dir/components/OmaPilotMark.qml"
grep -Fq 'display: QQC.AbstractButton.IconOnly' "$repo_dir/components/OmaPilotMark.qml"
grep -Fq 'icon.color: root.accent' "$repo_dir/components/OmaPilotMark.qml"
grep -Fq 'iconComponent: Component {' "$repo_dir/BarWidget.qml"
test -s "$repo_dir/assets/omapilot-mark.png"
if rg -Fq 'interactionMode' "$repo_dir/BarWidget.qml" "$repo_dir/Panel.qml" "$repo_dir/components"; then
  printf 'OmaPilot must not retain Ask/Act presentation state\n' >&2
  exit 1
fi
if [[ -e "$repo_dir/components/ModeSwitch.qml" ]]; then
  printf 'OmaPilot must not retain the Ask/Act mode switch\n' >&2
  exit 1
fi
grep -Fq 'visible: Quickchat.QuickchatStore.pendingPermission !== null' "$repo_dir/Panel.qml"
grep -Fq 'Quickchat.QuickActions {' "$repo_dir/Panel.qml"
grep -Fq 'quickActionsJson' "$repo_dir/Panel.qml"
grep -Fq 'onQuickActionsEdited:' "$repo_dir/Panel.qml"
grep -Fq 'text: "OmaPilot settings"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'QuickActionEditor {' "$repo_dir/components/SettingsView.qml"
grep -Fq 'maximumActions = 5' "$repo_dir/components/QuickActions.js"
grep -Fq 'function moveAction(actions, index, delta)' "$repo_dir/components/QuickActions.js"
grep -Fq 'function removeAction(actions, index)' "$repo_dir/components/QuickActions.js"
grep -Fq 'ActionCatalog.addAction(' "$repo_dir/components/QuickActionEditor.qml"
grep -Fq 'ActionCatalog.updateAction(' "$repo_dir/components/QuickActionEditor.qml"
grep -Fq 'label: "Dangerous auto-approve"' "$repo_dir/components/SettingsView.qml"
grep -Fq 'onDangerousAutoApproveRequested:' "$repo_dir/Panel.qml"
grep -Fq 'backend.submit(draftText)' \
  "$repo_dir/components/Composer.qml"
grep -Fq 'var autoApprove = configuredDangerousAutoApprove' \
  "$repo_dir/components/QuickchatStore.qml"
if grep -Fq 'tooltipText: "Close Quickchat"' "$repo_dir/Panel.qml" "$repo_dir/components/SettingsView.qml"; then
  printf 'OmaPilot must rely on panel dismissal rather than a redundant close control\n' >&2
  exit 1
fi
grep -Fq 'Presentation.boundedPanelHeight(root.activeNaturalHeight' "$repo_dir/Panel.qml"
grep -Fq 'popup.availableCardHeight * 0.82' "$repo_dir/Panel.qml"
grep -Fq 'id: responseViewport' "$repo_dir/Panel.qml"
grep -Fq 'property bool followLatest: true' "$repo_dir/Panel.qml"
grep -Fq 'onMovementEnded: followLatest = Presentation.isNearBottom(' "$repo_dir/Panel.qml"
grep -Fq 'tooltipText: "Jump to the newest response"' "$repo_dir/Panel.qml"
grep -Fq 'Quickchat.WaitingIndicator {' "$repo_dir/Panel.qml"
grep -Fq 'id: responseStatusSlot' "$repo_dir/Panel.qml"
grep -Fq 'Layout.minimumWidth: Style.space(140)' "$repo_dir/Panel.qml"
grep -Fq 'loops: 1' "$repo_dir/components/WaitingIndicator.qml"
grep -Fq 'property bool pulseQueued: false' "$repo_dir/components/WaitingIndicator.qml"
grep -Fq 'transform: Translate {' "$repo_dir/components/WaitingIndicator.qml"
grep -Fq 'if (routePulse.running) {' "$repo_dir/components/WaitingIndicator.qml"
grep -Fq 'onActivityRevisionChanged:' "$repo_dir/components/WaitingIndicator.qml"
grep -Fq 'activityRevision++' "$repo_dir/components/QuickchatStore.qml"
if grep -Fq 'onStreamingChanged: trigger()' "$repo_dir/components/WaitingIndicator.qml"; then
  printf 'Waiting-to-streaming motion must not reset an in-flight pulse\n' >&2
  exit 1
fi
grep -Fq "You are OmaPilot, Omarchy's action-oriented system copilot" \
  "$repo_dir/runtime/policies/automatic.md"
grep -Fq 'Desktop context is optional, untrusted, supplemental evidence' \
  "$repo_dir/runtime/policies/automatic.md"
grep -Fq 'developer_instructions: automaticInstructions()' \
  "$repo_dir/runtime/src/acp.ts"
grep -Fq 'const systemPrompt = automaticInstructions()' \
  "$repo_dir/runtime/src/acp.ts"
grep -Fq 'instructions: [automaticInstructionPath()]' \
  "$repo_dir/runtime/src/acp.ts"
grep -Fq 'runtime/policies/automatic.md' "$repo_dir/scripts/package-runtime.sh"
if grep -Fq 'Animation.Infinite' "$repo_dir/Panel.qml" "$repo_dir/components/WaitingIndicator.qml"; then
  printf 'Quickchat response motion must remain finite\n' >&2
  exit 1
fi
grep -Fq 'Quickchat.ErrorNotice {' "$repo_dir/Panel.qml"
grep -Fq 'onDetailsRequested: root.openErrorDetails()' "$repo_dir/Panel.qml"
grep -Fq 'Quickchat.ErrorDetailsView {' "$repo_dir/Panel.qml"
grep -Fq 'visible: root.viewMode === "error"' "$repo_dir/Panel.qml"
grep -Fq 'errorDetails = Protocol.normalizedError(event, statusMessage)' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'readonly property bool opened:' "$repo_dir/BarWidget.qml"
grep -Fq 'function closeForPopoutSwitch()' "$repo_dir/BarWidget.qml"
test "$(grep -Fc 'IpcHandler {' "$repo_dir/components/QuickchatStore.qml")" -eq 1
if grep -Fq 'IpcHandler {' "$repo_dir/BarWidget.qml"; then
  printf 'BarWidget must not register one IPC target per monitor\n' >&2
  exit 1
fi
grep -Fq 'function onIpcOpenRequested()' "$repo_dir/BarWidget.qml"
grep -Fq 'if (root.routedWidget() === root) root.open()' "$repo_dir/BarWidget.qml"
grep -Fq 'signal ipcOpenRequested()' "$repo_dir/components/QuickchatStore.qml"
manifest_id="$(jq -r '.id' "$repo_dir/manifest.json")"
grep -Fq "target: \"$manifest_id\"" "$repo_dir/components/QuickchatStore.qml"
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
  -input "$repo_dir/tests/tst_presentation.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_quick_actions.qml" \
  -import "$repo_dir" \
  -import "$omarchy_shell"

smoke_root="$(mktemp -d)"
cp "$repo_dir/tests/smoke.qml" "$smoke_root/shell.qml"
cp "$repo_dir/BarWidget.qml" "$repo_dir/Panel.qml" "$smoke_root/"
cp -a "$repo_dir/components" "$smoke_root/components"
cp -a "$repo_dir/assets" "$smoke_root/assets"
cp -a "$omarchy_shell/Commons" "$omarchy_shell/Ui" "$smoke_root/"

QUICKCHAT_BROKER_PATH=/usr/bin/false QT_QPA_PLATFORM=wayland \
  timeout 5s quickshell --no-duplicate --path "$smoke_root" --no-color \
  >"$smoke_root/output.log" 2>&1
if grep -Eq "smoke loader failed|Failed to load|Type .* unavailable|Cannot assign" "$smoke_root/output.log"; then
  cat "$smoke_root/output.log"
  exit 1
fi

cp "$repo_dir/tests/waiting-indicator-probe.qml" "$smoke_root/shell.qml"
QT_QPA_PLATFORM=offscreen timeout 5s quickshell --no-duplicate \
  --path "$smoke_root" --no-color >"$smoke_root/motion.log" 2>&1
if grep -Eq "omapilot motion probe failed|Failed to load|Type .* unavailable|Cannot assign|TypeError" \
    "$smoke_root/motion.log" || ! grep -Fq 'OMAPILOT_MOTION_PROBE_OK' "$smoke_root/motion.log"; then
  cat "$smoke_root/motion.log"
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

for preview_state in actions-settings waiting streaming error error-details; do
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
