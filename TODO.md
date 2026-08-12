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
- Answer and Web-only permission profiles fail closed.
- Markdown, safe links, direct images, and click-to-load remote images render.
- The newest 30 completed chats persist with bounded cached content.
- Voxtype file-output dictation and Herdr native/transcript handoff work.
- Focused tests, QML lint, independent review, and live Quattro verification pass.
- Repository, release assets, provenance, and marketplace documentation are public.

## Streams

| Stream | Branch/worktree | Owns | Status |
| --- | --- | --- | --- |
| QML surface | `quattro-ui` / `/home/sbull/worktrees/omarchy-quickchat-ui` | Bar widget, panel, components, QML tests | Pending |
| ACP runtime | `broker-runtime` / `/home/sbull/worktrees/omarchy-quickchat-broker` | Broker, provider adapters, history, Herdr/Voxtype helpers, unit tests | Pending |
| Plugin/release | `plugin-compliance` / `/home/sbull/worktrees/omarchy-quickchat-compliance` | Manifest, docs, validation, CI/release packaging | Implemented; merge/review pending |

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

- [ ] Inspect and merge all three stream diffs deliberately.
- [ ] Static checks and focused tests pass.
- [ ] `omarchy plugin validate .` passes.
- [ ] Independent review has no unresolved actionable findings.
- [ ] Live shell: open, submit, stream/stop, history, dismissal/reopen, error, keyboard, theme, and narrow layout verified.
- [ ] `design-qa.md` says `final result: passed`.
- [ ] Public main branch and release assets are published.

## Open checkpoints

- Release asset publication follows local runtime and UI verification.
- Marketplace submission follows validation from the public repository.
- Add verified live light/dark captures to the README.
- Decide and verify the release layout that makes the broker available after a plain Omarchy clone without hooks.
