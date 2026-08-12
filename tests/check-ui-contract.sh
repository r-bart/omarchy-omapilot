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
  "$repo_dir/components/QuickchatStore.qml"
  "$repo_dir/components/Protocol.js"
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
grep -Fq 'signal escapeRequested()' "$repo_dir/components/Composer.qml"
grep -Fq 'readonly property bool popupOpen:' "$repo_dir/components/Composer.qml"
grep -Fq 'if (composer.popupOpen) composer.closePopups()' "$repo_dir/Panel.qml"
grep -Fq 'readonly property bool opened:' "$repo_dir/BarWidget.qml"
grep -Fq 'function closeForPopoutSwitch()' "$repo_dir/BarWidget.qml"
if grep -Fq 'Accessible.name: plainText' "$repo_dir/components/MarkdownView.qml"; then
  printf 'MarkdownView uses TextEdit.plainText, which is unavailable in Qt Quick\n' >&2
  exit 1
fi

QT_QPA_PLATFORM=offscreen /usr/lib/qt6/bin/qmltestrunner \
  -input "$repo_dir/tests/tst_protocol.qml" \
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
