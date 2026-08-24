# OmaPilot implementation ledger

Historical branch, worktree, backup, and runtime labels in this ledger use the
current OmaPilot namespace so the submission tree has one consistent identity.

## Marketplace submission preparation (2026-08-23)

- Goal: prepare the public OmaPilot repository for its first
  omarchyplugins.com submission through one reviewable `dev` to `main` pull
  request.
- Branch: `t3code/prepare-plugin-submission`, based exactly on `origin/dev`
  commit `ae4378880c27927376f380636277c362c1982864`.
- Allowed: scoped repository edits; local dependency installation, builds,
  tests, packaging, installed-plugin/runtime verification, screenshot capture;
  commit and push to `dev`; and creation or update of the `dev` to `main` pull
  request.
- Forbidden: marketplace issue submission without the owner's separate review
  and approval of its exact title, body, and checklist; release publication;
  production changes; secrets, billing, or customer-data changes; destructive
  resets; and edits to other worktrees.
- Required gates:
  - [x] Current marketplace structure and security-baseline checks pass for the
    exact public commit.
  - [x] Root `preview.png` and the README preview use the reproducible current
    QML surface, which was also verified open in the live Omarchy shell.
  - [x] README, release metadata, dependencies, install/update/remove guidance,
    and security reporting are current and internally consistent.
  - [x] Source checks, generated-runtime parity, deterministic release package,
    clean indexed-candidate Omarchy validation, live UI verification, and
    candidate runtime verification pass.
  - [x] Equivalent final diff audit has no unresolved
    actionable findings.
  - [x] The reviewed changes are committed and pushed to `dev`, and one
    `dev` to `main` pull request is open with green required checks.
- Worker state: none. `HERDR_ENV` is unavailable, so the orchestrator owns the
  implementation, audit, and verification directly; no native/background
  worker is authorized.
- Cleanup owner: the orchestrator owns temporary build, validation, and capture
  artifacts created by this stream. Existing user files and other worktrees are
  out of scope.
- Evidence so far: `npm audit` reports zero vulnerabilities; `npm run check`
  passes 242 tests with 8 intentional skips; `bash tests/check-ui-contract.sh`
  passes the QML, motion, and visual fixtures against pinned Quattro commit
  `ef6d9e6605b121df15bf310e630e04f0c1119fc8`; generated runtimes reproduce
  byte-for-byte across Arch and Debian build environments; and two release
  archives have identical SHA-256 hashes.

## Goal

Ship a public Omarchy Quattro bar-widget that provides themed, one-turn AI
answers through authenticated Codex, Claude, or OpenCode ACP agents; retains
the latest 30 answers; supports Voxtype dictation; and hands saved sessions to
a dedicated Herdr OmaPilot workspace.

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
| QML surface | `quattro-ui` / `/home/sbull/worktrees/omarchy-omapilot-ui` | Bar widget, panel, components, QML tests | Implemented and integrated on `main` |
| ACP runtime | `broker-runtime` / `/home/sbull/worktrees/omarchy-omapilot-broker` | Broker, provider adapters, history, Herdr/Voxtype helpers, unit tests | Integrated and independently reviewed on `main` |
| Plugin/release | `plugin-compliance` / `/home/sbull/worktrees/omarchy-omapilot-compliance` | Manifest, docs, validation, CI/release packaging | Implemented and integrated on `main` |

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
  `/home/sbull/worktrees/omarchy-omapilot-automatic`, based on `main` commit
  `ff93db8`. The orchestrator owns implementation and integration.
- Allowed: scoped repository edits, local dependencies/tests, commits, push of
  this branch, and a draft PR to `spencerbull/omarchy-omapilot:main`.
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
<https://github.com/spencerbull/omarchy-omapilot/pull/1> targets `main`; its
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
  `/home/sbull/worktrees/omarchy-omapilot-context`, based on merged `main`
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
  `/home/sbull/worktrees/omarchy-omapilot-context`, based on merged `main`
  `caa2439` with desktop context preserved as commit `271966f`. The orchestrator
  owns implementation, integration, publication, and local installation.
- Allowed: scoped source/docs/tests/build edits; local authenticated
  non-destructive provider probes; commits; push; PR creation; CI inspection;
  reviewed local plugin installation. Forbidden: merge, tag, release,
  marketplace submission, provider credential/configuration changes, CUA,
  secrets, billing, production/customer data, hardcoded app mappings, or edits
  outside this repo and the installed OmaPilot copy.
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
  `~/.config/omarchy/plugins/io.github.spencerbull.omapilot`; the installed
  broker returned protocol 2, three providers, and `desktop-context` before a
  lock-guarded shell restart. `shell.json` remained byte-identical, preserving
  the center placement and provider/model settings. Rollback snapshot:
  `~/.local/state/omarchy-omapilot-backups/20260816-1428-before-a72436c`.

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
- [x] `design-qa.md` said `final result: passed` at the published release commit.
- [x] Public main branch and annotated-tag release assets are published.

## Release blockers

- [x] Reproduce and fix the owner-reported **Continue in Herdr** failure on the
  installed Quattro plugin. Do not accept command-construction tests or a
  single successful development probe as completion.
- [ ] Prove the complete handoff matrix in the live desktop: launch Herdr when
  closed; raise its existing window; create or reuse the OmaPilot workspace;
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
- IPC criterion: one OmaPilot IPC owner is registered across all monitors;
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
- Codex remains `on-request` while OmaPilot rejects every ACP permission
  request; the live exact `/etc/hostname` denial probe passed with no streamed
  or persisted content.
- Release `v0.1.0` and its checksum, SBOM, and provenance assets are published.
- Marketplace submission requires the owner's approval of the exact issue body.
- The README uses a verified completed-answer capture from the installed active
  Omarchy theme.
- The checked-in runtime layout works after a plain Omarchy clone without hooks;
  final-tag CI rebuilt the archive twice and proved it deterministic.

## Streaming latency loop (2026-08-15)

- Goal: determine whether OmaPilot's apparently stalled answer rendering on
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
  `/home/sbull/worktrees/omarchy-omapilot-streaming`; the orchestrator owns
  reproduction, implementation, integration, review fixes, PR, and Gonk
  verification.
- Claude worker: visible agent `qc_stream_trace` in tab `wK:t16`, pane
  `wK:p29`, Claude session `b4e2da30-1d92-4db5-988d-3ed8090ede66`, cwd
  `/home/sbull/worktrees/omarchy-omapilot-streaming`; read-only; owns an
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
  updating the OmaPilot plugin on Gonk after review and CI. Forbidden: tags,
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
  `https://github.com/spencerbull/omarchy-omapilot/pull/2`; exact-head CI run
  `31912409144` passed. A temporary, non-installed copy of commit `299d409`
  on Gonk produced seven content events per answer across three authenticated
  Codex trials: first content at 3.1-4.9 s and completion at 3.7-5.5 s. This
  verifies that the fixed answer holdback is gone while the remaining initial
  wait is provider/process first-token latency. Persistent ACP process reuse is
  deferred because it changes provider lifecycle and security boundaries.
  Merge, native CLI update on Gonk, protocol reprobe, and the owner's
  installed-panel feel check remain human-gated.

## Post-v0.1: OmaPilot rebrand

- [x] Approve `OmaPilot` as the visible product name. Ask / Act were explored in
  checkpoint 2 and retired in checkpoint 4 after hands-on review.
- [x] Approve `omarchy-omapilot` as the public repository name and update public
  product copy without changing stable compatibility identifiers.
- [x] Rebrand the visible shell surface, README, repository description,
  security contact, and marketplace repository metadata. Compatibility package
  names and release artifact names remain intentionally unchanged for now.
- [ ] Choose the replacement reverse-DNS plugin ID and provide an explicit
  migration for the existing OmaPilot layout entry and per-provider settings.
- [ ] Migrate or compatibly discover OmaPilot history, image cache, runtime
  paths, Herdr workspace labels, IPC targets, environment overrides, and broker
  client/protocol identifiers without abandoning user data.
- [ ] Validate update, rollback, clean install, removal, and marketplace
  behavior across both the old and new identities before retiring aliases.

## Style revamp checkpoint 1 (2026-08-16)

- Goal: make the anchored OmaPilot panel feel like a native Quattro surface
  with a quieter conversation-first layout, content-driven bounded height,
  transcript-owned scrolling, and restrained response-state motion.
- Done criteria: the primary panel keeps only conversation controls visible;
  provider/model/history controls remain discoverable and keyboard-accessible
  in a settings pane; short content stays compact; long content is capped by
  the current screen and scrolls only inside the response; streaming follows
  only when the reader is near the bottom and exposes a return-to-latest action;
  waiting, first-token, completion, cancellation, and error states remain clear;
  focused QML/UI/manifest checks and `git diff --check` pass.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`, based exactly on
  `origin/main` commit `caa2439` when this checkpoint began.
- Allowed: scoped source and test edits in this worktree; read-only inspection
  of `/home/sbull/omarchy/shell`, the installed OmaPilot payload, and the stale
  `omarchy-omapilot-ui` worktree; local static and headless test execution.
- Forbidden for the original source checkpoint: commit, push, merge,
  install/update the plugin, restart Quickshell, mutate shell/Hyprland/live
  desktop state, edit any other worktree, or absorb runtime/security work from
  `omarchy-omapilot-context`. The owner subsequently authorized only a local
  install and safe plugin rescan for hands-on testing; restart and all other
  restrictions remain in force.
- Verification gates:
  - [x] Confirm clean target worktree, branch, and `origin/main` base.
  - [x] Inventory current controls, QML ownership, Quattro public UI/theme APIs,
    installed payload divergence, and stale UI intent.
  - [x] Add focused height, scroll-follow, settings-dismissal, and loading-state
    regression coverage supported by the QML test harness.
  - [x] Pass focused `qmllint` and QML tests for every changed surface.
  - [x] Pass repository UI/manifest contract checks and `git diff --check`.
  - [x] Orchestrator review of the complete uncommitted diff.
  - [x] Install a three-way merged payload over the existing local
    desktop-context/provider checkout, preserving its policy and context
    contracts; pass 22 protocol/context, three permission-focus, and seven
    presentation tests from the installed path. The first plugin rescan left
    the old bar-widget panel component visible; the owner's screenshot proved
    that provider/model selectors and the old `ANSWER` card were still loaded.
    A subsequent owner-authorized, lock-guarded shell restart loaded the new
    OmaPilot IPC target without OmaPilot-specific errors. Rollback snapshot:
    `/home/sbull/.local/state/omarchy/omapilot-backups/pre-style-revamp-20260816T204536`.
  - [ ] Owner-run installed/live validation on representative small and large
    screens, including keyboard, pointer, reduced-motion environment if one is
    later exposed by Quattro, and real waiting/stream/cancel/error behavior.
- Current checkpoint: code-and-static-test checkpoint complete and left
  uncommitted for review. The locally installed plugin now contains the
  validated style surface merged with its existing separate desktop-context
  and provider-policy payload. Omarchy reports OmaPilot enabled with its IPC
  target loaded and no OmaPilot-specific error after the guarded restart;
  owner confirmation of the newly instantiated panel remains open.

## OmaPilot interaction checkpoint 2 (2026-08-16)

- Goal: implement the selected OmaPilot visual direction as a compact native
  Quattro command surface with a recognizable gauge-and-spark identity,
  broker-policy-backed Ask / Act lanes, an integrated composer, configurable
  quick actions, and no redundant close affordance.
- Done criteria: OmaPilot is the visible shell/manifest name while stable
  OmaPilot IDs and data paths remain compatible; Ask automatically rejects
  every broker-mediated device approval while retaining safe harness-native
  work; Act retains exact approval for broader actions;
  provider/model details remain discoverable in settings; quick actions prefill
  editable prompts and can be hidden independently; empty, waiting, streaming,
  completion, cancellation, error, history, and settings layouts remain bounded
  and keyboard accessible; focused QML/UI/manifest checks and
  `git diff --check` pass.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`, still based exactly on
  `origin/main` commit `caa2439`; all checkpoint-1 changes remain uncommitted.
- Allowed: scoped source, manifest, documentation, test, TODO, and design-QA
  edits in this worktree; read-only inspection of the active Quattro source and
  installed payload; local static, headless QML, and repository checks.
- Forbidden: commit, push, merge, plugin install/update, shell restart, live
  desktop mutation, edits to another worktree, stable ID/path/IPC migration,
  persistent dangerous approval, or any runtime/security work owned by
  `/home/sbull/worktrees/omarchy-omapilot-context`.
- Verification gates:
  - [x] Reconfirm branch, worktree, `origin/main` base, uncommitted checkpoint-1
    ownership, current Quattro 0.3.0 component APIs, and installed divergence.
  - [x] Implement the visible OmaPilot identity without changing stable IDs.
  - [x] Implement truthful Ask / Act permission postures from broker-reported
    policy: Ask auto-denies every device approval and Act exposes exact review.
  - [x] Add the integrated composer and configurable quick-action surface.
  - [x] Add focused mode, action, dismissal, sizing, scroll, and state tests.
  - [x] Pass focused QML lint/tests, UI and manifest contracts, full repository
    validation, and `git diff --check`.
  - [x] Produce a rendered comparison against the selected OmaPilot mock, or
    record the exact static-checkpoint blocker in `design-qa.md` without
    mutating the installed/live shell.
  - [x] Complete the subsequently owner-authorized local install as a
    presentation-only overlay on the existing desktop-context/provider payload.
    Runtime, built broker, `Protocol.js`, and `DesktopContext.qml` remained
    byte-identical to the pre-install snapshot. The merged installed path passed
    22 protocol/context, three permission-focus, nine presentation, and six
    quick-action QML checks against the live packaged shell APIs; the full
    candidate passed 130 runtime tests with 12 live-provider skips. Rollback:
    `/home/sbull/.local/state/omarchy/omapilot-backups/pre-omapilot-20260816T214754`.
  - [x] Reconcile Ask / Act with the installed provider-tools contract. A live
    read-only broker initialization proved Codex, Claude, and OpenCode all
    advertise `device-approval`; provider-based lanes would therefore disable
    Ask. The final presentation keeps the selected harness, automatically sends
    `reject_once` for every pending device approval in Ask, and exposes the
    exact approval card only in Act. No broker, protocol, runtime, or desktop-
    context byte changed. Pre-correction rollback:
    `/home/sbull/.local/state/omarchy/omapilot-backups/pre-omapilot-permission-posture-20260816T215939`.
  - [ ] Owner-run pointer, keyboard, mode-switch, quick-action, context, and real
    waiting/stream/cancel/error validation from the installed panel.
- Current checkpoint: code, static validation, headless visual comparison, and
  the authorized local install are complete. Changes remain uncommitted. An
  initial multi-file reload/restart briefly exceeded the shell ping window and
  one replacement Quickshell child crashed during teardown; the crash handler
  recovered it. The final correction was installed atomically and the guarded
  restart then completed normally. The settled shell responds to IPC, exposes
  the stable OmaPilot target, discovers the enabled plugin as OmaPilot, is
  unlocked, and has no OmaPilot/OmaPilot-specific load error in the final
  startup log. Hands-on interaction remains the owner validation gate.

## OmaPilot identity and dangerous Act checkpoint 3 (2026-08-16)

- Goal: replace the temporary gauge-and-spark glyph with the owner-selected
  Omarchy-square/heading mark and add an explicit persisted Dangerous
  auto-approve flag for Act requests.
- Done criteria: the selected mark remains legible and theme-colored in the bar
  and panel; the setting defaults off, is keyboard accessible, and clearly
  describes its risk; Ask never auto-approves; Act sends the flag only when the
  user enabled it; the broker selects only the exact ACP request's
  `allow_once` option without showing an approval prompt; unreviewable,
  non-execute, missing-allow-once, stale, and provider-blocked tool requests
  remain fail-closed; focused QML, manifest, protocol, policy, runtime-build,
  repository, and `git diff --check` gates pass.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`; all checkpoint-1 and
  checkpoint-2 user work remains uncommitted and must be preserved.
- Allowed: scoped QML, generated icon asset, manifest, broker protocol/policy,
  built runtime, documentation, test, TODO, and design-QA edits in this
  worktree. The owner's explicit request authorizes the narrow persistent
  dangerous-approval feature that checkpoint 2 had forbidden. The owner then
  explicitly authorized a local merged install and shell restart for hands-on
  testing.
- Forbidden: commit, push, merge, edits to or copying from another worktree,
  stable ID/path migration, selecting ACP `allow_always`, weakening
  request/nonce binding, or enabling tools for a provider whose existing policy
  blocks them. No live device action is part of the install gate.
- Verification gates:
  - [x] Reconfirm branch/worktree, preserve the existing dirty diff, inspect
    Quattro 0.3.0 settings/icon APIs, and trace QML through the ACP permission
    callback.
  - [x] Add and render the selected themeable OmaPilot mark at bar and header
    sizes.
  - [x] Add the persisted setting and an Act-only submit contract that defaults
    safely when omitted.
  - [x] Auto-select only normalized per-request ACP `allow_once` choices and
    keep all other provider/tool policy gates intact.
  - [x] Add focused UI, manifest, protocol, and permission-policy regressions.
  - [x] Pass focused QML lint/tests, full repository validation, deterministic
    runtime source/dist parity, and `git diff --check`.
  - [x] Record static design comparison and leave installed/live validation as
    the next explicit owner gate.
  - [x] Install the validated three-way merge over the existing local
    desktop-context/provider payload without changing `shell.json`. The staged
    and installed UI contracts pass 23 protocol/context, three permission-focus,
    nine presentation, and six quick-action QML checks. The complete merged
    runtime passes 135 tests with 12 live-provider tests skipped; the installed
    broker bundle passes all 23 focused protocol tests, including exact
    no-prompt auto-approval for Codex, Claude, and OpenCode and fail-closed
    missing/unreviewable allow-once requests. A read-only installed broker
    initialization advertises all three harnesses with their preserved
    `device-approval` policies. Rollback snapshot:
    `/home/sbull/.local/state/omarchy/omapilot-backups/pre-omapilot-dangerous-20260816T230559`.
- Current checkpoint: code, static verification, and the owner-authorized local
  install are complete. The selected no-tab mark is rendered from its real
  asset with the Quattro accent; the persisted setting is off by default and
  forwarded only by Act; the broker auto-selects only a normalized request's
  `allow_once` option for an existing device-approval provider. The guarded
  shell restart hit Quickshell's known teardown crash once; its crash handler
  recovered automatically, the settled shell responds to IPC, a new
  shell-owned installed broker is running, and the fresh log contains no
  OmaPilot/OmaPilot-specific load error. Changes remain uncommitted. Owner-run
  visual interaction and a deliberately scoped real device action remain the
  live validation gates.

## OmaPilot unified interaction checkpoint 4 (2026-08-16)

- Goal: remove the redundant Ask / Act split and make OmaPilot one coherent
  request surface with a single explicit permission posture.
- Done criteria: no mode switch, mode-specific provider filtering, automatic
  Ask denial, mode-gated quick actions, or mode protocol/state remains; ordinary
  requests show exact approval cards; Dangerous auto-approve applies to every
  submission only when enabled; both enabled quick actions remain visible;
  focused QML/UI/manifest checks and `git diff --check` pass.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`; all earlier checkpoint
  work remains uncommitted and preserved.
- Allowed: scoped presentation, persisted dangerous-setting plumbing,
  documentation, tests, local merged install, and guarded shell restart for the
  owner-requested hands-on iteration.
- Forbidden: commit, push, merge, edits to another worktree, stable ID/path
  migration, `allow_always`, weakening the normalized exact-request boundary,
  or silently changing the separate desktop-context/provider-policy stream.
- Verification gates:
  - [x] Remove Ask / Act UI, state, provider filtering, auto-denial, and action
    filtering from the source checkpoint.
  - [x] Keep exact approval visible by default and make the dangerous flag the
    only auto-approval control.
  - [x] Render the unified empty and dangerous-settings states and pass focused
    QML/UI/manifest checks plus `git diff --check`.
  - [x] Three-way merge over the installed desktop-context/provider payload,
    validate the installed path, and reload it without changing user settings.
    The installed contracts pass 23 protocol/context, three permission-focus,
    eight presentation, and five quick-action checks. The complete staged
    runtime passed 135 tests with 12 live-provider skips. Context source,
    automatic policy, and built-broker hashes remained byte-identical. Rollback:
    `/home/sbull/.local/state/omarchy/omapilot-backups/pre-omapilot-unified-20260816T232710`.
  - [ ] Owner-run visual and real permission-flow validation.
- Adjacent prompt issue: the installed context envelope already says desktop
  metadata is optional and untrusted, but it does not explicitly tell a harness
  to continue normally with available tools when the snapshot lacks an answer.
  The desired wording should say that absence from desktop context is not proof
  the information is unavailable, and that permitted web/tool use remains
  independent. This belongs to the separate context/provider stream and is not
  silently absorbed into this style worktree.
- Current checkpoint: unified presentation is implemented, statically verified,
  installed, and reloaded. The shell responds to IPC, the installed broker is
  running, and the fresh shell log contains no OmaPilot/OmaPilot-specific load
  error or crash. Changes remain uncommitted. Owner-run visual and real
  permission-flow validation remains open.

## OmaPilot configurable actions and response feedback checkpoint 5 (2026-08-16)

- Goal: let the owner curate up to five quick actions from OmaPilot settings,
  make waiting and streaming activity unmistakable without fake progress, and
  provide an inspectable error-details pane behind a compact error affordance.
- Done criteria: quick actions can be added, edited, removed, and moved up or
  down; their order and content persist through the existing inline plugin
  settings contract; invalid settings fail safely and the list never exceeds
  five; the empty surface wraps configured actions without clipping; waiting
  motion is finite and streaming motion is driven by real content events;
  reduced-motion injection remains honored; every error/unavailable state has
  a keyboard-accessible details affordance with message, code, and retryability;
  Escape returns from details to the conversation; focused QML/UI/manifest and
  repository checks pass.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`; preserve every earlier
  uncommitted checkpoint change.
- Allowed: scoped QML, presentation helpers, manifest preferences,
  documentation, tests, static previews, an owner-authorized local merged
  install, and one guarded shell reload after validation.
- Forbidden: commit, push, merge, changes to another worktree, changes to the
  desktop-context/provider prompt or runtime policy, protocol expansion,
  unbounded action storage, fake progress, or live settings mutation outside
  the plugin's existing inline persistence path.
- Verification gates:
  - [x] Inventory the current action defaults/persistence, response/error state,
    Quattro controls, Style tokens, and Quickshell 0.3.0 motion APIs.
  - [x] Implement bounded action normalization, editing, ordering, and
    persistence with legacy default migration.
  - [x] Implement finite waiting reveal, event-driven streaming activity, and
    the keyboard-accessible error-details flow.
  - [x] Add focused state-machine/contract tests and inspect static previews.
  - [x] Pass full source validation, `git diff --check`, installed-merge checks,
    guarded reload, and fresh-log inspection. Source QML passed 18 protocol,
    three permission-focus, eight presentation, and seven quick-action checks;
    runtime passed 121 tests with six live-provider skips. The installed merge
    passed 24 protocol/context, three permission-focus, eight presentation, and
    seven quick-action checks. The preserved merged runtime remains the earlier
    135-pass/12-live-skip candidate and its context source, automatic policy,
    and built broker hashes are unchanged. Rollback:
    `/home/sbull/.local/state/omarchy/omapilot-backups/pre-omapilot-actions-20260816T235458`.
  - [ ] Owner-run pointer, keyboard, persisted-action, real streaming, and real
    error validation.
- Context-stream handoff (not implemented in this presentation worktree):
  - Strengthen the enriched prompt so desktop metadata is explicitly optional
    supplemental evidence and never a reason to skip otherwise permitted web
    or tool use.
  - Add a bounded default-browser record to desktop context, preferably the
    resolved desktop ID/display name plus an `openUrl` availability boolean;
    do not include browser profiles, history, tabs, or credentials.
  - The broker already validates and opens user-clicked `http`, `https`, and
    `mailto` response links through `open_link` and `xdg-open`. Harness-initiated
    navigation is a different authority: expose it only as a structured,
    scheme-validated `open_url` device action through the existing exact ACP
    permission path (or the dangerous allow-once setting), never by treating
    desktop-context text as executable instruction.
- Current checkpoint: implementation, source/static validation, merged local
  install, and shell reload are complete. The guarded reload hit the known
  Quickshell teardown crash once; the crash handler recovered, shell IPC is
  responsive, the previous broker is defunct rather than active, one new
  shell-owned broker is running, and the fresh log has no OmaPilot-specific
  load error. Changes remain uncommitted. Owner-run action persistence,
  keyboard/pointer traversal, real stream cadence, and error-pane interaction
  remain open. No desktop-context/provider runtime or policy file changed.

## OmaPilot motion and agentic-instructions checkpoint 6 (2026-08-17)

- Goal: remove the owner-observed waiting/streaming jump and make the hidden
  harness instructions consistently frame OmaPilot as Omarchy's action-oriented
  system copilot.
- Done criteria: status-copy changes never resize the question row; the
  waiting-to-streaming transition does not stop, reset, or snap an in-flight
  pulse; bursty content events coalesce into at most one follow-up pulse rather
  than being discarded; position and opacity timelines finish together;
  reduced-motion injection still settles immediately; Codex, Claude, and
  OpenCode receive the same hidden OmaPilot instruction source; the prompt
  treats desktop context as optional untrusted evidence, discovers available
  local/Omarchy capabilities before declining, uses current-information web
  search when available, and reports action success only after tool evidence;
  no permission, approval, IPC, or desktop-context schema authority changes.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`; preserve all earlier
  uncommitted checkpoints and do not edit another worktree.
- Allowed: the scoped WaitingIndicator/Panel layout, shared hidden instruction
  text and its provider-native injection points, focused tests, generated broker
  bundle, documentation, design QA, and this ledger. The owner's newest request
  explicitly authorizes the narrow cross-provider prompt-injection pass.
- Forbidden: commit, push, merge, plugin installation, shell restart, live
  desktop mutation, desktop-context schema collection, new device/browser
  protocol actions, changes to exact ACP approval/auto-approval enforcement, or
  copying unrelated runtime/security work from the context worktree.
- Verification gates:
  - [x] Reconfirm branch/worktree, existing dirty ownership, Quickshell 0.3.0,
    current Qt/Quattro motion conventions, and installed instruction boundary.
  - [x] Implement stable layout ownership and uninterrupted/coalesced motion.
  - [x] Implement one capability-aware OmaPilot instruction source across all
    three harness integration seams without broadening their actual tools.
  - [x] Add focused motion/instruction regressions and inspect static waiting
    and streaming renders.
  - [x] Pass focused QML lint/tests, UI/manifest contracts, runtime type/lint/
    tests, deterministic source/dist build parity, and `git diff --check`.
  - [x] Keep the installed plugin and live shell unchanged at this static
    checkpoint.
  - [ ] Owner-run installed waiting, streaming, completion, and real-harness
    prompt validation after a separately authorized merged install.
- Current checkpoint: code-and-static checkpoint complete. The UI contract
  passes 18 protocol, three permission-focus, eight presentation, and seven
  quick-action checks plus the real-component motion probe and all headless
  renders. Full repository validation passes 122 runtime tests with six live
  provider tests skipped; the focused shared-instruction suite passes 21 tests;
  two broker builds are byte-identical; the release archive contains
  `runtime/policies/automatic.md`; and `git diff --check` passes. No plugin,
  shell, other worktree, or live desktop state was changed. Installed waiting,
  streaming, and real harness behavior remain the next owner gate.

## OmaPilot publication and local test install checkpoint 7 (2026-08-17)

- Goal: publish the accumulated OmaPilot checkpoint under its approved public
  identity and prepare the existing local installation for owner testing
  without replacing its separate desktop-context/provider-tools payload.
- Done criteria: the public repository is named `omarchy-omapilot`; README,
  security, and marketplace URLs use that name; stable plugin/runtime/data
  identifiers remain compatible; `omapilot-style-revamp` is committed and
  pushed; a backed-up merged install passes source, merged-QML, provider-policy,
  protocol, motion, manifest, and shell-startup gates; owner interaction remains
  explicitly separate from static and startup evidence.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`; published repository
  `spencerbull/omarchy-omapilot`. Commit `03c569b` contains the complete visual,
  interaction, permission-setting, quick-action, error, motion, prompt, test,
  and public-name checkpoint.
- Allowed: the owner's explicit authorization for commit/push, public GitHub
  repository rename/description update, guarded three-way local install, and one
  unlocked shell restart; scoped follow-up documentation and prompt-compatibility
  wording on this branch.
- Forbidden: edits to another worktree, merging or copying the context branch,
  changing the stable reverse-DNS ID/IPC/data paths, weakening broker/provider
  policy, opening the panel or executing a device action on the owner's behalf,
  publishing a release, or merging either open branch.
- Verification gates:
  - [x] Reconfirm the branch was exactly based on `origin/main` commit `caa2439`
    before the checkpoint commit and that the dirty files belonged to the
    accumulated owner-directed OmaPilot work.
  - [x] Pass full source validation: manifest/release contracts, typecheck,
    lint, deterministic broker build, 122 runtime tests with six live-provider
    skips, 18 protocol, three permission-focus, eight presentation, seven
    quick-action QML checks, the real-component motion probe, headless renders,
    and `git diff --check`. Shellcheck remained unavailable and was reported.
  - [x] Rename the public repository to `spencerbull/omarchy-omapilot`, update
    its description, preserve open provider-tools PR 3, and push
    `omapilot-style-revamp` at `03c569b`.
  - [x] Build and validate an installed-payload merge that preserves desktop
    context and the provider bundle while applying only the new response-status
    layout, waiting indicator, shared prompt, and public documentation deltas.
    The candidate passed 24 protocol/context, three permission-focus, eight
    presentation, seven quick-action, 27 merged provider-policy, and 23 merged
    protocol tests; the real component reported `OMAPILOT_MOTION_PROBE_OK`.
  - [x] Install the candidate without directly editing `shell.json`; the file
    remained byte-identical through the swap. During the subsequent restart,
    Quattro rewrote unrelated clock defaults and the bar transparency field.
    The complete OmaPilot/OmaPilot settings object remained identical, so the
    unrelated live rewrite was preserved rather than rolled back. The installed
    `runtime/src/context.ts` hash remains
    `bc12983327fcdde9a3960c8f3d57fa543f56f270d5597ab097cd6e6de03dfa0d`
    and the installed provider broker hash remains
    `61212d41c515994f648fba6ddc756664aee83dd68fec747aa604ad7f4815f9ca`.
    Rollback snapshot:
    `/home/sbull/.local/state/omarchy/omapilot-backups/pre-omapilot-motion-prompt-20260817T052319Z`.
  - [x] Complete the unlocked guarded restart and verify shell IPC `ping`,
    plugin discovery as enabled OmaPilot, and one new shell-owned installed
    broker. The restart wrapper briefly exited status 255 after looking for a
    default config, then its handler relaunched the correct Omarchy shell; the
    settled log contains no OmaPilot/OmaPilot load error.
  - [ ] Owner-run visual, pointer, keyboard, settings persistence, real waiting/
    streaming/completion/error, web-search, local action, permission, and
    dangerous-auto-approve testing.
- Current checkpoint: the public rename, branch push, merged local install, and
  startup verification are complete. Static and startup evidence is green;
  installed interaction and real-harness behavior remain owner validation.

## OmaPilot consolidated pull request checkpoint 8 (2026-08-17)

- Goal: combine the presentation/rebrand stream and the provider-tools stream
  into one reviewable pull request against `main`.
- Done criteria: `origin/provider-tools` is integrated without dropping either
  stream's behavior; overlapping UI, policy, documentation, and generated
  runtime files are resolved deliberately; combined static and packaging gates
  pass; `omapilot-style-revamp` is pushed; one draft PR targets `main`; and the
  provider-only PR is closed as superseded after the consolidated PR exists.
- Branch/worktree: `omapilot-style-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-style-revamp`; the provider-tools
  branch is consumed read-only from `origin/provider-tools` and its separate
  worktree remains untouched.
- Allowed: merge the remote provider-tools branch here, resolve conflicts,
  update combined regression coverage and this ledger, run static/package
  checks, commit, push, open the consolidated draft PR, and close the older
  provider-only PR with a supersession note.
- Forbidden: edit another worktree or branch, merge into `main`, reinstall or
  restart the shell, change live desktop state, publish a release, delete the
  provider branch, or migrate the stable plugin ID, IPC, and data paths.
- Verification gates:
  - [x] Merge both streams and resolve all conflicts with no unmerged paths or
    conflict markers.
  - [x] Preserve the shared capability-aware OmaPilot prompt, bounded desktop
    context, provider-native tool integrations, exact request-bound approvals,
    compact UI, settings, quick actions, transcript behavior, and finite motion.
  - [x] Pass manifest/release checks, typecheck, lint, build, and the combined
    runtime suite: 136 passed with 12 live-provider tests skipped.
  - [x] Pass the combined QML/UI contract suite (23 protocol/context, three
    permission-focus, eight presentation, and seven quick-action checks),
    deterministic bundle builds, package dry-run, and Git whitespace checks.
  - [x] Commit and push the combined branch at merge commit `29f124b`, open
    draft PR 4 to `main`, then close provider-only PR 3 as superseded while
    retaining its branch for history.
  - [ ] Owner-run installed pointer, keyboard, real-harness, permission,
    streaming, and error-detail validation remains a separate live gate.
- Current checkpoint: both code streams are combined and all source/static
  gates are green: 136 runtime tests pass with 12 live-provider skips, the QML
  contract totals above pass, two broker builds are byte-identical, and the
  release package dry-run succeeds. Draft PR 4 is the single open consolidated
  review surface and provider-only PR 3 is closed as superseded. Owner-run live
  interaction remains the next gate; no live desktop state was changed here.

## OmaPilot motion-quality revamp checkpoint 9 (2026-08-17)

- Goal: replace the rough waiting/streaming motion with a calm, native Quattro
  activity language that stays smooth under bursty token delivery and makes
  each response phase legible without fake progress or layout jitter.
- Done criteria: no moving marker teleports or repeated animation restarts;
  waiting remains visibly alive with restrained cadence; first-token and
  streaming feedback transition without snapping; bursty chunks coalesce;
  completion/cancellation/error crossfade cleanly in the stable status slot;
  panel growth and follow-latest scrolling tolerate continuously changing
  targets; reduced motion settles immediately; focused state-machine, render,
  and repository gates pass; the branch is pushed and a draft PR targets main.
- Branch/worktree: `omapilot-motion-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-motion-revamp`, based on merged
  `origin/main` commit `da25c94`.
- Allowed: presentation-only QML motion and layout ownership, focused QML test
  harnesses, ignored headless render evidence, design documentation, this
  ledger, dependency installation inside this worktree, commit/push, and a
  draft pull request.
- Forbidden: installed-plugin changes, shell restart or live desktop control,
  edits to any other worktree, broker/provider/policy/permission/protocol
  changes, stable ID or persistence migrations, releases, and merging to main.
- Verification gates:
  - [x] Inventory current animation ownership, Quickshell 0.3.0, and active
    Quattro timing/easing conventions.
  - [x] Capture baseline waiting/streaming renders and identify the concrete
    sources of discontinuity.
  - [x] Implement a cohesive activity/status/first-token/follow-motion pass
    with no authority or interaction-contract changes.
  - [x] Add focused real-component regressions for endpoint continuity,
    waiting cadence, burst coalescing, phase handoff, and reduced motion.
  - [x] Pass QML lint/UI contracts, headless motion and visual renders, full
    repository validation, deterministic build/package checks, and Git
    whitespace checks.
  - [x] Commit and push the branch at `fc398cf`, open draft PR 5 to main, and leave installed
    and live shell state unchanged for owner validation.
- Current checkpoint: the presentation-only implementation is complete. The
  fixed route now transfers node energy with identical resting endpoints;
  waiting uses a 760 ms wave plus 1320 ms rest, streaming uses coalesced 460 ms
  content-driven waves, phase copy crossfades, the header no longer overshoots,
  and moving height/scroll targets use smoothing. The real-component cadence
  probe, ten-frame renderer, QML/UI contract, and full 136-test runtime suite
  pass. Final evidence is 23 protocol/context, three permission-focus, eight
  presentation, and seven quick-action QML checks; the cadence probe and all ten
  motion frames; 136 runtime tests with 12 opt-in live-provider skips; two
  byte-identical broker builds; successful package dry-run; and clean Git
  whitespace. Shellcheck remains unavailable. `npm ci` also reports unchanged
  development-server advisories in direct esbuild (low) and Vitest (critical)
  dependencies; this presentation-only diff neither invokes their servers nor
  changes the lockfile. Draft PR 5 is open against main from
  `omapilot-motion-revamp`; installed and live shell state are unchanged.

## OmaPilot frame-clock motion correction checkpoint 10 (2026-08-17)

- Goal: replace the still-rough installed waiting/streaming pulse with a truly
  continuous, understated OmaPilot signal whose motion is independent of token
  burst timing and whose first-token transition moves no response geometry.
- Owner evidence: live testing of installed PR 5 at exact commit `93cd8f5`
  rejected checkpoint 9. The real-component capture advanced through phase
  samples `0.013`, `0.102`, `0.346`, `0.723`, and `0.927` at equal 110 ms
  intervals, confirming that the cubic timeline visibly accelerated through
  the middle; queued streaming pulses could then run back-to-back.
- Done criteria: use the Qt frame clock with capped delayed-frame deltas and
  constant phase velocity; wait-to-stream eases speed without resetting phase;
  token revisions do not restart or retime motion; wrap occurs at identical
  resting geometry; first-token content uses opacity only; inactive and
  reduced-motion states stop and settle; focused QML/render/repository checks,
  PR-head CI, installed validation, shell health, and an owner visual gate pass.
- Branch/worktree: `omapilot-motion-revamp` at
  `/home/sbull/worktrees/omarchy-omapilot-motion-revamp`; update draft PR 5.
- Allowed: presentation-only QML, focused motion tests/renders, documentation,
  commits and push to the existing PR, exact reviewed local plugin update, and
  bounded live interaction/capture for this motion flow.
- Forbidden: broker/provider/policy/permission/protocol changes, stable ID or
  persistence migration, edits to another worktree, release, merge, unrelated
  desktop configuration, shell restart without a demonstrated need and clear
  lock guard, or device-changing prompt execution.
- Verification gates:
  - [x] Record the failed owner gate and measure the previous non-uniform phase.
  - [x] Replace restartable eased pulses with one frame-clock signal and remove
    first-token translation.
  - [x] Add continuity, frame-delta cap, phase-handoff, token-independence, and
    reduced-motion regressions plus temporal renders.
  - [x] Pass focused QML/UI checks, full validation, deterministic package,
    `git diff --check`, and orchestrator diff review.
  - [x] Commit/push the corrected PR head and pass exact-head CI. Commit
    `7c67157` passed both `validate` and deterministic `package` jobs in Actions
    run `32041050737`; the draft PR remains open and mergeable.
  - [x] Install that reviewed code head, preserve center placement/settings,
    and verify shell/broker health without a restart unless required.
  - [ ] Owner confirms the live motion now meets the interaction-quality bar.
- Current checkpoint: source gates are complete. The real-component probe and
  fourteen-frame renderer pass with uniform waiting phase deltas and a smooth
  speed handoff; the focused UI contract passes 23 protocol/context, three
  permission-focus, eight presentation, and seven quick-action checks; full
  validation passes 136 runtime tests with 12 opt-in live skips; three broker
  hashes are identical; package dry-run and Git whitespace checks pass. The
  corrected code is committed at `7c67157`, pushed to draft PR 5, and green in
  exact-code-head CI. That commit is installed from its clean public Git
  checkout at center index 4; plugin validation, shell IPC, and the existing
  broker are healthy, and the hot-reload log contains no OmaPilot-specific
  error. No restart occurred. The panel opened and dismissed through its real
  IPC path, but the computer-use keyboard backend could not submit a harmless
  prompt because this session's desktop portal does not expose `RemoteDesktop`;
  it failed before replaying input. Owner waiting/streaming confirmation is
  therefore still the only open quality gate.

## OmaPilot perimeter-motion polish checkpoint 11 (2026-08-18)

- Goal: replace the rejected route telemetry with one theme-native, softly
  blurred perimeter runner that makes active work feel immediate without
  competing with the response or adding per-frame JavaScript.
- Done criteria: the response card owns one clockwise runner with a crisp core
  and localized bloom; every motion color derives from the active Omarchy
  accent; waiting-to-streaming preserves phase; hidden, terminal, and reduced-
  motion states stop cleanly; status remains plain text; smoothed height and
  follow-latest behavior from checkpoint 10 remain intact; focused, full,
  visual, and independent-review gates pass.
- Branch/worktree: `perimeter-motion-polish` at
  `/home/sbull/worktrees/omarchy-omapilot-perimeter-motion`, based on reviewed
  remote head `origin/omapilot-motion-revamp` (`7d8156f`).
- Initial implementation authorization: presentation-only QML, focused motion
  probes/renders, ignored visual evidence, documentation, local validation, one
  named read-only Herdr review, and an isolated Wayland preview. Separate owner
  approvals later added the merged local install, guarded shell restart, commit,
  branch push, and draft PR. Forbidden throughout: broker/provider/policy/
  permission/protocol changes, shell-setting mutation, release, merge, or
  unrelated desktop configuration.
- Selected visual reference:
  `/home/sbull/.codex/generated_images/01a014a9-a73e-71e3-beaf-8afd052ca604/exec-0755f5a7-8ed6-4a8e-893f-582f4f33330a.png`.
- Verification gates:
  - [x] Create the isolated worktree and confirm a clean baseline.
  - [x] Replace the route/frame-clock component with one perimeter Shape core
    and one XENEON-inspired MultiEffect bloom.
  - [x] Remove the inline glyph and retain a fixed plain-text status slot.
  - [x] Add focused continuity, completion, reduced-motion, theme-token, and
    temporal-render checks.
  - [x] Pass full repository validation, visual comparison, and diff review.
  - [x] Receive a clean independent Herdr review or resolve every finding.
  - [x] Run a final isolated Wayland preview and record remaining live-only
    gates; do not install or reload the active shell without separate approval.
  - [x] After separate owner authorization, merge the five production UI files
    into the newer installed payload, validate and rescan it, and preserve an
    exact rollback copy without changing shell settings.
  - [x] Owner judges the installed waiting/streaming glow during a real prompt.
- Review worker: named Herdr Claude agent `omapilot_perimeter_review`, pane
  `w1A:p6`, in this worktree. Its initial review found a real Qt dash-direction
  inversion, vacuous phase handoff checks, wraparound flakiness, undeclared
  `rg` guards, an orphaned activity revision, and inaccurate README copy. The
  direction was inverted and pinned by contract; the handoff now counts runner
  restarts and uses modular phase advance while the card resizes; all guards use
  `grep`; dead revision state was removed; and the README was corrected. The
  worker confirmed those non-direction resolutions and isolated the dash
  inversion as its sole remaining P1; that exact fix was then applied, pinned by
  contract, and verified in the final direction strip. Its hypothesized resize
  teleport was downgraded after the new resizing probe, and edge bloom was
  accepted as an intentional match to the selected reference. The worker exited
  normally and the created pane was closed.
- Current checkpoint: every source gate passes. Focused QML/UI checks pass 23
  protocol/context, three permission-focus, eight presentation, and seven
  quick-action tests; the real component covers continuity, completion, reduced
  motion, and a 156-to-236-pixel card resize; the fourteen-frame renderer passes
  and a seven-frame strip proves clockwise top-edge travel. Full validation
  passes 136 runtime tests with 12 opt-in live skips, typecheck, lint, build,
  visual comparison, design QA, and `git diff --check`. The final isolated
  Wayland scene graph renders the crisp core and soft bloom in the active theme.
  It retains one unrelated preview-fixture `Composer.qml` undefined-bool warning.
  The separately authorized local install is now complete at
  `~/.config/omarchy/plugins/io.github.spencerbull.omapilot`. A guarded
  three-way payload merge changed only `Panel.qml`, `OmaPilotStore.qml`, the
  component registry, removal of `WaitingIndicator.qml`, and addition of
  `ResponseActivityBorder.qml`; the installed context-capture and browser-
  companion work remains intact. The installed manifest, merged Wayland smoke,
  and real motion probe pass. The initial plugin rescan left the original shell
  responsive and registered the panel IPC target, but did not prove that the
  already-instantiated panel had adopted the new component. After the owner
  reported no animation during a real 08:45 response, the session lock guard
  confirmed unlocked state, the broker had no provider child, and a guarded
  shell restart created fresh shell PID `2997941` and broker PID `2998782`.
  The fresh shell has no OmaPilot QML error, registers the expected IPC target,
  and opens the keyboard-panel layer at alpha `1`; this is the completed live
  installation gate.
  `shell.json` remains byte-identical at SHA-256
  `4ce875fdbddbaff26f3ea847a4fe9484fa7e4ee47ba9cd0f549f4fdfdb1bd92c`.
  Rollback is
  `~/.config/omarchy/plugins/.io.github.spencerbull.omapilot.perimeter-backup.20260818T133740Z`.
  The owner exercised a real response after the fresh restart, accepted the
  result as looking good, and authorized commit, branch push, and a PR. Merge
  and release remain outside this checkpoint.
## Browser companion PR remediation checkpoint 9 (2026-08-17)

- Goal: take Jacob's latest PR 6 onboarding/removal work, resolve the verified
  security, setup-completion, lifecycle, preview, and transient-data findings,
  and push the reviewed result back to the existing PR branch.
- Done criteria: editable DOM and selections cannot escape redaction; capture
  results are bound to the exact probed tab and selected relay session; Settings
  can open/copy the Chromium and Firefox setup targets; ordinary dismissal
  discards unsent clips without breaking external picker handoff; setup status
  remains ordered and quiet during shutdown; full runtime/UI gates and diff
  checks pass; the exact commit is pushed to PR 6.
- Branch/worktree: `jacob-pr6-review-20260817` at
  `/home/sbull/worktrees/omarchy-omapilot-browser-setup`, based on PR head
  `3cdcfd04eaef823f79bfe292cf66c180e8c497a3`. Rollback checkpoint remains
  `browser-companion-setup` at `f2e088c829ebf8c077e195f0fff3942f294dc298`.
- Allowed: scoped source/QML/docs/tests/generated bundle edits, local static and
  headless verification, commit, and push to
  `jacob-vincent-mink/omarchy-omapilot:feature/contextual-attachment-choices`
  through PR 6's maintainer-edit permission.
- Forbidden: merge, release, plugin installation, browser extension/relay
  installation, browser or shell restart, live desktop mutation, edits to other
  worktrees, provider-policy changes, or deletion of the rollback checkpoint.
- Verification gates:
  - [x] Reproduce the PR-head visual-preview failure and inventory all five
    verified findings against Jacob's three onboarding commits.
  - [x] Implement source-level redaction, tab/session binding, guided setup,
    status lifecycle protection, and dismissal cleanup.
  - [x] Add focused extension, broker, setup, protocol, and QML contract coverage.
  - [x] Pass full validation, UI/headless contracts, deterministic generated
    artifacts, and Git whitespace checks.
  - [x] Inspect the complete diff, commit, push, and verify PR 6 exact-head state.
- Current checkpoint: the reviewed commit is the PR 6 publication artifact; all
  source/static/headless gates pass. No installed or live state has been changed.

## OmaPilot blur-only perimeter follow-up checkpoint 12 (2026-08-18)

- Goal: remove the visibly separate solid dash from the accepted perimeter
  animation so the moving signal reads as one continuous soft glow.
- Owner evidence:
  `/home/sbull/Pictures/screenshot-2026-08-18_14-33-42.png` shows the 2-pixel
  `runnerCore` as a hard cyan segment at one end of the wider bloom.
- Done criteria: the component paints exactly one hidden theme-accent Shape into
  one MultiEffect; no crisp core layer or core-specific state remains; direction,
  phase continuity, terminal/reduced-motion settling, and layout behavior stay
  unchanged; focused, full, native Wayland, installed, and owner gates pass.
- Branch/worktree: `blur-only-perimeter-runner` at
  `/home/sbull/worktrees/omarchy-omapilot-blur-only`, based on merged `main`
  commit `c36771c`.
- Allowed: the scoped component, contract/docs evidence, local validation,
  native Wayland preview, and reversible update of the already installed local
  plugin for owner testing. Forbidden: broker/provider/policy/protocol changes,
  shell settings, unrelated desktop configuration, commit, push, PR, merge, or
  release without separate owner authorization.
- Verification gates:
  - [x] Remove `runnerCore`, `coreSpan`, and `responseActivityCore`.
  - [x] Add a contract guard requiring exactly one accent stroke and dash path.
  - [x] Pass focused QML/UI validation.
  - [x] Render the real Qt MultiEffect on Wayland and confirm no hard segment.
  - [x] Pass full repository validation.
  - [x] Receive a clean independent diff review or resolve every finding.
  - [x] Install the reviewed one-file production update.
  - [ ] Resolve or owner-accept the shell-owned `shell.json` drift observed after
    restart (`ed0f6bcc…` before, `b6b8d498…` after); do not revert blindly.
  - [ ] Owner confirms the live blur-only runner.
- Review worker: named Herdr Claude agent `omapilot_blur_review`, pane `w1A:pE`,
  in this worktree, read-only. The orchestrator owns any remediation and cleanup.
- Current checkpoint: the focused UI suite passes and the 1232 by 1252 native
  Wayland capture shows one diffuse runner with no separate hard stroke. Full
  validation passes 156 runtime tests with 12 opt-in live-provider skips plus
  manifest, browser-companion, release, typecheck, lint, build, QML/UI, and Git
  whitespace gates. Shellcheck remains unavailable. Independent review found
  the hard-core removal sound; its contract robustness and evidence-bookkeeping
  findings are resolved and mutation-tested. The installed component now
  byte-matches the reviewed worktree (`ddca70ed…`), plugin validation passes,
  a fresh shell/broker process loaded it without OmaPilot QML errors. The shell
  later rewrote `shell.json` from `ed0f6bcc…` to `b6b8d498…` during the live
  verification sequence; the orchestrator did not edit or restore that
  user-owned file. The prior component is recoverable from
  `/home/sbull/.local/state/omarchy/omapilot-backups/20260818T193946Z-before-blur-only/`.
  Installed owner verification remains open.

## Personal capability packs checkpoint 13 (2026-08-22)

- Goal: make OmaPilot's personal-assistant integrations discoverable and
  pluggable, with useful built-in defaults for Email, Calendar, Files,
  Projects, Messages, and Meetings.
- Done criteria: one broker-owned capability registry reports truthful
  operation-level readiness; HEY email/calendar and a configured local-files
  root use typed, bounded tools; meetings can open a validated join URL;
  Basecamp and Signal surface actionable missing/setup states without being
  installed automatically; Settings has an accessible Skills surface; Pi uses
  the registered tools and ACP has a reviewed bridge plan or implementation;
  external writes cannot inherit dangerous auto-approve or durable grants;
  focused tests, the complete repository check, and final diff review pass.
- Branch/worktree: implemented as `capability-packs` at
  `/home/sbull/worktrees/omarchy-omapilot-capability-packs`, rebased on `dev`
  commit `5767300`, then fast-forwarded into local `dev`.
- Allowed: scoped repository source, QML, documentation, tests, generated
  bundles, read-only local capability probes, and—following the owner's
  2026-08-23 landing authorization—commit, rebase, and local merge. Forbidden:
  package installs, OAuth/login, Signal pairing, container creation, plugin
  installation, shell restart, user configuration edits, pushes, releases, and
  reading personal email, calendar, files, projects, or messages during tests.
- Verification gates:
  - [x] Add the capability registry, schemas, probes, risk classes, and status protocol.
  - [x] Add typed HEY Email/Calendar, scoped Files, and Meetings tools.
  - [x] Add Basecamp and Signal readiness/setup reporting.
  - [x] Add the Settings Skills surface and configuration flow.
  - [x] Add Pi wiring and the safest practical ACP tool bridge.
  - [x] Pass focused runtime and QML tests, full validation, and diff review.
- No workers are assigned. The orchestrator owns implementation and review.
- Current checkpoint: six default packs, their bundled skills, Pi tools, and a
  read-only scoped ACP MCP bridge are implemented. External writes are one-shot
  only; OpenCode receives no registry or Files tools under its no-host-reads
  policy. Full repository validation passes 237 tests with 8 opt-in live ACP
  tests skipped, the QML/UI contract and rendered Skills preview pass, release
  packaging and checksums pass, and Git whitespace checks pass. Shellcheck is
  unavailable and was skipped. The feature commit is `361c9a4`; local `dev`
  also contains the canonical-checkout bundle normalization. The pre-existing
  uncommitted policy-copy edits were restored byte-for-byte and remain owned by
  their original author. No account setup, user configuration, push, install,
  shell restart, or live personal-data read occurred.

## Guided first-run setup checkpoint 14 (2026-08-23)

- Goal: turn OmaPilot's existing authentication failure recovery into a small,
  ordered first-run path that continues through voice and explicit global-hotkey
  setup.
- Done criteria: unauthenticated users retain the existing sign-in recovery;
  successful authentication reveals a focused Voice next step; new installs
  default to ElevenLabs; completing voice reveals a shortcut next step that
  opens the existing explicit-consent Global hotkeys control; successful hotkey
  installation persists setup completion; focused, full, rendered/runtime, and
  independent Fable review gates pass; a PR is opened against `dev`.
- Branch/worktree: `feat/oobe-guided-setup` at
  `/home/sbull/.t3/worktrees/omarchy-omapilot/t3code-bb33724e`, based exactly on
  `origin/dev` commit `cb34395`.
- Allowed: scoped QML, manifest, docs/tests, local build and rendered/runtime
  verification, commit, push, and PR creation. Forbidden: merge, release,
  production/customer data, secrets, billing, edits to other worktrees, or
  implicit hotkey installation without the user's button press.
- Verification gates:
  - [x] Align the isolated worktree to current `origin/dev` and inventory the
    authentication, voice, and explicit-consent hotkey paths.
  - [x] Implement the ordered setup guide and ElevenLabs default with coverage.
  - [x] Pass focused tests, full validation, generated-artifact, and diff gates.
  - [x] Render and exercise the first-run states in the local UI.
  - [ ] Receive a clean independent Fable review or resolve every finding.
  - [x] Commit, push, and open PR 26 against `dev`.
  - [x] Confirm PR 26 CI passes on the published implementation head.
- Worker state: `HERDR_ENV` is unset in this T3 session, so no named Herdr
  worker may be started or controlled. The required Fable review remains a PR
  checkpoint. After local validation, the owner explicitly instructed the
  orchestrator to publish the PR before that review could run.
- Current checkpoint: the existing authentication recovery remains unchanged;
  authenticated empty chats now show Voice step 2 and Global keybinds step 3.
  Voice opens with ElevenLabs selected, and Desktop opens with the explicit
  installer visible. Completion is persisted only after voice is ready and the
  existing hotkey installer exits successfully; the user remains in Settings to
  see its result. `./scripts/validate.sh` passes 243 runtime tests with 8 opt-in
  live-provider skips plus manifest, hotkey, browser, release, typecheck, lint,
  build, QML/UI, native Wayland smoke, rendered-state, plugin-validation, and
  Git whitespace gates. Shellcheck is unavailable and skipped. Rendered evidence
  is in ignored `screenshots/implementation-omapilot-{setup-voice,setup-hotkeys,
  voice-settings,desktop-settings}.png`. Fable review remains pending because
  this session is outside Herdr. The reviewed candidate was committed as
  `79e53ab`; PR 26 is open at
  `https://github.com/spencerbull/omarchy-omapilot/pull/26` against `dev`.
  GitHub CI passed `validate` in 1m42s and `package` in 23s on the published
  implementation-plus-publication-ledger head `a996e10`.
