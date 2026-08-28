#!/usr/bin/env bash
# One text-action round, driven from a shell instead of a pointer: read what is
# selected, ask OmaPilot to correct it, wait for the answer, accept it.
#
# The point is repeatability. Replacing text is the one part of the feature
# whose behaviour is decided by the widget receiving the keystrokes, so it has
# to be run against many widgets, and running it by hand each time is how
# results end up inconsistent.
#
# Select text in the target window, then run this from anywhere. Nothing here
# touches the regular clipboard.
#
# OMAPILOT_ACTION picks which of the direct routes to drive; they are the ones
# that skip the chooser, which is what makes the round scriptable at all. The
# free prompt is not here because it is typed into the composer.
set -euo pipefail

plugin="io.github.spencerbull.omapilot"
timeout_seconds="${OMAPILOT_LAB_TIMEOUT:-90}"
action="${OMAPILOT_ACTION:-fixSelection}"

say() { printf '%s\n' "$*" >&2; }

case "$action" in
  fixSelection | rewriteSelection | translateSelection) ;;
  *)
    say "OMAPILOT_ACTION must be fixSelection, rewriteSelection or translateSelection"
    exit 1
    ;;
esac

command -v omarchy-shell >/dev/null || { say "omarchy-shell is not on PATH"; exit 1; }
command -v wl-paste >/dev/null || { say "wl-paste is not installed"; exit 1; }

selection=$(wl-paste --primary --no-newline 2>/dev/null || true)
if [[ -z ${selection//[[:space:]]/} ]]; then
  say "Nothing is selected. Select text in the target window first."
  exit 1
fi
say "action    : ${action}"
say "selection : ${selection}"

# Fires the same route the hotkey does, so the surface the user configured is
# the one that opens.
omarchy-shell "$plugin" "$action" >/dev/null

deadline=$((SECONDS + timeout_seconds))
state=""
while ((SECONDS < deadline)); do
  state=$(omarchy-shell "$plugin" status 2>/dev/null || true)
  case "$state" in
    store=complete) break ;;
    store=error | store=unavailable) say "stopped: $state"; exit 1 ;;
  esac
  sleep 0.4
done

if [[ $state != "store=complete" ]]; then
  say "timed out after ${timeout_seconds}s waiting for an answer (last: ${state:-none})"
  exit 1
fi

# Accepting is deliberately separate: an answer that is prose about the
# correction rather than the correction should not be typed into a document,
# and this is the step a human would refuse.
result=$(omarchy-shell "$plugin" replaceSelection 2>/dev/null || true)
say "replace   : ${result:-no answer}"

case "$result" in
  ok) ;;
  no-text-action) say "There was no live text action to accept."; exit 1 ;;
  *) say "Unexpected reply from the plugin."; exit 1 ;;
esac
