#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
omarchy_shell="${OMARCHY_PATH:-/usr/share/omarchy}/shell"
preview_root=$(mktemp -d)

cleanup() {
  rm -rf -- "$preview_root"
}
trap cleanup EXIT

for required in \
  "$omarchy_shell/Commons" \
  "$omarchy_shell/Ui" \
  "$repo_root/tests/visual-preview.qml"; do
  [[ -e $required ]] || {
    printf 'render-preview: missing %s\n' "$required" >&2
    exit 1
  }
done

cp "$repo_root/tests/visual-preview.qml" "$preview_root/shell.qml"
cp -a "$repo_root/components" "$preview_root/components"
cp -a "$repo_root/assets" "$preview_root/assets"
cp -a "$omarchy_shell/Commons" "$omarchy_shell/Ui" "$preview_root/"

output="${1:-$repo_root/preview.png}"
preview_state="${OMAPILOT_PREVIEW_STATE:-empty}"
OMAPILOT_PREVIEW_STATE="$preview_state" \
OMAPILOT_PREVIEW_PATH="$output" \
QT_QPA_PLATFORM=offscreen \
  timeout 5s quickshell --no-duplicate --path "$preview_root" --no-color \
  >"$preview_root/output.log" 2>&1

if grep -Eq 'visual preview failed|Failed to load|Type .* unavailable|Cannot assign|TypeError' \
    "$preview_root/output.log" || [[ ! -s $output ]]; then
  cat "$preview_root/output.log" >&2
  exit 1
fi

printf 'Rendered %s\n' "$output"
