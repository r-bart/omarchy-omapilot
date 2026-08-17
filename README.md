# OmaPilot for Omarchy

OmaPilot is a native [Omarchy Quattro](https://github.com/basecamp/omarchy/tree/quattro) bar widget for asking questions and working on your desktop through an authenticated AI harness. Device actions stay behind an exact, inspectable approval unless you explicitly enable **Dangerous auto-approve** in settings. OmaPilot can attach a bounded desktop snapshot when you submit, renders Markdown in a themed panel, remembers the latest 30 completed chats, and can hand an answer to Herdr when you want to keep working.

The public project and product name is now OmaPilot. The existing plugin ID, IPC target, package/runtime identifiers, and local `quickchat` data paths remain unchanged so current installations and user data continue to work.

> [!IMPORTANT]
> The compatibility-ID `0.1.1` build is the current published release. Protocol-2 version `0.2.0`
> remains unreleased until its release and marketplace gates are complete in
> [`TODO.md`](TODO.md).

## Preview

![OmaPilot answering from OpenCode in the active Omarchy Quattro theme](docs/assets/quickchat-live.png)

The compact composer expands from the right side of the bar. Its result panel
supports selectable Markdown, code blocks, tables, safe clickable links,
bounded images, Copy, New chat, History, and Continue in Herdr. The in-panel
settings pane can add, edit, remove, and reorder up to five quick actions.
Waiting uses a restrained fixed-route energy wave with a long resting cadence;
real streamed content drives coalesced follow-up waves without moving-marker
resets. Phase copy, first-token content, panel growth, and follow-latest scrolling
transition smoothly, while a compact error notice opens an inspectable details
pane.

## Requirements

- Omarchy Quattro with the native shell plugin architecture.
- Linux x86-64 for the initial prebuilt runtime.
- Node.js 22 or newer for the broker and pinned ACP adapters.
- At least one installed and authenticated harness: `codex`, `claude`, or `opencode`.
- Optional: Voxtype for dictation and Herdr for durable continuation.

OmaPilot does not install a harness, log you in, or read provider credentials. Authentication and model availability remain owned by the selected harness. The model picker is populated at startup from Codex's read-only app-server catalog, a non-persisted Claude ACP discovery session, or OpenCode's native catalog; if discovery is unavailable, OmaPilot safely falls back to the harness default.

## Install

Review the repository before enabling it: Omarchy plugins execute unsandboxed inside the long-lived shell process.

```bash
omarchy plugin add https://github.com/spencerbull/omarchy-omapilot.git
omarchy plugin validate ~/.config/omarchy/plugins/io.github.spencerbull.quickchat
omarchy plugin enable io.github.spencerbull.quickchat right
```

The Omarchy installer only clones, validates, and enables the plugin. It runs no install hook, `sudo`, package manager, or host-configuration mutation. The reviewed repository revision includes self-contained broker and ACP adapter bundles, so a normal install does not run `npm`, `npx`, or silently download executable code. Git history anchors those checked-in bundles to their TypeScript source and pinned lockfile; release archives add an SBOM, provenance record, and SHA-256 checksum.

Update or remove it with the standard plugin commands:

```bash
omarchy plugin update io.github.spencerbull.quickchat
omarchy plugin remove io.github.spencerbull.quickchat
```

Removal deletes the cloned plugin. OmaPilot deliberately leaves user-owned history and cached runtime files in place. Use **Clear all** before removal to erase history and cached chat images. If the plugin is already gone, inspect and remove the compatibility-path `quickchat` directories under your effective `XDG_STATE_HOME` and `XDG_CACHE_HOME` with a file manager; the default locations are `~/.local/state/quickchat` and `~/.cache/quickchat`.

## How it works

```text
Omarchy BarWidget/Panel
        │ submit-time Hyprland/MPRIS snapshot
        │ one JSON command/event per line
        ▼
OmaPilot broker
        │ Agent Client Protocol over stdio
        ├── Codex ACP ── authenticated Codex CLI
        ├── Claude ACP ─ authenticated Claude harness
        └── OpenCode ACP ─ authenticated OpenCode CLI
```

Codex and Claude use exact, source-pinned official ACP adapter packages bundled in the repository. OpenCode uses its native `opencode acp` command. The broker normalizes provider discovery, streamed text/images, cancellation, permissions, errors, and session identities; QML does not parse provider-specific output.

Every request uses the selected harness and its reviewed automatic policy.
OmaPilot displays each exact device approval, or auto-selects its allow-once
option when the dangerous setting is enabled.
Every harness can load relevant installed skills and decide whether a tool is
needed:

- **Codex** may use its read-only device tools and read files available to the
  current user without asking. Native web search stays disabled in the same
  session so those reads cannot become unapproved search queries. Any command
  requesting network or broader device authority pauses behind an exact
  **Allow once** or **Deny** card showing the adapter-normalized command and
  working directory.
- **Claude** may load installed skills from a disposable, MCP-free plugin copy,
  search the web, and run commands inside a disposable
  scratch workspace. Host paths and credential-bearing environment variables
  stay hidden, direct process network access is blocked, and writes remain
  confined to per-turn scratch. Commands inside that fixed boundary may run
  automatically. A command that needs host/device authority pauses behind the
  same exact **Allow once** or **Deny** card. Approval applies only to that
  command and runs it outside the disposable sandbox with the current user's
  device, network, host-file, and process-environment authority.
- **OpenCode** may load installed skills and use its positively identified web
  search tool automatically. Its native `bash` permission is fixed to `ask`;
  the broker accepts execution only after the exact command receives a
  request-bound **Allow once** decision. Other OpenCode tools remain denied.

Every supported permission decision is bound to the exact in-flight request.
Oversized or visually ambiguous requests, persistent grants, arbitrary MCP,
browser/computer control, unclassified tools, and uninspectable targets remain
blocked. OmaPilot removes its per-turn working directory afterward. Raw tool
requests, decisions, inputs, and outputs are not stored in chat history; a
completed answer may contain tool- or web-derived text and is retained normally.
OmaPilot never bypasses a harness permission system. When **Dangerous
auto-approve** is enabled, a submission automatically selects only the
normalized request's provider-native **Allow once** choice instead of showing
the approval card. The setting cannot select a persistent grant and does not
enable tools for a harness whose provider policy blocks them. It is off by
default because approved commands run with the authority described above and
may modify or delete user data or use the network.

The broker does not classify prompt phrases or hardcode individual use cases.
Questions and action requests follow the same provider path; the selected
harness decides whether a tool is useful. Any broader device command remains
inside the exact request-bound decision described above, whether that decision
is made from the approval card or by Dangerous auto-approve.

Each harness receives the same hidden OmaPilot instructions. They frame desktop
context as optional, untrusted evidence; direct the harness to discover relevant
installed skills, Omarchy commands, CLIs, apps, and plugins before declining;
prefer the system default browser for authorized navigation; and use available
web search for current or otherwise unknown information. These instructions
shape how a harness chooses among capabilities but cannot enable a capability
or bypass the provider policy and approval boundary above.

## Desktop context on submit

Desktop context is **On** by default and can be disabled in the widget's
Omarchy settings. OmaPilot remembers the active app as its panel opens (before
the panel takes keyboard focus), then reads the remaining public Quickshell
objects when you send. It attaches:

- the active window's app ID, title, workspace, and monitor;
- up to 12 deduplicated open-app IDs with window counts and workspace IDs; and
- player identity, track title, and artist for up to four currently playing MPRIS sources.

OmaPilot does not capture compositor window handles, inactive window titles,
screenshots, clipboard contents, page bodies, hidden browser tabs, browser
history, keystrokes, or file contents as desktop context. A browser's current
tab may be recognizable only when the browser exposes it in the active window
title.

Window and media strings are length-bounded, stripped of control and
bidirectional-display characters, and labeled as untrusted observational data
before being sent to the harness. The selected harness still decides whether
the context is relevant and whether a tool is needed. OmaPilot stores the
original question—not the snapshot—in its chat record, but the selected
provider receives the combined prompt and may retain it in its native session.
An answer derived from desktop context is retained like any other completed
answer.

## Storage and privacy

OmaPilot persists only completed chats, capped at the newest 30. A chat contains the question, rendered answer source, timestamp, provider/model metadata, content references, and a resumable session identity when the harness supplies one. Draft text, authentication output, tokens, environment variables, and provider credentials are not persisted.

Quick-action labels, prompts, and order are stored with the existing inline
Omarchy widget settings. OmaPilot validates that list on every read, drops
invalid entries, and caps it at five.

| Path | Purpose |
| --- | --- |
| `${XDG_STATE_HOME:-~/.local/state}/quickchat/` | Atomic local history and resumable session metadata |
| `${XDG_CACHE_HOME:-~/.cache}/quickchat/` | Bounded, validated image cache |
| `${XDG_RUNTIME_DIR}/quickchat/` | Per-login sockets, temporary dictation, and in-flight data |

Remote Markdown images are not fetched automatically. OmaPilot shows the origin and requires a click before loading a validated HTTPS image. Links are scheme-checked and never interpolated into a shell command. See [`SECURITY.md`](SECURITY.md) for the threat model and reporting process.

## Optional integrations

- **Voxtype:** when `voxtype` is installed and ready, the microphone records directly to a file under `$XDG_RUNTIME_DIR/quickchat`; OmaPilot reads that transcript after recording stops. It never simulates keyboard input or modifies Voxtype configuration.
- **Herdr:** when `herdr` is installed, Continue in Herdr launches it when needed or raises its existing window, creates or reuses the compatibility-named `Quickchat` workspace, creates a labeled tab, closes the OmaPilot panel, and focuses the resumed agent pane. It resumes the native harness session when possible, otherwise starts the matching agent with a compact transcript and labels the fallback. A native resume retains whatever context the provider kept in that session; a transcript fallback receives only the stored question and answer, not the raw desktop snapshot. This is an explicit handoff from OmaPilot's one-shot permission boundary to Herdr's normal native-agent permission model; Codex resumes read-only and asks before commands.

Both integrations disappear or show a clear unavailable state when their required command is missing.

## Future browser context

The main future context feature is an optional **OmaPilot Browser Companion**.
It would be a separately installed browser extension and local native-messaging
bridge that can provide the active tab URL/title and, only with explicit site
permission, selected text or bounded visible-page text. The intended rules are:

- the Omarchy plugin remains fully useful without the extension;
- context is visibly disclosed and captured only when a request is submitted;
- page access is opt-in and scoped per site, with no browsing-history collection;
- the bridge accepts a small versioned schema and does not expose a general command channel; and
- the extension avoids Chrome's broad `debugger` permission and requests only the minimum tab/site/native-messaging permissions needed for enabled features.

Because native messaging requires browser-host registration outside the
Omarchy plugin directory, that companion would need its own explicit,
reversible install and removal flow; the normal OmaPilot plugin install would not
silently add it.

Other roadmap candidates build on that same context contract: user-selectable
context sources, richer app-specific adapters, and a preview of exactly what
will be shared before submit. Browser actions would come later, only with their
own inspectable per-action approval boundary for authenticated sites.

## Development

```bash
./scripts/validate.sh
./scripts/package-runtime.sh --dry-run
```

After the broker has been built, assemble a local release artifact without publishing it:

```bash
npm ci
npm run build
./scripts/package-runtime.sh --output-dir dist/release
```

The package helper stages the self-contained checked-in runtime, emits a lockfile-derived CycloneDX SBOM, normalizes timestamps and ownership, creates a deterministic archive, and writes `SHA256SUMS`. Release details and marketplace gates are in [`docs/release.md`](docs/release.md).

## License and attribution

OmaPilot is MIT licensed. ACP adapters and bundled dependencies retain their own licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the generated release SBOM.
