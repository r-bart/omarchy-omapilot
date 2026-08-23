# OmaPilot for Omarchy

OmaPilot is a native [Omarchy Quattro](https://github.com/basecamp/omarchy/tree/quattro) bar widget and contextual-capture overlay for asking questions and working on your desktop through an authenticated AI harness. Device actions stay behind an exact, inspectable approval unless you explicitly enable **Dangerous auto-approve** in settings. OmaPilot can attach a bounded desktop snapshot, clip a window or exact region with a reviewed Text/Screenshot choice, render Markdown in a themed panel, remember the latest 30 completed chats, and hand an answer to Herdr when you want to keep working.

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
Built-in follow-ups resume the same durable Pi conversation until **New chat**
is selected, including after the shell restarts. **Continue in Herdr** opens
that same Pi session with OmaPilot's private auth and session directories.
Waiting and streaming use one theme-native perimeter runner around the response
surface. One GPU-blurred accent form replaces the old route glyph without a
separate hard stroke or fake progress; phase changes never restart the runner,
and reduced motion keeps the ordinary static border. First-token
content, panel growth, and follow-latest scrolling transition smoothly, while a
compact error notice opens an inspectable details pane.

## Requirements

- Omarchy Quattro with the native shell plugin architecture.
- Linux x86-64 for the initial prebuilt runtime.
- Node.js 22 or newer for the broker and pinned ACP adapters.
- Credentials for the built-in harness, or an installed and authenticated ACP harness.
- Optional: Voxtype for dictation and Herdr for durable continuation.
- Optional: a TTS provider to speak answers. Kokoro is local
  (`pip install kokoro soundfile` on Python 3.10–3.12, plus `espeak-ng`).
  ElevenLabs and OpenAI need an API key entered in Settings; keys are stored
  in `~/.config/omapilot/voice-auth.json`, not widget settings. Voice stays
  off until enabled there.
- `grim` for contextual screenshots. ImageMagick, already used by OmaPilot's
  image policy, validates and normalizes every captured image.
- Optional: Tesseract adds text-under-the-pointer extraction and the **Text**
  representation. Without it, screenshot and browser-element capture still work.

OmaPilot includes a native Pi-based harness for Codex subscription, OpenAI API,
Grok, and configured OpenAI-compatible endpoints. It resolves credentials from
environment variables or `${XDG_CONFIG_HOME:-$HOME/.config}/omapilot/auth.json`,
discovers shared `~/.agents` skills, Omarchy's official `~/.pi/agent/skills`
root, bundled OmaPilot skills, and named agents. It exposes Pi's standard coding
tools plus verified app, window, workspace, and monitor controls behind
OmaPilot's approval broker. See [Native Pi harness configuration](docs/native-harness.md).
The Harness setting explicitly selects **Built-in (OmaPilot)**, **Codex**, or
**OpenCode**. The latter two are ACP harnesses and must already
be installed and signed in. OmaPilot never substitutes one harness for another.
When Built-in has no configured credential, its settings card offers
subscription and API-key sign-in methods. OmaPilot runs Pi's typed login flow
inside the broker, opens the provider's browser page for OAuth when needed, and
renders provider choices, device codes, progress, and errors in Settings.
Browser OAuth completes through a broker-owned localhost callback; callback
URLs are never user input. It never opens the Pi terminal.

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

## Global hotkeys

OmaPilot exposes compositor-safe IPC actions for continuing the current typed
or voice conversation, starting a fresh one, and handing the current chat to
Herdr. Add the bindings you want to `~/.config/hypr/bindings.lua`:

```lua
-- Continue the current voice chat, or start one when no chat exists.
o.bind("SUPER + A", "Talk to OmaPilot",
  "omarchy-shell -q io.github.spencerbull.omapilot voiceToggle")

-- Start a fresh voice chat. Omarchy uses this chord for ChatGPT by default.
hl.unbind("SUPER + SHIFT + A")
o.bind("SUPER + SHIFT + A", "New OmaPilot voice chat",
  "omarchy-shell -q io.github.spencerbull.omapilot newVoiceChat")

o.bind("SUPER + ALT + N", "New OmaPilot chat",
  "omarchy-shell -q io.github.spencerbull.quickchat newChat")
o.bind("SUPER + ALT + H", "Continue OmaPilot chat in Herdr",
  "omarchy-shell -q io.github.spencerbull.quickchat continueInHerdr")
```

`Super+A` resumes the current durable conversation; `Super+Shift+A` clears that
continuation before recording. New typed chat opens the panel with an empty
composer. Continue in Herdr does nothing until the current conversation has a
saved chat ID. These are user-owned bindings: installing or updating the plugin
does not rewrite Hyprland configuration.

Removal deletes the cloned plugin. OmaPilot deliberately leaves user-owned history and cached runtime files in place. Use **Clear all** before removal to erase history and cached chat images. If the plugin is already gone, inspect and remove the compatibility-path `quickchat` directories under your effective `XDG_STATE_HOME` and `XDG_CACHE_HOME` with a file manager; the default locations are `~/.local/state/quickchat` and `~/.cache/quickchat`.

## How it works

```text
Omarchy BarWidget/Panel
        │ submit-time Hyprland/MPRIS snapshot
        │ one JSON command/event per line
        ▼
OmaPilot broker
        ├── Built-in (selected) ─ Pi runtime ─ Codex / OpenAI / Grok / compatible APIs
        ├── Codex (selected) ─── Codex ACP
        └── OpenCode (selected) ─ OpenCode ACP
```

The native runtime owns model discovery, auth resolution and refresh, skills,
named agents, streaming, and Pi tool execution. The explicitly selected Codex
ACP route uses an exact, source-pinned adapter package; OpenCode uses `opencode acp`.
The broker normalizes both paths so QML does not parse provider-specific output.

Every request uses the selected harness and its reviewed automatic policy.
OmaPilot displays each exact device approval, or auto-selects its allow-once
option when the dangerous setting is enabled.
Every harness can load relevant installed skills and decide whether a tool is
needed:

- **Built-in (OmaPilot)** combines available Codex, OpenAI, Grok, and
  OpenAI-compatible models in one catalog and loads
  declarative skills from `~/.agents/skills`, `~/.pi/agent/skills`, project
  skill roots, and this plugin's bundled `skills/` directory, plus named agents
  from the documented `~/.agents` roots. Its structured desktop tools discover
  exact installed apps and current Hyprland targets, then verify app focus or
  launch, window focus/move/resize/float/close, and workspace focus or monitor
  movement before reporting success.
  The **Skills** settings tab also reports personal capability packs for Email,
  Calendar, Files, Projects, Messages, and Meetings. Ready packs add typed tools
  for HEY, one configured files root, the official Basecamp CLI, a private
  loopback Signal bridge, and validated Zoom links. Bundled domain skills teach
  the agent when to use those tools and how to treat app content as untrusted.
  Pi's read, grep, find, and list tools may read files available to the current
  user. Bash, edit, and write require review unless an exact session or durable
  grant already exists. Executable Pi extensions are not loaded.
- **Codex ACP** may use its read-only device tools and read files available to the
  current user without asking. Native web search stays disabled in the same
  session so those reads cannot become unapproved search queries. Any command
  requesting network or broader device authority pauses behind a card showing
  the adapter-normalized command, working directory, and every provider-native
  once, session, durable, or rejection choice supplied by the adapter.
  OmaPilot also attaches a fixed local MCP server containing only the capability
  registry and the packs' bounded read operations. It does not expose sends,
  file opens, or meeting launches to ACP.
- **OpenCode ACP** may load installed skills and use its positively identified web
  search tool automatically. Its native `bash` permission is fixed to `ask`;
  the broker accepts execution only after the exact command receives a
  request-bound **Allow once** decision. Other OpenCode tools remain denied.

Every supported permission decision is bound to a provider option. Native Pi
session and durable grants match only the exact reviewed request and working
directory. Oversized or visually ambiguous requests, arbitrary provider-supplied MCP,
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

## Personal capability packs

Open **Settings → Skills** to see connector readiness, enable or disable a pack,
refresh status, and choose the one folder Files may inspect. Pack configuration
is broker-owned and validated; missing applications, authentication, and pairing
are reported as setup states rather than installed or changed automatically.

The built-in defaults are:

- Email and Calendar through authenticated `hey-cli`;
- Files inside one canonical local or synced folder, without following symlinks
  outside that root;
- Projects through the authenticated official `basecamp` CLI;
- Messages through `signal-cli-rest-api` only when
  `OMAPILOT_SIGNAL_API_URL` is an HTTP loopback origin and
  `OMAPILOT_SIGNAL_NUMBER` is a linked E.164 number; and
- Meetings through an exact HTTPS `zoom.us` URL opened with Omarchy.

Read operations return bounded data marked as external and untrusted. Visible
device actions use the normal exact approval. Email, HEY to-do, Basecamp, and
Signal writes are stricter: they always require a fresh one-time review and are
never covered by a session grant, durable grant, or Dangerous auto-approve.
Codex receives the registry and bounded read-only pack tools through OmaPilot's
bundled MCP server. OpenCode receives connector reads but no Files tools, which
preserves its fixed no-host-reads policy. Mutations remain exclusive to the
built-in Pi harness until ACP can preserve the same one-shot contract.

## Browser search handoff

Built-in OmaPilot can hand a current-information question to a browser without
adding a paid search API. Choose **Settings → Desktop → Search provider** and
select DuckDuckGo, Google, ChatGPT Search, Claude, or Grok. The `web_handoff`
tool shows an approval card with the provider, exact question, and destination
URL, then opens it through `omarchy launch browser`.

DuckDuckGo and Google receive a normal search query. AI sites receive a
search-oriented prompt in their URL and a paste-ready clipboard copy as a
fallback because their web composers may not reliably prefill. This is an
interactive handoff: OmaPilot reports that the browser opened, but it does not
read, synthesize, or verify the answer shown there. OpenCode's native search,
when available under its own policy, remains separate from this setting.

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

## Clip context from the desktop

The crosshair button in the composer opens OmaPilot's fullscreen capture
overlay. Click a window beneath the pointer, or drag an exact region. OmaPilot
resolves the click against the compositor's window geometry, so opening the
panel or overlay does not change the intended target. The overlay disappears
before the screenshot is taken.

When Tesseract is installed, OmaPilot uses its word boxes to find the text under
the click and expands it to the surrounding paragraph. The composer then shows
a local thumbnail and a selector with the representations actually available:
**Text**, **Screenshot**, or **Text + screenshot**. OCR failure is not an error;
the validated screenshot remains the fallback. Removing the attachment deletes
its broker-owned input image, and submitting sends only the selected
representation—not every locally generated alternative.

Context clips are explicit and single-shot. OmaPilot does not continuously
watch the pointer, index accessibility trees, monitor the clipboard, or capture
screens in the background. Password-manager and password-like windows are
blocked conservatively. Clip text and pixels are framed as untrusted
observational data and do not expand tool authority.

## Storage and privacy

OmaPilot persists only completed chats, capped at the newest 30. A chat contains the question, rendered answer source, timestamp, provider/model metadata, content references, and a resumable session identity when the harness supplies one. Draft text, authentication output, tokens, environment variables, and provider credentials are not persisted.

Quick-action labels, prompts, and order are stored with the existing inline
Omarchy widget settings. OmaPilot validates that list on every read, drops
invalid entries, and caps it at five.

| Path | Purpose |
| --- | --- |
| `${XDG_STATE_HOME:-~/.local/state}/quickchat/` | Atomic local history and durable Pi conversation sessions |
| `${XDG_CONFIG_HOME:-~/.config}/omapilot/capabilities.json` | Enabled packs and the canonical Files root (mode 0600) |
| `${XDG_CACHE_HOME:-~/.cache}/quickchat/` | Bounded, validated image cache |
| `${XDG_RUNTIME_DIR}/quickchat/` | Per-login sockets, temporary dictation, and in-flight data |

Remote Markdown images are not fetched automatically. OmaPilot shows the origin and requires a click before loading a validated HTTPS image. Links are scheme-checked and never interpolated into a shell command. See [`SECURITY.md`](SECURITY.md) for the threat model and reporting process.

## Optional integrations

- **Voxtype:** when `voxtype` is installed and ready, the microphone records directly to a file under `$XDG_RUNTIME_DIR/quickchat`; OmaPilot reads that transcript after recording stops. It never simulates keyboard input or modifies Voxtype configuration.
- **Herdr:** when `herdr` is installed, Continue in Herdr launches it when needed or raises its existing window, creates or reuses the compatibility-named `Quickchat` workspace, creates a labeled tab, closes the OmaPilot panel, and focuses the resumed agent pane. It resumes the native harness session when possible, otherwise starts the matching agent with a compact transcript and labels the fallback. A native resume retains whatever context the provider kept in that session; a transcript fallback receives only the stored question and answer, not the raw desktop snapshot. This is an explicit handoff from OmaPilot's one-shot permission boundary to Herdr's normal native-agent permission model; Codex resumes read-only and asks before commands.

Both integrations disappear or show a clear unavailable state when their required command is missing.

## Browser element context

The optional **OmaPilot Browser Companion** adds semantic page clipping to the
same crosshair button. On a site the user has enabled, OmaPilot closes its
desktop overlay and the page itself highlights the element beneath the pointer.
Clicking produces bounded **Element**, **Text**, and **Screenshot** choices; on
an unsupported, restricted, or non-enabled page, the existing desktop capture
opens instead.

The companion is one WebExtension source with Chromium and Firefox builds plus
a small local native-messaging relay. It supports Omarchy's Chromium, Chrome,
Brave, Brave Origin, Edge, Vivaldi, Helium, Firefox, Zen, and LibreWolf browser
families. Its rules are:

- the Omarchy plugin remains fully useful without the extension;
- context is visibly disclosed and captured only after an explicit clip request and page click;
- page access is opt-in and scoped per site, with no browsing-history collection;
- the bridge accepts a small versioned schema and does not expose a general command channel; and
- the extension avoids Chrome's broad `debugger` permission and requests only the minimum tab/site/native-messaging permissions needed for enabled features.

Native messaging requires registration outside the plugin directory, so it is
enabled only with the user's explicit consent. The primary setup path does not
require a terminal: open **OmaPilot settings → Desktop** and choose
**Enable browser context**. OmaPilot registers the user-local relay and adds the
bundled unpacked extension to detected Omarchy Chromium-family browser flags.
Restart the browser afterward, pin the OmaPilot extension, then choose **Enable
on this site** once for each site where DOM capture should be available.

Firefox and Zen development builds still require browser confirmation to load
`browser-companion/dist/firefox` temporarily; browsers do not allow another
application to silently install an unsigned temporary extension. Expand
**Finish browser setup** in OmaPilot settings to open the correct Chromium or
Firefox extension page and copy the matching bundled folder path. The same
controls remain available as a manual fallback when a Chromium-family browser
does not honor its unpacked-extension flag.

The script remains available for development, diagnostics, and removal:

```bash
./scripts/install-browser-companion.sh install
```

For local Omarchy Chromium-family development, it can add the unpacked build to
detected browser flag files:

```bash
./scripts/install-browser-companion.sh install --development
```

The primary removal path is also in settings. Choose **Remove browser context**
and confirm before removing the OmaPilot plugin. This removes the user-local
relay, native-messaging manifests, and unpacked-extension browser flags. Restart
open browsers afterward to unload the already-running extension process.

Omarchy deliberately does not execute plugin install or removal hooks, so
`omarchy plugin remove` cannot invoke OmaPilot's cleanup automatically. Remove
browser context from settings first. The script remains available for recovery
or development if the plugin has not yet been removed:

```bash
./scripts/install-browser-companion.sh uninstall
```

The desktop capture feature needs no separate OmaPilot package: its QML,
broker code, and built browser assets ship in the plugin repository. A durable
browser release does need two additional delivery channels because browsers do
not permit a plugin clone to install them silently:

1. publish the Chromium and Firefox builds through their browser extension
   stores so users receive a stable extension ID and browser-managed updates;
2. keep the tiny native relay in this repository initially, with an explicit
   install/uninstall command, then package that relay separately (for example as
   an AUR package) if automatic upgrades and ownership tracking are desired.

The relay and extension have no additional npm dependencies. The current relay
installer uses the already-required Node.js runtime plus `jq` to write native
messaging manifests. Store-packaged extensions can share the same versioned
wire contract and release from the existing source; they do not require a
separate source repository.

The element representation is a capped semantic tree—not raw `outerHTML`—and
omits editable values, editable accessible-name fallbacks, selections rooted in
editable content, password content, hidden nodes, scripts, styles, event
handlers, query strings, and fragments. Each capture remains bound to the exact
tab and native-relay session that answered its probe. Browser actions remain
out of scope; they would need their own inspectable per-action approval boundary.

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
