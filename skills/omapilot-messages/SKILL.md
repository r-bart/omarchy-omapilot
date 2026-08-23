---
name: omapilot-messages
description: Send Signal messages through OmaPilot's private loopback bridge. Use when the Messages capability is ready and the user provides exact recipients.
---

# OmaPilot messages

Use `capabilities` first if connector readiness is unknown. `signal_send` accepts exact phone numbers or group IDs; do not guess recipients or scrape them from unrelated content.

Signal sending is an external write. Assemble every recipient and the complete message, then let the one-time approval card show the final action. Never bypass the private loopback connector with browser automation or raw HTTP, and never claim delivery beyond the tool's acknowledgement that the bridge accepted the send.
