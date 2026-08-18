#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
action=install
development=0
build=1
while (($#)); do
  case "$1" in
    install|uninstall|status) action=$1 ;;
    --development) development=1 ;;
    --no-build) build=0 ;;
    -h|--help) action=help ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

host_name="io.github.spencerbull.omapilot_browser"
install_root="${XDG_DATA_HOME:-$HOME/.local/share}/omapilot/browser-companion"
host_path="$install_root/omapilot-browser-companion-host"
extension_path="$repo_root/browser-companion/dist/chromium"
chromium_id="fhphgomajpimcnpfjjgfgamnlnopahmd"
firefox_id="omapilot-browser-companion@spencerbull.dev"

chromium_dirs=(
  "$HOME/.config/chromium"
  "$HOME/.config/google-chrome"
  "$HOME/.config/google-chrome-beta"
  "$HOME/.config/google-chrome-unstable"
  "$HOME/.config/BraveSoftware/Brave-Browser"
  "$HOME/.config/BraveSoftware/Brave-Browser-Beta"
  "$HOME/.config/BraveSoftware/Brave-Browser-Nightly"
  "$HOME/.config/microsoft-edge"
  "$HOME/.config/microsoft-edge-dev"
)

flag_specs=(
  "chromium:$HOME/.config/chromium-flags.conf"
  "google-chrome-stable:$HOME/.config/chrome-flags.conf"
  "brave:$HOME/.config/brave-flags.conf"
  "brave-origin:$HOME/.config/brave-origin-flags.conf"
  "microsoft-edge-stable:$HOME/.config/microsoft-edge-stable-flags.conf"
)

usage() {
  printf 'Usage: %s [install|uninstall|status] [--development]\n' "${0##*/}"
}

require_install_tools() {
  command -v jq >/dev/null || { printf 'jq is required\n' >&2; exit 1; }
  command -v node >/dev/null || { printf 'Node.js is required\n' >&2; exit 1; }
}

write_manifests() {
  local manifest directory
  manifest=$(jq -n --arg path "$host_path" --arg origin "chrome-extension://$chromium_id/" '{
    name:"io.github.spencerbull.omapilot_browser",
    description:"OmaPilot browser companion relay",
    path:$path,
    type:"stdio",
    allowed_origins:[$origin]
  }')
  for directory in "${chromium_dirs[@]}"; do
    mkdir -p "$directory/NativeMessagingHosts"
    printf '%s\n' "$manifest" >"$directory/NativeMessagingHosts/$host_name.json"
  done
  directory="$HOME/.mozilla/native-messaging-hosts"
  mkdir -p "$directory"
  jq -n --arg path "$host_path" --arg extension "$firefox_id" '{
    name:"io.github.spencerbull.omapilot_browser",
    description:"OmaPilot browser companion relay",
    path:$path,
    type:"stdio",
    allowed_extensions:[$extension]
  }' >"$directory/$host_name.json"
}

edit_load_extension() {
  local mode=$1 file=$2 temporary
  mkdir -p "$(dirname -- "$file")"
  [[ -f $file ]] || : >"$file"
  temporary=$(mktemp "${TMPDIR:-/tmp}/omapilot-flags.XXXXXX")
  awk -v mode="$mode" -v extension="$extension_path" '
    BEGIN { handled = 0 }
    index($0, "--load-extension=") == 1 {
      count = split(substr($0, length("--load-extension=") + 1), values, ",")
      output = ""
      found = 0
      for (index_value = 1; index_value <= count; index_value++) {
        if (values[index_value] == extension) { found = 1; if (mode == "remove") continue }
        output = output (output == "" ? "" : ",") values[index_value]
      }
      if (mode == "add" && !found) output = output (output == "" ? "" : ",") extension
      if (output != "") print "--load-extension=" output
      handled = 1
      next
    }
    { print }
    END { if (mode == "add" && !handled) print "--load-extension=" extension }
  ' "$file" >"$temporary"
  chmod --reference="$file" "$temporary"
  mv -- "$temporary" "$file"
}

install_companion() {
  require_install_tools
  if ((build)); then
    "$repo_root/browser-companion/scripts/build.sh"
  elif [[ ! -f $extension_path/manifest.json || ! -f $repo_root/browser-companion/dist/firefox/manifest.json ]]; then
    printf 'Browser companion builds are missing; run the installer without --no-build\n' >&2
    exit 1
  fi
  mkdir -p "$install_root"
  cp "$repo_root/browser-companion/native-host/host.mjs" "$install_root/host.mjs"
  cp "$repo_root/browser-companion/native-host/omapilot-browser-companion-host" "$host_path"
  chmod 0755 "$host_path" "$install_root/host.mjs"
  write_manifests
  if ((development)); then
    local spec command_name flags_file
    for spec in "${flag_specs[@]}"; do
      command_name=${spec%%:*}
      flags_file=${spec#*:}
      if command -v "$command_name" >/dev/null || [[ -f $flags_file ]]; then
        edit_load_extension add "$flags_file"
        printf 'Development extension enabled in %s\n' "$flags_file"
      fi
    done
  fi
  printf 'OmaPilot browser relay installed at %s\n' "$install_root"
  printf 'Chromium build: %s\n' "$extension_path"
  printf 'Firefox build: %s\n' "$repo_root/browser-companion/dist/firefox"
  if ((!development)); then
    printf 'Load the matching extension build in your browser, then click its toolbar icon once per enabled site.\n'
  else
    printf 'Restart Chromium-family browsers, pin the OmaPilot extension, and enable the current site.\n'
  fi
}

uninstall_companion() {
  local directory spec flags_file
  for directory in "${chromium_dirs[@]}"; do
    rm -f -- "$directory/NativeMessagingHosts/$host_name.json"
    rmdir --ignore-fail-on-non-empty "$directory/NativeMessagingHosts" 2>/dev/null || true
  done
  rm -f -- "$HOME/.mozilla/native-messaging-hosts/$host_name.json"
  rmdir --ignore-fail-on-non-empty "$HOME/.mozilla/native-messaging-hosts" 2>/dev/null || true
  for spec in "${flag_specs[@]}"; do
    flags_file=${spec#*:}
    [[ -f $flags_file ]] && edit_load_extension remove "$flags_file"
  done
  rm -f -- "$host_path" "$install_root/host.mjs"
  rmdir --ignore-fail-on-non-empty "$install_root" 2>/dev/null || true
  printf 'OmaPilot browser companion registration removed. Browser-granted site permissions may be removed with the extension.\n'
}

status_companion() {
  [[ -x $host_path ]] && printf 'Native relay: installed (%s)\n' "$host_path" || printf 'Native relay: not installed\n'
  [[ -f $extension_path/manifest.json ]] && printf 'Chromium extension: built (%s)\n' "$extension_path" || printf 'Chromium extension: not built\n'
  [[ -f $HOME/.mozilla/native-messaging-hosts/$host_name.json ]] && printf 'Firefox registration: installed\n' || printf 'Firefox registration: not installed\n'
}

case "$action" in
  install) install_companion ;;
  uninstall) uninstall_companion ;;
  status) status_companion ;;
  help) usage ;;
  *) usage >&2; exit 2 ;;
esac
