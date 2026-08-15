# Security policy

## Supported versions

Security fixes are provided for the current Quickchat release.

## Trust model

Omarchy plugins run unsandboxed inside the long-lived `omarchy-shell` process. Review Quickchat before enabling it. Quickchat minimizes that authority by delegating provider traffic to a separate broker process and starting each agent with one provider-specific, fail-closed automatic policy.

- Codex starts in read-only, on-request mode with native web search disabled and only the
  strictly validated shell/unified-exec features. It may read any file the current user can
  read without asking. Tool output is sent to Codex and may be retained in the
  saved answer. A request for broader access pauses behind the adapter-normalized
  command and working directory, and only its provider-native allow-once or
  reject-once decision is exposed.
  Approval can execute the command outside the read-only sandbox with the
  current user's authority, including host reads, state changes, and network
  access; the UI states this explicitly. Persistent grants are never exposed.
- Claude runs inside a disposable workspace that denies
  every existing top-level host path except system executable/library roots,
  hides credential-bearing environment variables, and confines writes to
  per-turn scratch. WebSearch is available, while WebFetch and direct process
  network access remains blocked. Commands inside that fixed boundary may run
  automatically; a surfaced approval does not weaken the hard sandbox.
- OpenCode may use only its positively identified websearch tool. Direct fetch
  and device commands remain withheld because its current ACP path cannot prove an
  inspectable allow-once handshake without raw tool-call markup.
- Oversized requests and control or bidirectional-display characters fail
  closed rather than being truncated.
- Arbitrary MCP, browser/computer control, unclassified requests, and requests
  without an inspectable target are denied. Codex may edit, delete, move, or otherwise
  mutate user-accessible state only after exact allow-once command approval.
- Provider authentication remains in the installed harness. Quickchat must not log, copy, or persist credential output.
- Adapter bundles are generated from exact package-lock versions and reviewed as tracked files in the same Git commit as their source. Published release archives add SHA-256 verification, provenance, and an SBOM; the runtime does not download or replace adapters.
- Remote images require a user action and are subject to scheme, redirect, address, MIME, byte-size, complete decode, pixel-area, and cache-quota checks before Quickshell sees them.
- External links are allowlisted by scheme and are never passed through shell interpolation.
- The broker does not regex-classify prompts or implement action-specific
  shortcuts. Every ordinary question and action request follows the selected
  harness's same fixed policy and permission boundary.
- Permission prompts and raw tool input/output are ephemeral and are not copied
  to the completed chat record. The model's completed answer may contain
  tool-derived text and is retained normally. Provider stderr and raw tool
  output never cross the broker boundary.

The Quickchat boundary ends when the user selects **Continue in Herdr**. Herdr
then owns the native harness session and its normal interactive permission
model. Quickchat does not claim that a continued session remains tool-free.

This boundary reduces accidental authority; it is not an OS sandbox. A compromised plugin repository or verified runtime release would execute with the current user's permissions.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for `spencerbull/omarchy-quickchat`. Do not open a public issue for an exploitable finding or include credentials, prompts, transcripts, or tokens in a report.

Include the Quickchat version, Omarchy revision, provider, relevant logs with secrets removed, and a minimal reproduction. Receipt should be acknowledged within seven days; publication and remediation timing depend on severity and coordinated disclosure needs.
