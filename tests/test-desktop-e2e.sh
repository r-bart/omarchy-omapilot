#!/usr/bin/env bash
set -euo pipefail

runs=3
if [[ ${1:-} == --once ]]; then runs=1; shift; fi
if (($#)); then
  printf 'usage: %s [--once]\n' "$0" >&2
  exit 2
fi

for ((run = 1; run <= runs; run++)); do
  printf 'Desktop E2E run %d/%d\n' "$run" "$runs"
  node tests/text-action-browser-e2e.mjs
  OMAPILOT_E2E_ELECTRON=1 node tests/text-action-browser-e2e.mjs
  node tests/text-action-gtk-e2e.mjs
  node tests/text-action-qt-e2e.mjs
  node tests/text-action-terminal-e2e.mjs
done

printf 'Desktop E2E: ok (%d run(s), Chromium + Electron + GTK4 + Qt + terminal safety)\n' "$runs"
