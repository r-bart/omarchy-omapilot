#!/usr/bin/env bash
set -euo pipefail

mode="${1:-all}"

require_elevenlabs_key() {
  local key="${ELEVEN_LABS_API_KEY:-}"
  if [[ ${#key} -lt 8 ]]; then
    printf 'ELEVEN_LABS_API_KEY must be set for the live TTS gate\n' >&2
    exit 2
  fi
}

case "$mode" in
  codex)
    OMAPILOT_LIVE_CODEX_BEHAVIOR=1 npx vitest run runtime/test/codex-live.test.ts
    ;;
  opencode)
    OMAPILOT_LIVE_OPENCODE_BEHAVIOR=1 npx vitest run runtime/test/opencode-live.test.ts
    ;;
  tts)
    require_elevenlabs_key
    npx vitest run runtime/test/tts.test.ts -t 'probes a real ElevenLabs key'
    ;;
  all)
    "$0" codex
    "$0" opencode
    "$0" tts
    ;;
  *)
    printf 'usage: %s [all|codex|opencode|tts]\n' "$0" >&2
    exit 2
    ;;
esac
