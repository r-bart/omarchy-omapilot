# OmaPilot test and release matrix

This matrix defines what “fully tested” means for OmaPilot. It is a behavioural
contract, not a claim that line coverage can prove the absence of defects.

## Required gates

| Gate | Command | Environment | Release requirement |
| --- | --- | --- | --- |
| Type and lint | `npm run typecheck && npm run lint` | Hermetic | Pass |
| Runtime unit/integration | `npm test` | Loopback and child processes allowed | 0 failures; only the nine named live cases may skip |
| Runtime coverage | `npm run test:coverage` | Same as runtime tests | Ratchet thresholds pass; report archived |
| QML contracts and probes | `npm run test:qml` | Omarchy Quattro imports; Wayland session for Wayland probes | 0 failures, 0 skips |
| Packaging | `./scripts/validate.sh` | Full build toolchain | Pass and generated files clean |
| Authenticated providers | `npm run test:live -- <provider>` | Explicit credentials and network | Every supported provider passes before release |
| Desktop text actions | `tests/text-action-run.sh` plus the application matrix below | Installed candidate in an isolated test profile | Every cell passes three consecutive runs |

The default runtime suite intentionally does not contact providers. Its nine
reported skips are exactly three Codex behaviours, four OpenCode behaviours,
one ElevenLabs probe, and one opt-in live desktop-app probe. Any other skip is a
release failure.

Coverage is ratcheted globally from the measured baseline. The safety-critical
`runtime/src/selection.ts` additionally requires 100% function and line
coverage, at least 96% statements, and at least 92% branches. Raising the
ratchet is required when new tests improve it; lowering it requires an explicit
reviewed justification in this document.

## Text-action behavioural coverage

| Behaviour | Unit | Integration/QML | Desktop E2E |
| --- | --- | --- | --- |
| Selection is bounded and treated as untrusted data | `selection.test.ts`, `tst_text_actions.qml` | `text-action-probe.qml` | Preset and adversarial samples |
| Reading does not submit before consent | `tst_text_actions.qml` | `text-action-probe.qml` | Chooser route |
| Fix, Rewrite, Translate, Custom route correctly | `tst_text_actions.qml` | `text-action-probe.qml` | One run per action |
| Main-row digits, keypad digits, click, and direct hotkeys | `tst_text_actions.qml`, `tst_hotkeys.qml` | `text-action-surface-probe.qml` | One run per input route |
| Panel and console preserve the same action | Store tests | Surface and console probes | Both surfaces |
| Answer belongs to the exact action and turn | History/store tests | `text-action-probe.qml` | Two overlapping/sequential turns |
| Text actions never become chats or resume an open conversation | Broker/protocol tests | `text-action-probe.qml` | History unchanged after replacement |
| Stale, chatty, empty, or oversized answers cannot replace | Text-action tests | `text-action-probe.qml` | Refusal remains visible and target unchanged |
| Clipboard ownership and restoration are safe | `selection.test.ts` | Broker lifecycle | Clipboard changed during turn |
| Replacement targets the latched window | Selection/store tests | `text-action-probe.qml` | Focus changes before acceptance |
| Cancellation, timeout, close, and restart fail closed | Broker/store tests | Lifecycle probes | One run per interruption |

## Desktop application matrix

The gate is layered rather than multiplying every semantic action by every
widget: deterministic runs prove replacement mechanics on each toolkit, while
the installed-UI runs prove direct Fix and chooser-based multiline Translate
through the complete QML/provider path.

| Toolkit | Target controls | Expected result |
| --- | --- | --- |
| Chromium | input, textarea, contenteditable | Selection replaced once; focus retained |
| GTK | single-line and multiline editor | Selection replaced once; focus retained |
| Qt | single-line and multiline editor | Selection replaced once; focus retained |
| Electron | input, textarea, search, contenteditable, controlled input | Selection replaced once; focus retained |
| Terminal | editable command line | Refused before reading or pasting; command remains unchanged |

Record the application/version, surface, action, input route, final text,
clipboard result, and logs. A failure in any supported cell blocks release; an
unsupported widget must be documented as a product limitation rather than
silently omitted.

The automated desktop gate currently covers five Chromium controls, the same
five controls in Electron 44, GTK 4 `TextView`, and Qt `TextArea` through the
packaged broker and real Wayland clipboard/focus tools.
`npm run test:e2e:desktop` requires three consecutive passes. Foot is covered
as an explicit safety limitation: terminal selections belong to visual
scrollback rather than the editor running inside it, so replacement is refused
before reading the primary selection and an isolated command is proven
unchanged.

## Current certification evidence (2026-08-30)

- Runtime: 278 passed; nine explicitly declared live cases skipped by default.
- Coverage: 71.58% statements, 61.66% branches, 76.01% functions, and
  77.13% lines. The global ratchet uses the integer floor of these results.
- Selection safety boundary: 96.82% statements, 92.98% branches, 100%
  functions, and 100% lines.
- QML: 153 tests across all `tst_*.qml` suites pass with zero skips; the
  complete contract and surface-probe suite also passes against the installed
  Omarchy shell imports.
- Shell: ShellCheck 0.11.0 passes every shipped and test-driver script; the
  temporary official binary matched release SHA-256
  `8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198`.
- Desktop replacement: five Chromium controls, the same five Electron 44
  controls, GTK 4 TextView, and Qt TextArea each passed three consecutive real
  Wayland runs. Foot passes its fail-closed command-integrity E2E.
- Installed UI path: QML IPC → packaged broker → built-in provider → Chromium
  replacement passed three consecutive direct Fix runs and three consecutive
  chooser-based multiline Translate runs. One additional chatty translation
  was correctly refused as `not_a_replacement` and did not reach the editor.
  Quickshell's prefixless native window address is normalized only at its
  trusted API boundary, and completion is tied to a new turn identity.
- Authenticated harnesses: Built-in passed three consecutive smoke turns;
  Codex passed its three live policy cases and three consecutive
  provider-to-Chromium replacement runs.
- Open live cells: `opencode auth list` reports zero credentials on this host;
  ElevenLabs has no test key. These are visible external blockers to a claim
  that every optional integration is certified; neither is silently skipped.
- Reproducibility: two consecutive builds produced identical SHA-256 values
  for the broker, capability MCP, and both browser-extension manifests.

## Certification record

For each release candidate record:

- exact Git commit and clean-worktree proof;
- Node, Qt, Quickshell, Omarchy, compositor, and application versions;
- JUnit/coverage reports and QML logs;
- three consecutive green deterministic desktop runs;
- authenticated provider results and timestamp;
- every explicit limitation or waived live dependency.
