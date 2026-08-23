#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

fail() {
  printf 'check-release-metadata: %s\n' "$*" >&2
  exit 1
}

for relative in manifest.json package.json package-lock.json runtime/adapters.release.json \
  runtime/policies/automatic.md \
  runtime/licenses/earendil-works-pi-0.84.2-MIT.txt \
  runtime/licenses/data-uri-to-buffer-4.0.1-MIT.txt \
  runtime/licenses/ignore-5.3.2-MIT.txt \
  runtime/licenses/ignore-7.0.5-MIT.txt \
  runtime/licenses/ignore-7.0.6-MIT.txt \
  runtime/dist/omapilot-broker \
  runtime/dist/omapilot-broker.LEGAL.txt \
  runtime/dist/omapilot-broker.THIRD_PARTY_LICENSES.txt \
  runtime/dist/capability-mcp.js \
  runtime/dist/adapters/codex-acp \
  runtime/dist/adapters/Apache-2.0.txt \
  THIRD_PARTY_NOTICES.md; do
  [[ -f "$repo_root/$relative" ]] || fail "missing $relative"
done

[[ -x "$repo_root/runtime/dist/omapilot-broker" ]] || fail "broker launcher is not executable"
[[ -x "$repo_root/runtime/dist/adapters/codex-acp" ]] || fail "Codex ACP launcher is not executable"
command -v file >/dev/null || fail "file is required"
command -v readelf >/dev/null || fail "readelf is required"
for launcher in runtime/dist/omapilot-broker runtime/dist/adapters/codex-acp; do
  file "$repo_root/$launcher" | grep -Fq 'ELF 64-bit LSB executable, x86-64' || {
    fail "$launcher is not a Linux x86-64 ELF executable"
  }
  readelf -W -h "$repo_root/$launcher" | grep -Fq 'Machine:                           Advanced Micro Devices X86-64' || {
    fail "$launcher has an unexpected ELF machine"
  }
  if readelf -W -l "$repo_root/$launcher" | grep -Eq '^[[:space:]]*INTERP'; then
    fail "$launcher unexpectedly uses a dynamic interpreter"
  fi
  if readelf -W -d "$repo_root/$launcher" | grep -Fq '(NEEDED)'; then
    fail "$launcher unexpectedly uses a dynamic dependency"
  fi
  readelf -W -l "$repo_root/$launcher" | grep -Fq 'GNU_STACK' || {
    fail "$launcher does not declare its stack policy"
  }
  if readelf -W -l "$repo_root/$launcher" | grep 'GNU_STACK' | grep -Eq '[[:space:]]E[[:space:]]'; then
    fail "$launcher requests an executable stack"
  fi
  if readelf -W -l "$repo_root/$launcher" | grep -E '^[[:space:]]*LOAD' | grep -Eq '[[:space:]]W[[:space:]]'; then
    fail "$launcher contains a writable load segment"
  fi
done
for stale in runtime/dist/omapilot-broker.js runtime/dist/omapilot-broker.js.map \
  runtime/dist/capability-mcp.js.map runtime/dist/adapters/codex-acp.js; do
  [[ ! -e "$repo_root/$stale" ]] || fail "stale text bundle remains: $stale"
done

grep -Fq 'OmaPilot bundled broker third-party licenses' \
  "$repo_root/runtime/dist/omapilot-broker.THIRD_PARTY_LICENSES.txt" || {
  fail "bundled broker third-party license inventory is invalid"
}

command -v jq >/dev/null || fail "jq is required"

manifest_version=$(jq -r '.version' "$repo_root/manifest.json")
package_version=$(jq -r '.version' "$repo_root/package.json")
[[ $manifest_version == "$package_version" ]] || {
  fail "manifest version $manifest_version does not match package version $package_version"
}

while IFS=$'\t' read -r provider package version executable; do
  [[ -n $provider && -n $package && -n $version && -n $executable ]] || {
    fail "adapter lock contains an incomplete entry"
  }
  package_version=$(jq -r --arg package "$package" '.dependencies[$package] // empty' "$repo_root/package.json")
  locked_version=$(jq -r --arg path "node_modules/$package" '.packages[$path].version // empty' "$repo_root/package-lock.json")
  [[ $package_version == "$version" ]] || {
    fail "$provider adapter is $version in adapter metadata but $package_version in package.json"
  }
  [[ $locked_version == "$version" ]] || {
    fail "$provider adapter is $version in adapter metadata but $locked_version in package-lock.json"
  }
  grep -Fq -- "$package@$version" "$repo_root/THIRD_PARTY_NOTICES.md" || {
    fail "$package@$version is missing from THIRD_PARTY_NOTICES.md"
  }
done < <(jq -r '.adapters | to_entries[] | [.key, .value.package, .value.version, .value.executable] | @tsv' "$repo_root/runtime/adapters.release.json")

if grep -Eqi 'claude (acp|agent)|claude-agent-acp|anthropic' \
  "$repo_root/README.md" "$repo_root/SECURITY.md" "$repo_root/THIRD_PARTY_NOTICES.md" \
  "$repo_root/docs/architecture.md" "$repo_root/docs/native-harness.md" >/dev/null; then
  fail "release documentation still advertises the removed Claude harness"
fi

if git -C "$repo_root" ls-files --stage | awk '$1 == "120000" { found=1 } END { exit !found }'; then
  fail "tracked symlinks are incompatible with the Omarchy plugin validator"
fi

printf 'Release metadata: ok\n'
