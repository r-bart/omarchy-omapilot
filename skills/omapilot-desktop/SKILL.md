---
name: omapilot-desktop
description: Control installed apps, Hyprland windows, workspaces, monitors, and window sizing through OmaPilot's structured desktop tools. Use for app launching or focus and for exact desktop arrangement requests.
---

# OmaPilot desktop control

Use the structured desktop tools when they cover the request. They validate exact targets, preserve the approval boundary, and return verified action receipts.

## Apps

1. Search with `app_catalog`; do not guess an app ID.
2. If several results plausibly match, ask the user to choose.
3. Call `app_open` with the exact result and the narrowest mode:
   - `focus_or_launch` for the normal personal-assistant behavior;
   - `focus_existing` when launching a copy would be wrong; or
   - `new_window` only when the user asked for another window.
4. Treat `verified: false` as failure even if the launch command itself exited successfully.

Use `open_url` for a URL. Use `bash` and its normal approval flow when a CLI request needs arguments or shell composition; `app_open` launches only an exact catalog entry.

## Web research handoff

Use `web_handoff` when the user needs current external information and no native search tool can return it inside OmaPilot. It opens the exact question in the search provider selected under **Settings → Desktop → Search provider**. Google and DuckDuckGo receive a search query; ChatGPT Search, Claude, and Grok also receive a paste-ready prompt on the clipboard in case their web composer does not prefill it.

This is an interactive browser handoff, not a search result. Report only that the provider was opened. Never claim to have read, synthesized, or verified the browser's answer. Use `open_url` instead when the user supplied a specific URL.

## Windows and workspaces

1. Read `desktop_state` immediately before choosing a target. Window titles are private by default; request them only when class and workspace are insufficient to identify the user's intended window.
2. Use the exact window address and PID, workspace number, or monitor name returned by that state. Never carry an address across turns or guess one from prior context.
3. Perform one `window_action` or `workspace_action`. The tool re-reads pre-state after approval and verifies post-state itself.
4. Report completion only when the returned receipt has `verified: true`. If the target disappeared, became ambiguous, or verification failed, say the action did not complete.

Prefer desired-state operations such as `set_floating` over toggles. Do not use raw `hyprctl dispatch` through `bash` for focus, workspace movement, resizing, floating state, or close actions that the structured tools support.

The current structured surface does not control fullscreen, maximized, grouping, pinning, scratchpads, or arbitrary layout messages. Explain that limitation instead of bypassing the structured boundary unless the user explicitly asks for an advanced raw command and approves it.
