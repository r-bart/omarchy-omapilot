#!/usr/bin/env bash
set -euo pipefail

companion_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
extension_root="$companion_root/extension"
dist_root="$companion_root/dist"

for family in chromium firefox; do
  destination="$dist_root/$family"
  mkdir -p "$destination"
  cp "$extension_root/background.js" "$extension_root/picker.js" \
    "$extension_root/popup.html" "$extension_root/popup.js" \
    "$extension_root/popup.css" "$destination/"
  cp "$extension_root/manifest.$family.json" "$destination/manifest.json"
done

printf 'Browser companion builds: %s\n' "$dist_root"
