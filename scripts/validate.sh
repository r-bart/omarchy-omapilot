#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

./scripts/check-manifest.sh
./tests/test-hotkey-installer.sh
node ./browser-companion/scripts/check.mjs

if command -v shellcheck >/dev/null && shellcheck --version >/dev/null 2>&1; then
  mapfile -t shell_files < <(find scripts browser-companion -type f \
    \( -name '*.sh' -o -name 'omapilot-browser-companion-host' \) -print | sort)
  shell_files+=(tests/test-hotkey-installer.sh)
  shellcheck "${shell_files[@]}"
else
  printf 'validate: shellcheck unavailable; skipping shell lint\n' >&2
fi

node --check browser-companion/extension/background.js
node --check browser-companion/extension/picker.js
node --check browser-companion/extension/popup.js
node --check browser-companion/native-host/host.mjs

if command -v qmllint >/dev/null; then
  mapfile -t qml_files < <(find . -path './node_modules' -prune -o -path './dist' -prune -o -type f -name '*.qml' -print | sort)
  if ((${#qml_files[@]})); then
    qmllint "${qml_files[@]}"
  fi
else
  printf 'validate: qmllint unavailable; skipping QML lint\n' >&2
fi

if [[ -f package.json ]]; then
  ./scripts/check-release-metadata.sh
  npm run check
else
  printf 'validate: package.json unavailable; skipping broker checks\n' >&2
fi

stage_parent=$(mktemp -d "${TMPDIR:-/tmp}/omapilot-validate.XXXXXX")
trap 'rm -rf -- "$stage_parent"' EXIT
stage="$stage_parent/plugin"
mkdir -p "$stage"
tar -C "$repo_root" \
  --exclude=./.git --exclude=./node_modules --exclude=./dist --exclude=./.cache --exclude=./.tmp \
  -cf - . | tar -C "$stage" -xf -

if command -v omarchy-plugin-validate >/dev/null; then
  omarchy-plugin-validate "$stage"
elif command -v omarchy >/dev/null; then
  omarchy plugin validate "$stage"
else
  printf 'validate: Omarchy validator unavailable; manifest-only validation completed\n' >&2
fi

printf 'Repository validation: ok\n'
