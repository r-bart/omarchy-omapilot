# Quickchat design QA

## Reference and scope

- Selected direction: `exec-401cc7ba-2ca0-4b11-8606-352e9285bf89.png`.
- Installed surface: the current Omarchy Quattro bar widget and anchored panel
  on the active Rebel Rebel theme.
- Primary journey: open from the bar, choose a harness/model, ask or dictate one
  question, read Markdown, reuse history, and continue the saved answer in
  Herdr.

## Comparison verdict

The implementation preserves the selected concept's quiet top-right entry,
compact anchored surface, monospaced native-shell typography, restrained theme
border, and single-question emphasis. It deliberately replaces the concept's
three top-level provider tabs with native provider and model pickers because
the installed harness catalogs are dynamic. Answer/Web, dictation, history,
copy, new-chat, and Herdr actions remain secondary to the composer and answer.

The live panel is taller than the concept when an answer is present, but it
stays within the host's fitted 560 by 420 design envelope and keeps long output
inside the answer scroller. It does not crowd the bar: current Quattro exposes
no reliable spare-width contract, so the shipped bar surface remains an icon
and the full composer lives in the anchored panel.

## Checked states

- [x] Bar icon and anchored open/close behavior on the installed shell.
- [x] Current Omarchy theme colors, typography, border, radius, and focus fill.
- [x] Codex, Claude, and OpenCode provider/model catalogs before submission.
- [x] Markdown blocks, copy affordances, safe clickable links, and explicit
  click-to-load remote-image placeholders covered by focused QML/runtime tests.
- [x] Empty, completed-answer, history, native-Herdr handoff, and transcript
  fallback states.
- [x] Escape/popout focus behavior and narrow fitted panel covered by QML
  contract and installed multi-monitor interaction.
- [x] Harness failures and forbidden-tool attempts use stable, non-sensitive
  in-panel errors.
- [x] Continue in Herdr raises the real window and focuses the intended reused
  workspace, tab, and agent pane from the installed panel button.

## Residual release note

The README capture should use the completed-answer state from the installed
theme rather than the generated concept. OmaAsk is a post-v0.1 identity and
migration project; it does not alter this release's stable Quickchat IDs.

final result: passed
