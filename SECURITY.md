# Security policy

## Supported versions

Security fixes are provided for the current Quickchat release. Until the first public release, the repository should be treated as development software.

## Trust model

Omarchy plugins run unsandboxed inside the long-lived `omarchy-shell` process. Review Quickchat before enabling it. Quickchat minimizes that authority by delegating provider traffic to a separate broker process and starting each agent with a fail-closed capability profile.

- Answer mode denies every tool and external capability.
- Web mode permits only a provider capability positively identified as web search or fetch.
- Filesystem, shell, editing, arbitrary MCP, and unclassified permissions are denied in both modes.
- Provider authentication remains in the installed harness. Quickchat must not log, copy, or persist credential output.
- Adapter bundles are pinned per Quickchat release and accepted only after SHA-256 verification.
- Remote images require a user action and are subject to scheme, redirect, address, MIME, byte-size, and decoded-dimension checks.
- External links are allowlisted by scheme and are never passed through shell interpolation.

This boundary reduces accidental authority; it is not an OS sandbox. A compromised plugin repository or verified runtime release would execute with the current user's permissions.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for `spencerbull/omarchy-quickchat`. Do not open a public issue for an exploitable finding or include credentials, prompts, transcripts, or tokens in a report.

Include the Quickchat version, Omarchy revision, provider, relevant logs with secrets removed, and a minimal reproduction. Receipt should be acknowledged within seven days; publication and remediation timing depend on severity and coordinated disclosure needs.
