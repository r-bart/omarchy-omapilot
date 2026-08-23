---
name: omapilot-meetings
description: Open an exact Zoom meeting through OmaPilot and the configured Omarchy browser handler. Use when the user asks to join a Zoom meeting and a meeting URL is known.
---

# OmaPilot meetings

Use `capabilities` first if connector readiness is unknown. Call `meeting_join` only with an exact HTTPS `zoom.us` meeting URL supplied by the user or obtained from a trusted user-authorized calendar lookup.

Opening the meeting is a visible device action and requires approval. Do not guess meeting URLs, copy access details into unrelated services, or claim the user joined successfully; the tool proves only that Omarchy opened the reviewed Zoom URL.
