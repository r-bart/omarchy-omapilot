#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
omarchy_shell="${OMARCHY_PATH:-/home/sbull/omarchy}/shell"

qml_files=(
  "$repo_dir/BarWidget.qml"
  "$repo_dir/Panel.qml"
  "$repo_dir/components/Composer.qml"
  "$repo_dir/components/HistoryView.qml"
  "$repo_dir/components/MarkdownView.qml"
  "$repo_dir/components/internal/PermissionFocusGuard.qml"
  "$repo_dir/components/QuickchatStore.qml"
  "$repo_dir/components/DesktopContext.qml"
  "$repo_dir/components/Protocol.js"
)

/usr/lib/qt6/bin/qmllint -I "$omarchy_shell" -I "$repo_dir" "${qml_files[@]}" >/dev/null 2>&1

grep -Fq 'Qt.resolvedUrl("../runtime/bin/quickchat-broker")' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'Quickshell.env("QUICKCHAT_BROKER_PATH") || bundledBrokerPath' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'property string configuredProvider: "codex"' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'property bool desktopContextEnabled: true' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'DesktopContext.snapshot()' "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'Protocol.hasFeature(event.features, "desktop-context")' "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'import Quickshell.Hyprland' "$repo_dir/components/DesktopContext.qml"
grep -Fq 'import Quickshell.Services.Mpris' "$repo_dir/components/DesktopContext.qml"
awk '
  /^[[:space:]]*function / { latched = 0 }
  /Quickchat\.QuickchatStore\.latchDesktopContext\(\)/ { latched = 1 }
  /root\.controller\.show\(\)/ { if (!latched) exit 1; shows += 1 }
  END { if (shows < 3) exit 1 }
' "$repo_dir/Panel.qml"
awk '
  /^[[:space:]]*function / { cleared = 0 }
  /Quickchat\.QuickchatStore\.clearDesktopContextLatch\(\)/ { cleared = 1 }
  /root\.controller\.hide\(\)/ { if (!cleared) exit 1; hides += 1 }
  END { if (hides < 2) exit 1 }
' "$repo_dir/Panel.qml"
awk '
  /function desktopContextForSubmit\(\)/ { inside = 1; gated = 0 }
  inside && /if \(!desktopContextActive\) return null/ { gated = 1 }
  inside && /DesktopContext\.snapshot\(\)/ { if (!gated) exit 1; found = 1; exit }
  END { if (!found) exit 1 }
' "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'latchedActiveWindow = context && context.activeWindow ? context.activeWindow : null' \
  "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'if (!changed) return' "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'model = desiredModel' "$repo_dir/components/QuickchatStore.qml"
grep -Fq 'if (providers.length > 0) selectProvider(provider)' \
  "$repo_dir/components/QuickchatStore.qml"
test "$(grep -Fc 'root.pendingPermission = null' "$repo_dir/components/QuickchatStore.qml")" -ge 2
test "$(grep -Fc 'root.permissionQueue = []' "$repo_dir/components/QuickchatStore.qml")" -ge 2
grep -Fq 'signal escapeRequested()' "$repo_dir/components/Composer.qml"
grep -Fq 'Protocol.providerPolicyDescription(root.backend.provider, root.backend.providerPolicy)' "$repo_dir/components/Composer.qml"
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
if grep -Eq 'sandboxed|Device commands stay blocked|sandbox limits stay active' \
  "$repo_dir/Panel.qml" "$repo_dir/components/Protocol.js"; then
  printf 'QML permission copy must not retain unreachable legacy policy branches\n' >&2
  exit 1
fi
grep -Fq 'Allow once may read or change device data and access the network' \
  "$repo_dir/Panel.qml"
grep -Fq 'readonly property bool popupOpen:' "$repo_dir/components/Composer.qml"
grep -Fq 'if (composer.popupOpen) composer.closePopups()' "$repo_dir/Panel.qml"
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

smoke_root="$(mktemp -d)"
cp "$repo_dir/tests/smoke.qml" "$smoke_root/shell.qml"
cp "$repo_dir/BarWidget.qml" "$repo_dir/Panel.qml" "$smoke_root/"
cp -a "$repo_dir/components" "$smoke_root/components"
cp -a "$omarchy_shell/Commons" "$omarchy_shell/Ui" "$smoke_root/"

QUICKCHAT_BROKER_PATH=/usr/bin/false QT_QPA_PLATFORM=wayland \
  timeout 5s quickshell --no-duplicate --path "$smoke_root" --no-color \
  >"$smoke_root/output.log" 2>&1
if grep -Eq "smoke loader failed|Failed to load|Type .* unavailable|Cannot assign" "$smoke_root/output.log"; then
  cat "$smoke_root/output.log"
  exit 1
fi
