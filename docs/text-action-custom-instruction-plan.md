# Implementation plan: custom selected-text instruction

## Goal

Implement the approved custom-instruction row from
`text-action-custom-instruction-spec.md` without changing the broker protocol,
the replacement safety boundary, or the ephemeral-history contract.

## 1. Lock the component contract with tests

Files:

- `tests/BackendStub.qml`
- `tests/text-action-surface-probe.qml`
- `tests/check-ui-contract.sh`

Work:

- Extend the chooser action signal to carry `action`, `instruction`, and
  `language` explicitly.
- Add surface-probe expectations for a collapsed fourth row, expansion,
  explicit-focus behavior, empty submission, valid submission, and draft
  retention after a refused submission.
- Prove that typing `1`, `2`, or `3` inside the custom editor inserts text and
  never triggers a preset.
- Add structural checks that both hosts hide their normal composer while the
  selection chooser is visible.

Exit condition: the new tests fail for the intended missing behavior while all
existing preset, translation, preview, and history assertions still compile.

## 2. Add local custom-editor state to the chooser

File: `components/TextActionChooser.qml`

Work:

- Add `customExpanded` and `customDraft` state owned by the chooser.
- Add a fourth `Custom instruction` disclosure row after Translate.
- Expand an inline multiline editor with a persistent `Instruction` label and
  a `Run instruction` button.
- Keep Enter as a newline; handle Ctrl+Enter and Cmd+Enter as submission.
- Reject empty or whitespace-only drafts locally.
- Route every action through one guarded `requestAction` function so preset,
  translation, custom button, and keyboard paths cannot diverge.
- Prevent the chooser's numeric shortcut handler from observing key events
  whose focus is inside the custom editor.
- Expose `collapseCustom()` alongside the existing popup API, restore focus to
  the disclosure on collapse, and clear local state when the selected-text
  operation ends.
- Keep Translate's selector and Run button independent of the custom draft.

Exit condition: the chooser alone satisfies expansion, keyboard, focus,
disabled, narrow-width, and accessibility probes.

## 3. Wire both hosts and remove the duplicate editor

Files:

- `Panel.qml`
- `components/ConsoleContent.qml`
- `components/Composer.qml` only if a shared visibility contract is cleaner
  than host-level visibility

Work:

- Pass `instruction` and `language` from the chooser to
  `runTextAction(action, instruction, language)` in both hosts.
- Hide the normal chat composer while `selectionChoosing` is true; restore it
  immediately after submission, dismissal, or failure of the operation.
- Extend each Escape ladder in this order: close language popup, collapse the
  custom editor, then run the existing surface dismissal behavior.
- Preserve the sidebar placement under the metadata divider and the panel
  placement above its answer body.
- Keep quick actions suppressed while the chooser is active.

Exit condition: there is exactly one editable custom-instruction field on each
surface and no layout jump moves it below the conversation.

## 4. Reuse and harden store semantics

File: `components/OmaPilotStore.qml`

Work:

- Reuse the existing `runTextAction("custom", instruction, language)` path;
  do not add a broker command or persistence field.
- Confirm a successful custom run records `selectionInstruction` for
  Regenerate but never updates `configuredTextActionLast`.
- Confirm a refused submit restores `selectionChoosing`, `selectionAction`, and
  `selectionInstruction`; the chooser-owned draft must remain intact.
- Confirm `endTextAction`, replacement completion, a new selection, and
  dismissal clear all operation state.
- Keep `saveToHistory: false` and omit `resumeChatId` for the custom action just
  as for the three presets.

Exit condition: store probes cover success, refusal/retry, regeneration,
dismissal, and ephemeral submission for a multiline custom instruction.

## 5. Certify the complete visual flow

Files:

- `tests/text-action-probe.qml`
- `tests/text-action-surface-probe.qml`
- `tests/text-action-browser-e2e.mjs`
- GTK/Qt desktop E2E fixtures where the shared route adds useful coverage
- `docs/test-matrix.md`

Work:

- Exercise: select text → open Custom instruction → type multiline instruction
  → run → inspect Before / After at the top → Regenerate → Replace.
- Verify no external text changes before Replace and exact replacement after
  it.
- Verify no chat-history row is created and the conversation behind the action
  remains intact.
- Cover narrow sidebar width, a long selection, a long instruction, keyboard
  submission, Escape collapse, busy/disabled state, and a refused send.
- Run `npm run check`, `npm run test:qml`, desktop E2E, and repository
  validation. Record ShellCheck as an environment prerequisite if it remains
  unavailable rather than silently skipping it.

Exit condition: all automated gates pass and three consecutive installed
desktop runs complete without insertion before Replace or history leakage.

## 6. Final review and handoff

Work:

- Run `/post-review --strict` over the complete branch diff.
- Correct every confirmed finding and rerun the affected gates plus the full
  QML certification.
- Deploy the reviewed files to the installed development plugin, restart only
  the Omarchy shell, and leave the custom flow open in workspace 2 for manual
  acceptance.
- Update the spec status from Proposed to Implemented only after manual signoff.

Exit condition: clean worktree, committed implementation, passing gates, and
manual approval of expansion, preview, and Replace behavior.

## Expected scope

No runtime or provider changes are expected. The likely production diff is
limited to the shared chooser, its two hosts, and possibly the composer
visibility contract, plus probes and desktop E2E coverage. The principal risk
is keyboard/focus interaction, not data flow.
