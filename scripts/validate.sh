#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

./scripts/check-manifest.sh
./scripts/check-test-contract.sh
./tests/test-hotkey-installer.sh
node ./browser-companion/scripts/check.mjs

shellcheck_bin="${OMAPILOT_SHELLCHECK:-}"
if [[ -z $shellcheck_bin ]]; then shellcheck_bin=$(command -v shellcheck || true); fi
if [[ -n $shellcheck_bin && -x $shellcheck_bin ]] && "$shellcheck_bin" --version >/dev/null 2>&1; then
  mapfile -t shell_files < <(find scripts browser-companion tests -type f \
    \( -name '*.sh' -o -name 'omapilot-browser-companion-host' \) -print | sort)
  "$shellcheck_bin" "${shell_files[@]}"
else
  printf 'validate: ShellCheck is required (set OMAPILOT_SHELLCHECK to its executable)\n' >&2
  exit 1
fi

node --check browser-companion/extension/background.js
node --check browser-companion/extension/picker.js
node --check browser-companion/extension/popup.js
node --check browser-companion/native-host/host.mjs

if [[ -f package.json ]]; then
  ./scripts/check-release-metadata.sh
  # The QML gate owns the correct Omarchy import paths, curated lint surface,
  # unit suites, and live Wayland probes. Running bare qmllint over every
  # preview file produces thousands of false missing-import warnings and proves
  # less than this contract does.
  npm run test:qml
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
