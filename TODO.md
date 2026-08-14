# Quickchat implementation ledger

## Goal

Ship a public Omarchy Quattro bar-widget that provides themed, one-turn AI
answers through authenticated Codex, Claude, or OpenCode ACP agents; retains
the latest 30 answers; supports Voxtype dictation; and hands saved sessions to
a dedicated Herdr Quickchat workspace.

## Done criteria

- Root manifest validates with `omarchy plugin validate .`.
- Native bar widget and coordinated popout match the selected concept.
- Authenticated provider and harness-owned model discovery work.
- Answer and Web-only profiles fail closed; Tools is exposed only where host
  reads, credentials, network, and writes outside per-turn scratch are blocked.
- Markdown, safe links, direct images, and click-to-load remote images render.
- The newest 30 completed chats persist with bounded cached content.
- Voxtype file-output dictation and Herdr native/transcript handoff work.
- Focused tests, QML lint, independent review, and live Quattro verification pass.
- Repository, release assets, provenance, and marketplace documentation are public.

## Streams

| Stream | Branch/worktree | Owns | Status |
| --- | --- | --- | --- |
| QML surface | `quattro-ui` / `/home/sbull/worktrees/omarchy-quickchat-ui` | Bar widget, panel, components, QML tests | Implemented and integrated on `main` |
| ACP runtime | `broker-runtime` / `/home/sbull/worktrees/omarchy-quickchat-broker` | Broker, provider adapters, history, Herdr/Voxtype helpers, unit tests | Integrated and independently reviewed on `main` |
| Plugin/release | `plugin-compliance` / `/home/sbull/worktrees/omarchy-quickchat-compliance` | Manifest, docs, validation, CI/release packaging | Implemented and integrated on `main` |

## Allowed actions

- Create, test, commit, and push scoped branches in this repository.
- Install development dependencies locally within worktrees.
- Install the plugin into the current user's Quattro plugin directory for verification.
- Launch and interact with the local plugin, harnesses, Voxtype, and Herdr.

## Forbidden actions

- No sudo, production deployment, billing changes, secret rotation, or customer data.
- Do not modify `/home/sbull/omarchy`, Hyprland configuration, or unrelated user files.
- Do not expose auth output, tokens, or provider credentials.

## Gates

- [x] Inspect and merge all three stream diffs deliberately.
- [x] Static checks and focused tests pass at the current reviewed commit.
- [x] `omarchy plugin validate .` passes from a clean staged archive.
- [x] Independent review has no unresolved actionable findings.
- [x] Installed-shell open, submit/answer, history, dismissal/reopen, active-theme,
  narrow-layout, and Herdr flows are verified; stream/stop, error, and keyboard
  contracts pass the focused QML/runtime suites.
- [x] `design-qa.md` says `final result: passed`.
- [x] Public main branch and annotated-tag release assets are published.

## Release blockers

- [x] Reproduce and fix the owner-reported **Continue in Herdr** failure on the
  installed Quattro plugin. Do not accept command-construction tests or a
  single successful development probe as completion.
- [ ] Prove the complete handoff matrix in the live desktop: launch Herdr when
  closed; raise its existing window; create or reuse the Quickchat workspace;
  create and focus the intended tab; focus the intended agent pane; resume a
  native Codex, Claude, and OpenCode session where supported; repeat a handoff
  from the same chat without losing focus; and complete the transcript fallback
  when native resume is unavailable.
- [x] Capture the actual failing command/event and surface a truthful in-panel
  error when any Herdr launch, session, or focus stage fails.
- [x] Replace the blanket tool-free Answer/Web policy with an explicit,
  least-authority tool-call contract for harnesses that can prove the boundary;
  withhold Tools from any provider, currently Codex and OpenCode, that cannot prove an
  equivalent sandbox without exposing arbitrary local files, secrets, or
  unapproved MCP servers.
- [x] Add focused policy/protocol tests for allowed, denied, canceled, and
  malformed tool requests.
- [x] Prove at least one real installed-shell Claude tool call succeeds while a
  forbidden host-data read still fails closed.
- [ ] Re-run independent security review, full repository validation,
  deterministic runtime rebuild checks, installed-plugin update, and live
  computer-use validation before considering either regression closed.

## Active repair loop (2026-08-13)

- Orchestrator: current Herdr pane; owns architecture, integration, final diff,
  installation, and release decision.
- Tool-policy investigator: visible named Herdr worker; read-only; owns current
  ACP/provider permission-path analysis and a smallest-safe design proposal.
  Agent `qc_tool_policy`, pane `wK:p1G`; it opened tracked audit tab `wK:t11`
  with agent `qc_adapter_audit`. Orchestrator owns cleanup of both.
- Herdr investigator: visible named Herdr worker; read-only; owns reproduction
  evidence and the exact failing launch/focus/session stage. Agent
  `qc_herdr_debug`, pane `wK:p1H`; orchestrator owns cleanup.
- Independent reviewer: agent `qc_release_review`, tab `wK:t12`, pane `wK:p1K`;
  read-only security/regression review of the final candidate. Orchestrator owns
  cleanup.
- Final gate reviewer: agent `qc_final_gate`, tab `wK:t14`, pane `wK:p1N`;
  completed read-only review after installed computer-use validation with a
  final `CLEAN` verdict; orchestrator cleaned the tab.
- Forbidden during this loop: push, tag, release, marketplace submission,
  credential changes, provider configuration changes, microphone capture, or
  edits outside this repository and its installed plugin copy.

## Local actions and IPC repair loop (2026-08-14)

- Goal: replace the owner-observed `forbidden_tool_attempt` for exact local
  application-launch prompts with a broker-owned, explicit allow-once action;
  preserve tool-free Answer/Web and Claude's isolated Tools boundary.
- Done criteria: `open zoom` resolves only to an installed desktop entry,
  renders the exact application/action before execution, launches only after
  allow-once approval, rejects malformed/ambiguous/unsupported actions, and
  never passes model text to a shell.
- IPC criterion: one Quickchat IPC owner is registered across all monitors;
  `open`, `close`, `newChat`, and `history` remain callable after reload and
  shell restart without duplicate-handler warnings.
- Source/install criterion: focused and full suites pass, deterministic builds
  remain byte-identical, the installed tree matches the reviewed source, and
  CUA Driver proves the real panel action flow plus IPC open/close.
- Publication criterion: independent review is clean, the complete scoped diff
  is committed and pushed, CI is green, and the published revision is recorded.
- Orchestrator: current Herdr pane `wK:p2`; owns implementation, integration,
  installed validation, and publication.
- Architecture reviewer: visible named Claude agent `qc_action_arch`, pane
  `wK:p1R`; read-only; owns the smallest-safe action/IPC design review.
  Orchestrator owns cleanup.
- Forbidden: arbitrary shell approval, silent app launch, host-data access,
  changes outside this repository/installed plugin copy, credential changes,
  marketplace submission, or destructive user-data operations.

## Current repair evidence (2026-08-13)

- The earlier installed-shell Codex Tools evidence was invalidated: Codex
  read-only permits arbitrary host reads. Tools is now withheld from Codex and
  OpenCode instead of presenting that boundary as safe.
- The real authenticated Claude adapter ran an unpredictable `date +%s%N`
  command inside the fixed sandbox. A second exact, approved read of a random
  host-side file did not expose its contents in streamed events or the answer.
  The installed panel repeated both probes through real pointer/keyboard input:
  the command returned a dynamic nanosecond timestamp; the host read rendered
  its exact payload and approval controls above the detail, then failed without
  exposing or persisting the random secret.
- The installed provider/model controls exposed live Codex, Claude, and
  OpenCode catalogs. The final gate correctly withholds Tools from Codex and
  OpenCode while Claude exposes Tools alongside its live model catalog.
- Continue in Herdr raised the existing official-class window, focused the
  exact resumed Codex agent, and repeated the same handoff without adding a tab,
  pane, or duplicate agent. The test-created tab was removed afterward.
- Cold-launch and the full native/fallback provider matrix remain part of the
  unchecked live matrix gate because this repair loop itself is running inside
  Herdr and cannot safely close the host application.
- Final repository validation passed 88 runtime tests with three explicit live
  skips; the two live Claude boundary tests passed separately. QML passed 19/19,
  including ten reviewer repetitions of the queued-permission focus test.
  Independent final review is `CLEAN`; two isolated builds and packages were
  byte-identical (`f5e19b...0bcca`). The installed tree byte-matches the final
  source and its broker passed both real Claude probes directly. Activating the
  last QML/sandbox broadening in the existing shell process remains pending
  because Omarchy correctly refuses shell restart while the session is locked.

## Previously completed release evidence

- Before this regression, Continue in Herdr's installed Codex, Claude, and
  OpenCode native paths plus
  transcript fallback are verified cold, warm, repeated, and with exact window,
  workspace, tab, and agent-pane focus. The final installed OpenCode check used
  the actual panel button and left Herdr foregrounded on the reused focused
  agent (`focused: true`).
- Codex remains `on-request` while Quickchat rejects every ACP permission
  request; the live exact `/etc/hostname` denial probe passed with no streamed
  or persisted content.
- Release `v0.1.0` and its checksum, SBOM, and provenance assets are published.
- Marketplace submission requires the owner's approval of the exact issue body.
- The README uses a verified completed-answer capture from the installed active
  Omarchy theme.
- The checked-in runtime layout works after a plain Omarchy clone without hooks;
  final-tag CI rebuilt the archive twice and proved it deterministic.

## Post-v0.1: OmaAsk rebrand

- [ ] Approve the final `OmaAsk` capitalization, repository name, and public
  product copy before changing stable identifiers.
- [ ] Rebrand the visible shell surface, documentation, screenshots, package
  metadata, release assets, security contacts, and marketplace submission.
- [ ] Choose the replacement reverse-DNS plugin ID and provide an explicit
  migration for the existing Quickchat layout entry and per-provider settings.
- [ ] Migrate or compatibly discover Quickchat history, image cache, runtime
  paths, Herdr workspace labels, IPC targets, environment overrides, and broker
  client/protocol identifiers without abandoning user data.
- [ ] Validate update, rollback, clean install, removal, and marketplace
  behavior across both the old and new identities before retiring aliases.
