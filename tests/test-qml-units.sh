#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
omarchy_shell="${OMARCHY_PATH:-/usr/share/omarchy}/shell"
runner="${QMLTESTRUNNER:-/usr/lib/qt6/bin/qmltestrunner}"

if [[ ! -x $runner ]]; then
  printf 'qml unit gate: qmltestrunner unavailable at %s\n' "$runner" >&2
  exit 1
fi
if [[ ! -d $omarchy_shell ]]; then
  printf 'qml unit gate: Omarchy shell imports unavailable at %s\n' "$omarchy_shell" >&2
  exit 1
fi

for test_file in "$repo_root"/tests/tst_*.qml; do
  QT_QPA_PLATFORM=offscreen "$runner" \
    -input "$test_file" \
    -import "$repo_root" \
    -import "$omarchy_shell"
done

printf 'QML unit tests: ok\n'
