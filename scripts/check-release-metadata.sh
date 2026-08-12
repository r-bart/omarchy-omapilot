#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

fail() {
  printf 'check-release-metadata: %s\n' "$*" >&2
  exit 1
}

for relative in manifest.json package.json package-lock.json runtime/adapters.release.json THIRD_PARTY_NOTICES.md; do
  [[ -f "$repo_root/$relative" ]] || fail "missing $relative"
done

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

if git -C "$repo_root" ls-files --stage | awk '$1 == "120000" { found=1 } END { exit !found }'; then
  fail "tracked symlinks are incompatible with the Omarchy plugin validator"
fi

printf 'Release metadata: ok\n'
