# Custom instruction for selected text

## Status

Proposed. This document fixes the product and interaction decisions needed to
plan implementation; it does not authorize production changes by itself.

## Problem

The selected-text card offers Fix, Rewrite, and Translate, but does not make the
existing custom-instruction capability visible. A user who wants “make this
more formal” or “turn this into two bullets” has to infer that the composer at
the bottom can act on the selection. That control is physically separated from
the selection and competes with the card's explicit choices.

## Outcome

Add a fourth row, **Custom instruction**, to the selected-text card. It expands
an inline editor where the user describes the transformation. The generated
text uses the existing Before / After preview and is never inserted until the
user presses Replace.

## Interaction

### Resting state

The card keeps this order:

1. Fix
2. Rewrite
3. Translate, including its language selector and Run button
4. Custom instruction

The custom row says what it does, for example: “Describe another transformation”.
It is a disclosure control, not an immediate action.

### Expanded state

Activating Custom instruction expands an editor inside its row. The editor:

- has the persistent label **Instruction**;
- uses the placeholder “Make it more formal…” only as an example;
- includes a primary **Run instruction** button;
- keeps the selected text visible above it;
- receives focus only after an explicit pointer or keyboard activation;
- accepts multiline text.

Only one custom editor exists. While the selection card is visible, the normal
chat composer is hidden. It returns after an action runs or the selected-text
operation ends, so two fields never claim to control the same selection.

### Keyboard

- Enter inserts a newline.
- Ctrl+Enter and Cmd+Enter run a non-empty instruction.
- Escape closes any open language popup first, then collapses the custom row;
  a second Escape follows the surface's existing dismissal ladder.
- The existing numeric shortcuts remain Fix = 1, Rewrite = 2, Translate = 3.
  Custom instruction has no number because pressing 4 must not unexpectedly
  expose and focus an editor while the user is typing elsewhere.

### Submission

Run instruction calls the existing custom text-action path with the exact
trimmed instruction. Empty or whitespace-only input does nothing and keeps the
editor open. Once accepted:

- the chooser disappears;
- the result appears at the top of the sidebar;
- the result card shows Before, a divider, and After;
- Replace remains the only operation that writes into the source application;
- Regenerate repeats the same custom instruction against the same selection.

## Persistence and history

- The custom instruction is scoped to the active selected-text operation.
- It is preserved for Regenerate during that operation.
- It is cleared when the operation ends, is dismissed, or a new selection is
  captured.
- It is never saved as the default action.
- Neither the instruction nor its result is persisted as chat/conversation
  history.
- The last fixed preset remains the Enter default for future selections.

## Error and busy states

- The editor and Run instruction button are disabled while OmaPilot cannot
  submit or is replacing text.
- A refused submission restores the expanded row and preserves the draft so
  the user can retry.
- Existing unavailable/error notices are reused; the card does not introduce a
  second error channel.
- Closing the card discards the draft without confirmation because it has not
  changed the source text.

## Accessibility

- Custom instruction exposes expanded/collapsed state to accessibility APIs.
- The label is programmatically associated with the editor.
- Run instruction has a specific accessible name and a visible focus state.
- Focus returns to the Custom instruction disclosure when the editor collapses.
- The source selection remains static text and is never presented as editable.
- Before and After retain their current heading and reading order.

## Non-goals

- Saving prompt templates or recent custom instructions.
- Adding custom instructions to chat history.
- Editing the captured source text inside OmaPilot.
- Automatically replacing text after generation.
- Changing the broker, provider protocol, or selection-replacement mechanism.

## Acceptance criteria

1. Custom instruction is visible as the fourth action on every surface that
   renders the selected-text chooser.
2. Expanding it does not submit anything and focuses the inline editor only in
   response to explicit user activation.
3. Empty input cannot run; valid multiline input runs via the button or
   Ctrl/Cmd+Enter.
4. Changing or opening the Translate language selector never runs or alters a
   custom instruction.
5. A successful custom action renders the existing Before / After preview at
   the top of the sidebar and requires Replace before writing externally.
6. Regenerate sends the same selection and custom instruction again.
7. A refused submission restores the editor with its draft intact.
8. Dismissal clears the draft and leaves no chat-history record.
9. Normal chat and the three preset actions retain their current behavior.
10. Keyboard, focus, narrow-width, light/dark-state, surface, store, and desktop
    end-to-end tests pass.
