# Architecture and host contract

## Omarchy ownership

Quickchat is one third-party `bar-widget`; it is not a replacement bar, panel plugin, service plugin, or second Quickshell process. Its repository-root `manifest.json` declares schema version 1 and the relative `BarWidget.qml` entrypoint. Omarchy owns discovery, enabled state, placement, settings persistence, theme services, panel coordination, and hot reload.

The widget follows the current Quattro host contract:

- installation is a plain git clone under `~/.config/omarchy/plugins/io.github.spencerbull.quickchat`;
- enablement adds one inline entry to `bar.layout.right` in `shell.json`;
- the host injects `settings`, `manifest`, `shell`, `pluginRegistry`, and `barWidgetRegistry` where supported;
- preferences are inline widget settings—there is no second configuration authority;
- colors, type, borders, radii, and motion come from public `qs.Commons` and `qs.Ui` theme roles;
- the widget coordinates one nested Omarchy `Panel` through the same open/close/anchor/popout behavior used by first-party bar widgets.

Quickchat does not edit `shell.json`, Omarchy sources, Hyprland configuration, Voxtype configuration, or Herdr configuration directly.

## Process boundary

The UI starts a separate Quickchat broker and communicates using newline-delimited JSON on stdin/stdout. The broker owns provider discovery and authentication readiness, ACP lifecycle, permission handling, streaming, cancellation, validation, history, and optional integration commands. Provider stderr is diagnostic input and must never be forwarded to persisted history without redaction.

The reviewed plugin revision contains self-contained broker and adapter bundles usable immediately after a plain clone. Release builds package those tracked bundles into a deterministic, checksum-addressed `linux-x86_64` archive with lockfile-derived SBOM and provenance. Omarchy itself still performs no install hook. Contributors use `npm ci && npm run build` to reproduce checked-in bundles; missing or incompatible runtimes fail closed.

## Runtime command/event contract

One compact JSON object is sent per line; embedded newlines remain JSON escapes. Each command has an `id`. Every correlated event repeats that `id`; asynchronous readiness events may omit it.

The UI sends commands whose `type` is one of `initialize`, `submit`, `cancel`, `dictation_start`, `dictation_stop`, `dictation_cancel`, `copy`, `open_link`, `load_image`, `continue_in_herdr`, `history_list`, `history_delete`, `history_clear`, or `shutdown`.

The broker emits events whose `type` is one of `ready`, `providers`, `state`, `content`, `image`, `complete`, `error`, `dictation`, `history`, `herdr`, `link`, or `copied`. The broker's protocol tests are authoritative for exact fields and version negotiation.

## Compatibility rule

The protocol and release metadata are versioned independently of the manifest schema. The plugin must show an actionable incompatibility error when the cached runtime cannot negotiate its supported protocol; it must not guess at provider output or silently broaden permissions.
