#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
installer="$repo_root/scripts/install-hotkeys.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/omapilot-hotkeys-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT

export HOME="$test_root/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_STATE_HOME="$HOME/.local/state"
export OMAPILOT_HOTKEYS_NO_RELOAD=1
bindings="$XDG_CONFIG_HOME/hypr/bindings.lua"
mkdir -p -- "$(dirname -- "$bindings")"

assert_absent() {
  local needle="$1"
  local file="$2"
  if grep -Fq -- "$needle" "$file"; then
    printf 'unexpected text in %s: %s\n' "$file" "$needle" >&2
    exit 1
  fi
}

cat >"$bindings" <<'LUA'
-- Existing user configuration.
o.bind("SUPER + A", "My existing assistant", "my-assistant")
LUA

"$installer" --once --installed-plugin-only
[[ ! -e $XDG_STATE_HOME/omapilot/hotkeys-v1 ]]
assert_absent '-- BEGIN OmaPilot managed hotkeys' "$bindings"

installed_dir="$HOME/.config/omarchy/plugins/io.github.spencerbull.omapilot"
installed_installer="$installed_dir/scripts/install-hotkeys.sh"
mkdir -p -- "$(dirname -- "$installed_installer")"
cp -- "$installer" "$installed_installer"
chmod 0755 "$installed_installer"

"$installed_installer" --once --installed-plugin-only
first_checksum=$(sha256sum "$bindings")
"$installed_installer" --once --installed-plugin-only
second_checksum=$(sha256sum "$bindings")
[[ $first_checksum == "$second_checksum" ]]

test "$(grep -Fc -- '-- BEGIN OmaPilot managed hotkeys' "$bindings")" -eq 1
test "$(grep -Fc -- 'o.bind("SUPER + A", "My existing assistant"' "$bindings")" -eq 1
assert_absent 'o.bind("SUPER + A", "Talk to OmaPilot"' "$bindings"
grep -Fq -- 'hl.unbind("SUPER + SHIFT + A")' "$bindings"
grep -Fq -- 'io.github.spencerbull.omapilot newVoiceChat' "$bindings"
grep -Fq -- 'io.github.spencerbull.omapilot newChat' "$bindings"
grep -Fq -- 'io.github.spencerbull.omapilot continueInHerdr' "$bindings"
grep -Fxq -- 'installed' "$XDG_STATE_HOME/omapilot/hotkeys-v1"

"$installed_installer" --force
grep -Fq -- 'o.bind("SUPER + A", "Talk to OmaPilot"' "$bindings"
test "$(grep -Fc -- '-- BEGIN OmaPilot managed hotkeys' "$bindings")" -eq 1

"$installed_installer" --remove
grep -Fq -- 'My existing assistant' "$bindings"
assert_absent '-- BEGIN OmaPilot managed hotkeys' "$bindings"
grep -Fxq -- 'removed' "$XDG_STATE_HOME/omapilot/hotkeys-v1"

"$installed_installer" --once --installed-plugin-only
assert_absent '-- BEGIN OmaPilot managed hotkeys' "$bindings"

"$installed_installer"
assert_absent 'o.bind("SUPER + A", "Talk to OmaPilot"' "$bindings"
test "$(grep -Fc -- '-- BEGIN OmaPilot managed hotkeys' "$bindings")" -eq 1

"$installed_installer" --remove
printf '%s\n' '-- BEGIN OmaPilot managed hotkeys' >>"$bindings"
if "$installed_installer" 2>/dev/null; then
  printf 'expected malformed marker check to fail\n' >&2
  exit 1
fi

printf 'Hotkey installer tests: ok\n'
