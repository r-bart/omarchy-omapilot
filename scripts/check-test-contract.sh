#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

if command -v rg >/dev/null 2>&1; then
  if rg -n '\.(skip|todo)\(' runtime/test tests; then
    printf 'test contract: unconditional skip/todo found\n' >&2
    exit 1
  fi
  live_cases=$(rg -c 'it\.runIf\(' runtime/test | awk -F: '{ total += $2 } END { print total + 0 }')
else
  # GitHub's base runner does not guarantee ripgrep. This gate is deliberately
  # runnable before apt dependencies are installed, so its correctness cannot
  # depend on a developer convenience binary.
  if grep -REn '\.(skip|todo)\(' runtime/test tests; then
    printf 'test contract: unconditional skip/todo found\n' >&2
    exit 1
  fi
  live_cases=$(grep -RhoF 'it.runIf(' runtime/test | wc -l)
fi
if [[ $live_cases -ne 9 ]]; then
  printf 'test contract: expected exactly 9 declared live cases, found %s\n' "$live_cases" >&2
  exit 1
fi

printf 'Test contract: ok (9 explicit live cases)\n'
