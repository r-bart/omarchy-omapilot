#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

if rg -n '\.(skip|todo)\(' runtime/test tests; then
  printf 'test contract: unconditional skip/todo found\n' >&2
  exit 1
fi

live_cases=$(rg -c 'it\.runIf\(' runtime/test | awk -F: '{ total += $2 } END { print total + 0 }')
if [[ $live_cases -ne 9 ]]; then
  printf 'test contract: expected exactly 9 declared live cases, found %s\n' "$live_cases" >&2
  exit 1
fi

printf 'Test contract: ok (9 explicit live cases)\n'
