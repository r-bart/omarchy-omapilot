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
- One automatic provider policy chooses web/tools as needed, states its
  authority truthfully, and keeps every broader command behind an inspectable,
  request-bound allow-once boundary.
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

## Automatic interaction goal (2026-08-15)

- Goal: remove the user-facing Answer/Web/Tools profiles. A user selects only a
  harness/model, writes one prompt, and the broker supplies that harness's
  reviewed web/tool policy automatically.
- Product contract: there is no capability picker, retry-in-Tools instruction,
  or capability field in new submit/history records. Provider-specific
  authority remains truthful: Codex may read user-readable device files while
  network and broader commands require exact Allow once; Claude may search the
  web and run commands only in disposable scratch; OpenCode may answer and
  search the web but fetch/device commands remain fail-closed until its ACP path
  can prove the same inspectable approval boundary. The broker does not parse
  prompt phrases into hardcoded actions; every ordinary prompt uses the same
  provider path.
- Done criteria: legacy history still loads; one-prompt Codex and Claude command
  use, web policy, OpenCode denial, permission nonce/expiry/cancel behavior,
  Markdown/history/Herdr, and provider/model persistence pass focused tests;
  the complete suite and deterministic bundle pass; independent review has no
  unresolved findings; a draft PR is open and its CI is green.
- Branch/worktree: `automatic-capabilities` at
  `/home/sbull/worktrees/omarchy-quickchat-automatic`, based on `main` commit
  `ff93db8`. The orchestrator owns implementation and integration.
- Allowed: scoped repository edits, local dependencies/tests, commits, push of
  this branch, and a draft PR to `spencerbull/omarchy-quickchat:main`.
- Forbidden: merge, tag, release, marketplace submission, installed-plugin or
  desktop mutation, provider credential/configuration changes, CUA, secrets,
  billing, and user-data operations.
- Reviewer: existing visible Claude Herdr agent `qc_action_arch`, pane `wK:p1R`,
  main checkout, read-only design and final diff review; orchestrator owns
  follow-up and cleanup.
- Test migration worker: visible Codex Herdr agent `qc_auto_tests`, pane
  `wK:p1X`, automatic worktree/branch; owns test fixtures and assertions only,
  with no commit/push/install authority. Orchestrator owns diff review and
  cleanup.
- [x] Approve the automatic provider-policy design against current ACP adapters.
- [x] Remove capability selection from QML, protocol, persistence, and public
  documentation while accepting legacy stored records safely.
- [x] Prove automatic Codex/Claude tools and web policy plus fail-closed OpenCode.
- [x] Pass focused QML/runtime tests, full validation, and deterministic build.
- [x] Receive independent `CLEAN` review or fix every verified finding.
- [x] Push the branch, open the draft PR, and pass exact-head CI.

Final evidence: `./scripts/validate.sh` passes 105 runtime tests with
six explicit live skips; the QML contract passes 17 protocol and three
permission-focus tests; authenticated direct tests pass Codex automatic
read-only plus one exact allow-once command, Claude automatic scratch command,
host-read denial, and WebSearch, and OpenCode automatic websearch. The OpenCode
test covers its live ACP `other`/`websearch` identity plus fail-closed
reclassification. Two consecutive broker builds are byte-identical and
`npm audit --omit=dev` reports zero vulnerabilities. Independent Claude review
found one Medium and one Low; both were fixed in `3ef737d`, and the exact-fix
re-review returned `CLEAN`. Draft PR
<https://github.com/spencerbull/omarchy-quickchat/pull/1> targets `main`; its
validate/package workflow is required green on the final PR head. No CUA,
installed plugin, desktop configuration, release, or marketplace state was
changed.

## Submit-time desktop context (2026-08-15)

- Goal: attach the useful context Omarchy already exposes—active window, open
  windows/workspaces, and playing media—to each new request without adding a
  mode, prompt classifier, polling daemon, or browser-control dependency.
- Done criteria: the snapshot uses public Quickshell APIs, is visibly disclosed
  and default-on with an Omarchy setting, is bounded/sanitized/strictly
  validated, reaches the ACP prompt, never replaces the stored original
  question, and does not change provider tool authority. README/security docs
  describe provider retention honestly and record the optional OmaAsk Browser
  Companion as future work. Focused/full suites, deterministic bundle checks,
  and independent review must pass.
- Branch/worktree: `desktop-context` at
  `/home/sbull/worktrees/omarchy-quickchat-context`, based on merged `main`
  commit `caa2439`. The orchestrator owns implementation and integration.
- Allowed: scoped source/docs/tests/build-artifact edits and local validation.
  Forbidden: merge, tag, release, installed-plugin mutation, browser extension
  installation, desktop control, provider configuration, or credential access.
- Reviewer: visible Claude Herdr agent `qc_context_review`, pane `wK:p2F`,
  read-only design and final diff review; the orchestrator owns cleanup.
- [x] Define the bounded versioned context contract and privacy boundary.
- [x] Capture submit-time Hyprland/MPRIS context with no polling.
- [x] Add a default-on Omarchy setting and in-composer disclosure.
- [x] Document current behavior and the future OmaAsk browser companion.
- [x] Pass focused QML/runtime tests and full repository validation.
- [x] Receive an independent clean review or fix every verified finding.

Current evidence: QML contract passes 22 protocol and three permission-focus
tests plus a real Wayland smoke load. `./scripts/validate.sh` passes 122 runtime
tests with six explicit live-provider skips; production dependency audit has
zero vulnerabilities; two consecutive broker builds are byte-identical.
Claude reviewer `qc_context_review` fuzzed 60,000 QML-to-broker snapshots and
found no validation mismatch or question mutation. Its BiDi, stale-latch,
contract-test, and feature-type findings were fixed; the bounded re-review was
`CLEAN`. Remaining live-only checks are active-window latching under real panel
focus, playing MPRIS metadata, focused-monitor routing, and one real context
turn per provider.

## Installed skills and generic provider tools (2026-08-16)

- Goal: make every selected harness discover the user's relevant installed
  skills and request ordinary tools when useful, with no Tools mode, prompt
  classifier, or hardcoded app/action mappings.
- Product contract: read-only skill loading is available automatically. Any
  command that can affect the device crosses the existing exact-command,
  request-bound **Allow once** boundary. Persistent grants, opaque commands,
  arbitrary MCP servers, subagents, and unreviewable filesystem mutations stay
  fail-closed. A completed answer must not claim an action succeeded unless the
  harness returned a successful tool result.
- Done criteria: Codex, Claude, and OpenCode each prove installed-skill
  discovery; each provider can complete a harmless generic command through its
  documented authority boundary; deny, timeout, cancellation, malformed input,
  duplicate/stale decisions, and false-success behavior have regression tests;
  full validation and deterministic bundles pass; an independent review is
  clean; a PR targets `main` with green exact-head CI; the reviewed candidate is
  installed locally only after those gates.
- Branch/worktree: `provider-tools` at
  `/home/sbull/worktrees/omarchy-quickchat-context`, based on merged `main`
  `caa2439` with desktop context preserved as commit `271966f`. The orchestrator
  owns implementation, integration, publication, and local installation.
- Allowed: scoped source/docs/tests/build edits; local authenticated
  non-destructive provider probes; commits; push; PR creation; CI inspection;
  reviewed local plugin installation. Forbidden: merge, tag, release,
  marketplace submission, provider credential/configuration changes, CUA,
  secrets, billing, production/customer data, hardcoded app mappings, or edits
  outside this repo and the installed Quickchat copy.
- Architecture/review worker: visible Claude Herdr agent `qc_tools_arch`, pane
  `wK:p2N`, same worktree/branch, read-only design and final-diff review. The
  orchestrator owns follow-up and cleanup.
- Independent release-gate worker: visible Claude Herdr agent
  `qc_tools_review`, pane `wK:p2Q`, read-only review of the exact candidate.
  Its first verdict found no blocker; documentation and the live Claude
  no-approval host-boundary regression are being re-reviewed after remediation.
- Architecture evidence: the worker identified OpenCode wildcard precedence,
  inherited process cwd, non-composing timeouts, remote skill/MCP supply-chain
  risks, and Claude skill-source isolation. The candidate now enumerates and
  validates effective OpenCode permissions, starts providers at `/`, keeps the
  60-second approval timeout inside a 180-second turn, disables remote skill
  URLs/configured MCP, and supplies Claude skills without user settings.
- [x] Approve one provider-neutral skill/tool and action-integrity contract.
  One checked-in instruction drives skill selection and truthful action status;
  structured ACP permissions, never prompt classification, own authority.
- [x] Implement provider wiring and exact OpenCode/Claude device approval.
  Codex enables only shell/unified-exec/skill-search; Claude uses a disposable
  MCP-free installed-skill plugin plus sandbox/device escalation; OpenCode
  proves its resolved deny table, disables project config/MCP, and correlates
  bash approval by tool-call ID.
- [x] Add focused policy, protocol, permission, and false-success regressions.
  Source tests cover automatic skill identity, allow/deny, missing approval,
  opaque/reclassified tools, unsafe Claude skill trees, and an empty-answer
  truthful denial fallback; existing lifecycle suites cover timeout, cancel,
  duplicate IDs, and stale permission decisions.
- [x] Pass full validation plus authenticated non-GUI provider probes.
  `./scripts/validate.sh` passed 130 tests with 12 opt-in skips and rebuilt
  dist; the complete authenticated matrix passed 12/12: installed Omarchy
  skill loading, harmless approved commands for all providers, Claude/OpenCode
  web behavior, Claude scratch execution, Claude denied host-file isolation,
  and OpenCode denied-command integrity.
  Two release archives from the same tree were byte-identical. Their SHA-256
  stays out-of-band because the archive provenance embeds the commit and Node
  version; a hash committed into this ledger would necessarily describe its
  parent tree rather than the commit containing it.
- [x] Receive a clean independent final review or fix every verified finding.
  `qc_tools_review` returned CLEAN for `271966f..a773559`; its medium findings
  were resolved and the exact remediation tree passed source/dist and package
  parity checks.
- [x] Push, open the PR, pass exact-head CI, and install the reviewed candidate.
  PR #3 targets `main`; GitHub Actions run 34 passed validation and packaging at
  reviewed code SHA `a72436c`. That payload is installed at
  `~/.config/omarchy/plugins/io.github.spencerbull.quickchat`; the installed
  broker returned protocol 2, three providers, and `desktop-context` before a
  lock-guarded shell restart. `shell.json` remained byte-identical, preserving
  the center placement and provider/model settings. Rollback snapshot:
  `~/.local/state/omarchy-quickchat-backups/20260816-1428-before-a72436c`.

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
  least-authority tool-call contract for harnesses that can prove the boundary.
  Codex Tools discloses its device-readable authority and requires exact
  allow-once approval for commands; Claude remains scratch-sandboxed; OpenCode
  remains withheld because it cannot prove an equivalent boundary.
- [x] Add focused policy/protocol tests for allowed, denied, canceled, and
  malformed tool requests.
- [x] Prove at least one real installed-shell Claude tool call succeeds while a
  forbidden host-data read still fails closed.
- [x] Re-run independent security review, full repository validation,
  deterministic runtime rebuild checks, installed-plugin update, and real ACP
  plus broker-protocol validation before considering either regression closed.
- [ ] Complete the owner's installed-panel usage check; automated CUA validation
  is intentionally paused at the owner's request.

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

- Goal: replace the owner-observed `forbidden_tool_attempt` for generic Codex
  command use with its pinned ACP adapter's exact allow-once flow; preserve
  tool-free Answer/Web, Claude's isolated Tools boundary, and OpenCode's
  fail-closed unsupported state. Application launch remains one independently
  bounded broker-owned action, not the pattern for arbitrary commands.
- Done criteria: Codex Answer/Web still denies commands with actionable Tools
  guidance; Codex Tools keeps its read-only/network-disabled sandbox and renders
  the adapter-normalized command and working directory for every broader-access
  request, running it only after a nonce-bound
  allow-once decision; denial, expiry, cancellation,
  malformed requests, and unsupported tool kinds never execute. The UI states
  that approved Codex commands may read or change device data. Claude's
  scratch-only proof and the existing exact application-launch action remain
  green.
- IPC criterion: one Quickchat IPC owner is registered across all monitors;
  `open`, `close`, `newChat`, and `history` remain callable after reload and
  shell restart without duplicate-handler warnings.
- Source/install criterion: focused and full suites pass, deterministic builds
  remain byte-identical, the installed tree matches the reviewed source, and a
  real authenticated Codex ACP probe plus broker-protocol tests prove the
  command approval/denial flow. Installed-panel interaction is an explicit
  owner-run usage gate; automated CUA is paused.
- Publication criterion: independent review is clean, the complete scoped diff
  is committed and pushed, CI is green, and the published revision is recorded.
- Orchestrator: current Herdr pane `wK:p2`; owns implementation, integration,
  installed validation, and publication.
- Architecture reviewer: visible named Claude agent `qc_action_arch`, pane
  `wK:p1R`; read-only; owns the smallest-safe action/IPC design review.
  Orchestrator owns cleanup.
- Forbidden: silent or persistent command approval, truncated/uninspectable
  commands, OpenCode tool enablement, credential changes, marketplace
  submission, or destructive user-data operations.
- Current checkpoint: reviewed commit `f3daecd` is installed through the native
  plugin CLI with the owner's prior Codex/model settings restored. Theme-specific
  dispatch was explicitly rejected and fully reverted: the implementation is a
  generic Codex command boundary. The authenticated headless Codex suite passed
  both Answer-mode denial and a randomized temporary-file command after exactly
  one `allow_once`; focused broker permission/protocol coverage passed 39/39;
  full repository validation passed 100 tests with four explicit live skips.
  The final singleton-signal IPC design has an independent `CLEAN` verdict.
  CUA is stopped; the owner's installed-panel usage check remains open.
  Commit `9c36dcf` passed GitHub CI, and annotated tag/release `v0.1.1` is public
  with checksum, SBOM, and provenance assets.

## Current repair evidence (2026-08-13)

- The earlier claim that Codex Tools could be confined away from host reads was
  invalidated: Codex read-only permits host reads and an approved escalation can
  mutate user state. The repaired contract exposes that authority explicitly
  and requires exact allow-once approval instead of calling it isolated.
- The real authenticated Claude adapter ran an unpredictable `date +%s%N`
  command inside the fixed sandbox. A second exact, approved read of a random
  host-side file did not expose its contents in streamed events or the answer.
  The installed panel repeated both probes through real pointer/keyboard input:
  the command returned a dynamic nanosecond timestamp; the host read rendered
  its exact payload and approval controls above the detail, then failed without
  exposing or persisting the random secret.
- The installed provider/model controls exposed live Codex, Claude, and
  OpenCode catalogs. Codex now exposes Tools with device-authority disclosure
  and exact allow-once command approval; Claude exposes scratch-sandboxed Tools;
  OpenCode remains withheld.
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

## Streaming latency loop (2026-08-15)

- Goal: determine whether Quickchat's apparently stalled answer rendering on
  Gonk is caused by provider first-token latency, ACP event buffering, broker
  NDJSON emission, QML parsing/rendering, or a lifecycle race; implement only
  evidence-backed latency and progress-feedback improvements.
- Done criteria: a timestamped programmatic reproduction identifies time to
  initialize, submit, first state, first content, and completion; focused tests
  cover any repaired boundary; the full validation suite and deterministic
  runtime build pass; an independent reviewer reports no unresolved findings;
  CI is green; and the reviewed commit is updated on Gonk with a protocol-2
  broker timing check. Installed-panel feel remains an owner-run gate.
- Stream: branch `streaming-latency`, worktree
  `/home/sbull/worktrees/omarchy-quickchat-streaming`; the orchestrator owns
  reproduction, implementation, integration, review fixes, PR, and Gonk
  verification.
- Claude worker: visible agent `qc_stream_trace` in tab `wK:t16`, pane
  `wK:p29`, Claude session `b4e2da30-1d92-4db5-988d-3ed8090ede66`, cwd
  `/home/sbull/worktrees/omarchy-quickchat-streaming`; read-only; owns an
  independent trace of broker, ACP, NDJSON, and QML streaming semantics plus
  smallest-safe optimization recommendations. The orchestrator owns the tab
  and cleanup.
- Required gates: current-source inspection, Gonk and local timestamped broker
  probes, focused tests, full `./scripts/validate.sh`, reproducible checked-in
  bundle, independent review, PR CI, and post-update Gonk protocol check.
- Independent review: Codex agent `qc_stream_review` in loop-created tab
  `wK:t17` failed to return a bounded verdict and issued an unrelated Herdr
  command after interruption; its output is inconclusive and the tab was
  closed. Read-only Claude agent `qc_stream_trace` in `wK:t16` reviewed the
  final diff, found two cancellation-window issues, and returned `CLEAN` after
  both were covered by a latching discard and late-chunk integration test. The
  orchestrator closed both loop-created review tabs.
- Allowed: scoped repository edits, tests, branch commits, push, draft PR, and
  updating the Quickchat plugin on Gonk after review and CI. Forbidden: tags,
  releases, marketplace changes, credential/provider configuration changes,
  destructive resets, unrelated desktop changes, and CUA automation.
- Current status: Gonk reproduced 3.1-3.5 s to first visible content for short
  Codex answers that completed in 3.3-3.8 s. Claude independently measured the
  fixed 64-character guard adding 256-1212 ms with probe streams and confirmed
  the blank `streaming` state. The candidate replaces that fixed tail with a
  boundary-aware fail-closed marker prefix, coalesces safe chunks on a 32 ms
  frame interval, and keeps `Waiting for <provider>…` visible before the first
  delta. Typecheck, lint, 48 focused tests, full validation (118 passed, 6
  explicit live skips), QML contracts (20 passed), and three byte-identical
  runtime builds (`3544884e…ad20` broker, `3de0cc91…12eb` map) are green.
  Independent review is clean. Draft PR #2 is open at
  `https://github.com/spencerbull/omarchy-quickchat/pull/2`; exact-head CI run
  `31912409144` passed. A temporary, non-installed copy of commit `299d409`
  on Gonk produced seven content events per answer across three authenticated
  Codex trials: first content at 3.1-4.9 s and completion at 3.7-5.5 s. This
  verifies that the fixed answer holdback is gone while the remaining initial
  wait is provider/process first-token latency. Persistent ACP process reuse is
  deferred because it changes provider lifecycle and security boundaries.
  Merge, native CLI update on Gonk, protocol reprobe, and the owner's
  installed-panel feel check remain human-gated.

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
