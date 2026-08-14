# Security policy

## Supported versions

Security fixes are provided for the current Quickchat release.

## Trust model

Omarchy plugins run unsandboxed inside the long-lived `omarchy-shell` process. Review Quickchat before enabling it. Quickchat minimizes that authority by delegating provider traffic to a separate broker process and starting each agent with a fail-closed capability profile.

- Answer mode denies every tool and external capability.
- Web mode permits only a provider capability positively identified as web search or fetch.
- Tools mode is currently available only through Claude. Commands run inside a
  disposable, network-disabled workspace that denies every existing top-level
  host path except system executable/library roots, hides credential-bearing
  environment variables, and confines writes to per-turn
  scratch space. Commands inside that fixed boundary may run automatically.
  Permission requests are presented with their complete exact provider payload
  for an explicit decision, but approval does not weaken the hard sandbox.
  Only the provider's allow-once
  option can be selected; persistent grants are never exposed. Oversized
  requests and control or bidirectional-display characters fail closed rather
  than being truncated.
- Tools is withheld from Codex and OpenCode because their current ACP paths
  cannot prove that local reads are confined away from host data.
- Editing, deletion, moving files, arbitrary MCP, browser/computer control,
  unclassified requests, and requests without an inspectable target are denied
  in every mode. Answer and Web continue to deny filesystem and shell access.
- Provider authentication remains in the installed harness. Quickchat must not log, copy, or persist credential output.
- Adapter bundles are generated from exact package-lock versions and reviewed as tracked files in the same Git commit as their source. Published release archives add SHA-256 verification, provenance, and an SBOM; the runtime does not download or replace adapters.
- Remote images require a user action and are subject to scheme, redirect, address, MIME, byte-size, complete decode, pixel-area, and cache-quota checks before Quickshell sees them.
- External links are allowlisted by scheme and are never passed through shell interpolation.
- Exact application-launch prompts are handled outside ACP. Quickchat matches
  only the anchored verbs `open`, `launch`, and `start`, resolves one exact
  visible desktop entry, shows the resolved name and desktop ID, and requires a
  default-deny allow-once decision. Approval uses the host-native detached
  `uwsm-app -- gtk-launch <desktop-id>` argv path. A bounded detached
  `gio launch <desktop-file>` argv fallback is used only when UWSM/GTK launch is
  unavailable. Prompt text, desktop-entry `Exec` fields, and model output never
  become shell input. Missing, ambiguous, hidden, compound, or unsafe entries
  are not intercepted and remain subject to the harness capability policy.
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
