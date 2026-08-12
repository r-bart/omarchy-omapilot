# Omarchy Quickchat

Quickchat is a native [Omarchy Quattro](https://github.com/basecamp/omarchy/tree/quattro) bar widget for fast, disposable AI answers. It uses the Codex, Claude, or OpenCode harness already authenticated on your machine, renders Markdown in a themed panel, remembers the latest 30 completed chats, and can hand an answer to Herdr when you want to keep working.

> [!IMPORTANT]
> Quickchat is under active development. The repository is not marketplace-ready until the release checklist and live verification in [`TODO.md`](TODO.md) pass.

## Preview

A verified live Quattro capture is pending. The compact composer expands from the right side of the bar. Its result panel supports selectable Markdown, code blocks, tables, safe clickable links, bounded images, Copy, New chat, History, and Continue in Herdr.

## Requirements

- Omarchy Quattro with the native shell plugin architecture.
- Linux x86-64 for the initial prebuilt runtime.
- Node.js 22 or newer for the broker and pinned ACP adapters.
- At least one installed and authenticated harness: `codex`, `claude`, or `opencode`.
- Optional: Voxtype for dictation and Herdr for durable continuation.

Quickchat does not install a harness, log you in, or read provider credentials. Authentication and model availability remain owned by the selected harness.

## Install

Review the repository before enabling it: Omarchy plugins execute unsandboxed inside the long-lived shell process.

```bash
omarchy plugin add https://github.com/spencerbull/omarchy-quickchat.git
omarchy plugin validate ~/.config/omarchy/plugins/io.github.spencerbull.quickchat
omarchy plugin enable io.github.spencerbull.quickchat right
```

The Omarchy installer only clones, validates, and enables the plugin. It runs no install hook, `sudo`, package manager, or host-configuration mutation. A source checkout currently needs `npm ci && npm run build` before the broker is available. A marketplace release must include the prebuilt, checksum-verified runtime in the reviewed plugin revision so the documented clone/validate/enable flow is complete. Quickchat never invokes `npx` at runtime or silently downloads executable code.

Update or remove it with the standard plugin commands:

```bash
omarchy plugin update io.github.spencerbull.quickchat
omarchy plugin remove io.github.spencerbull.quickchat
```

Removal deletes the cloned plugin. Quickchat deliberately leaves user-owned history and cached runtime files in place. Use **Clear all** before removal to erase history and cached chat images. If the plugin is already gone, inspect and remove the `quickchat` directories under your effective `XDG_STATE_HOME` and `XDG_CACHE_HOME` with a file manager; the default locations are `~/.local/state/quickchat` and `~/.cache/quickchat`.

## How it works

```text
Omarchy BarWidget/Panel
        │ one JSON command/event per line
        ▼
Quickchat broker
        │ Agent Client Protocol over stdio
        ├── Codex ACP ── authenticated Codex CLI
        ├── Claude ACP ─ authenticated Claude harness
        └── OpenCode ACP ─ authenticated OpenCode CLI
```

Codex and Claude use exact, release-pinned official ACP adapter packages. OpenCode uses its native `opencode acp` command. The broker normalizes provider discovery, streamed text/images, cancellation, permissions, errors, and session identities; QML does not parse provider-specific output.

Two capability profiles are exposed:

- **Answer** denies tools, shell, filesystem, MCP, and network capabilities.
- **Web** allows only a harness capability that can be proven to be web search/fetch. It continues to deny shell, filesystem, edits, MCP, and unrelated tools. If the harness cannot enforce that boundary, Web is unavailable.

Every permission request is denied unless it matches the selected profile. Quickchat never bypasses a harness permission system.

## Storage and privacy

Quickchat persists only completed chats, capped at the newest 30. A chat contains the question, rendered answer source, timestamp, provider/model/capability metadata, content references, and a resumable session identity when the harness supplies one. Draft text, authentication output, tokens, environment variables, and provider credentials are not persisted.

| Path | Purpose |
| --- | --- |
| `${XDG_STATE_HOME:-~/.local/state}/quickchat/` | Atomic local history and resumable session metadata |
| `${XDG_CACHE_HOME:-~/.cache}/quickchat/` | Verified runtime bundle and bounded image cache |
| `${XDG_RUNTIME_DIR}/quickchat/` | Per-login sockets, temporary dictation, and in-flight data |

Remote Markdown images are not fetched automatically. Quickchat shows the origin and requires a click before loading a validated HTTPS image. Links are scheme-checked and never interpolated into a shell command. See [`SECURITY.md`](SECURITY.md) for the threat model and reporting process.

## Optional integrations

- **Voxtype:** when `voxtype` is installed and ready, the microphone records directly to a file under `$XDG_RUNTIME_DIR/quickchat`; Quickchat reads that transcript after recording stops. It never simulates keyboard input or modifies Voxtype configuration.
- **Herdr:** when `herdr` is installed, Continue in Herdr creates or reuses a dedicated `Quickchat` workspace and creates a labeled tab. It resumes the native harness session when possible, otherwise starts the matching agent with a compact transcript and labels the fallback.

Both integrations disappear or show a clear unavailable state when their command or capability is missing.

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

The package helper stages production dependencies, emits a CycloneDX SBOM, normalizes timestamps and ownership, creates a deterministic archive, and writes `SHA256SUMS`. Release details and marketplace gates are in [`docs/release.md`](docs/release.md).

## License and attribution

Quickchat is MIT licensed. ACP adapters and bundled dependencies retain their own licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the generated release SBOM.
