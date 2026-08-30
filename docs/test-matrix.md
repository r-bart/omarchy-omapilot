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
| Stale, chatty, empty, or oversized answers cannot replace | Text-action tests | `text-action-probe.qml` | Refusal remains visible and target unchanged |
| Clipboard ownership and restoration are safe | `selection.test.ts` | Broker lifecycle | Clipboard changed during turn |
| Replacement targets the latched window | Selection/store tests | `text-action-probe.qml` | Focus changes before acceptance |
| Cancellation, timeout, close, and restart fail closed | Broker/store tests | Lifecycle probes | One run per interruption |

## Desktop application matrix

Run Fix and one multiline Translate through both chooser and direct hotkey on:

| Toolkit | Target controls | Expected result |
| --- | --- | --- |
| Chromium | input, textarea, contenteditable | Selection replaced once; focus retained |
| GTK | single-line and multiline editor | Selection replaced once; focus retained |
| Qt | single-line and multiline editor | Selection replaced once; focus retained |
| Electron | input and editor surface | Selection replaced once; focus retained |
| Terminal | editable command line | Selection replaced once; command not executed |

Record the application/version, surface, action, input route, final text,
clipboard result, and logs. A failure in any supported cell blocks release; an
unsupported widget must be documented as a product limitation rather than
silently omitted.

## Certification record

For each release candidate record:

- exact Git commit and clean-worktree proof;
- Node, Qt, Quickshell, Omarchy, compositor, and application versions;
- JUnit/coverage reports and QML logs;
- three consecutive green deterministic desktop runs;
- authenticated provider results and timestamp;
- every explicit limitation or waived live dependency.
