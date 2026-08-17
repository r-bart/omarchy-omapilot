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
- one monitor instance conditionally owns the direct Quickchat IPC target, then
  routes panel actions through Quattro's focused-monitor bar-widget resolver;
  ownership follows the host's reassigned module list across monitor changes.

Quickchat does not edit `shell.json`, Omarchy sources, Hyprland configuration, Voxtype configuration, or Herdr configuration directly.

## Process boundary

The UI starts a separate Quickchat broker and communicates using newline-delimited JSON on stdin/stdout. The broker owns provider discovery and authentication readiness, ACP lifecycle, permission handling, streaming, cancellation, validation, history, and optional integration commands. Provider stderr is diagnostic input and must never be forwarded to persisted history without redaction.

The reviewed plugin revision contains self-contained broker and adapter bundles usable immediately after a plain clone. Release builds package those tracked bundles into a deterministic, checksum-addressed `linux-x86_64` archive with lockfile-derived SBOM and provenance. Omarchy itself still performs no install hook. Contributors use `npm ci && npm run build` to reproduce checked-in bundles; missing or incompatible runtimes fail closed.

## Runtime command/event contract

One compact JSON object is sent per line; embedded newlines remain JSON escapes. Each command has an `id`. Every correlated event repeats that `id`; asynchronous readiness events may omit it.

The UI sends commands whose `type` is one of `initialize`, `submit`, `context_begin`, `context_capture`, `context_cancel`, `context_discard`, `cancel`, `permission_response`, `dictation_start`, `dictation_stop`, `dictation_cancel`, `copy`, `open_link`, `load_image`, `continue_in_herdr`, `history_list`, `history_delete`, `history_clear`, or `shutdown`.

The broker emits events whose `type` is one of `ready`, `providers`, `state`, `content`, `context_ready`, `context_attachment`, `permission`, `permission_closed`, `image`, `complete`, `error`, `dictation`, `history`, `herdr`, `link`, or `copied`. The broker's protocol tests are authoritative for exact fields and version negotiation.

ACP is the broker's normalization boundary, not the policy boundary. The submit
command contains provider/model/question plus an optional versioned desktop
snapshot and up to four opaque context-attachment selections. QML latches the active app and
its capture rectangle immediately before the panel takes focus
and synchronously reads the current app/workspace/media inventory from
Quickshell's public Hyprland and MPRIS objects at submit time; it does not poll
`hyprctl` or create a second desktop service. The broker independently validates
field counts, lengths, and control characters, then frames the snapshot as
untrusted observational JSON before the authoritative user request. It sends
the combined prompt to the selected ACP session but stores only the original
question in Quickchat history. Provider-native session retention still applies.
Native Herdr resume therefore inherits provider-retained context, while the
transcript fallback contains only the stored question and answer.

## Explicit context clips

OmaPilot is a multi-kind `bar-widget` and `overlay` plugin. The panel asks the
broker to begin a capture using the pre-focus window rectangle as a hint. The
broker reads and bounds the current Hyprland monitor layout, returns only the
validated target geometry, and retains the capture request. The overlay then
supports one-click active-window capture or a dragged monitor-local region. It
hides for two compositor frames before asking the broker to invoke `grim`, so
OmaPilot chrome is not present in the pixels.

The broker fully decodes and normalizes every image through the existing image
policy. If local Tesseract is available, word boxes are hit-tested at the click
point and expanded to their OCR paragraph. The resulting attachment may offer
Text, Screenshot, or Text + screenshot. The thumbnail remains a local preview;
only the representation IDs selected in the composer cross the submit boundary.
QML never sends image paths, base64, OCR payloads, or arbitrary HTML back to the
broker. The broker resolves opaque UUIDs against its in-memory attachment map,
constructs ACP text/image blocks, and deletes the cached input image after
submit or explicit removal.

The representation contract reserves `element` for the separately installed
browser companion. That integration must create a broker-owned bounded semantic
candidate; the UI must never accept raw DOM in a normal submit command.

The broker derives one automatic,
fail-closed policy for that provider. Codex keeps the pinned adapter's read-only,
on-request mode, disables native web search, and exposes only its strictly validated
shell/unified-exec and skill-search features. It may read any user-readable host file without
asking; tool output is sent to Codex and may be retained in the saved answer.
Each broader-access request is bound to a broker nonce. The UI exposes only
provider-native allow-once or reject-once; approval may run that exact command
with current-user device and network authority. Claude copies bounded, regular-file
installed skill trees into a per-turn local plugin with MCP discovery disabled,
then uses a disposable
workspace that dynamically denies every existing top-level host path except
system executable/library roots, hides credential-bearing environment variables,
blocks direct process network access and WebFetch, confines writes to per-turn
scratch, and allows WebSearch. Commands inside that boundary may run
automatically. An exact Claude command that needs device authority accepts a
broker-bound allow-once or reject-once decision. Allowing it runs that exact
command outside the disposable sandbox with the current user's full device,
network, host-file, and process-environment authority. OpenCode automatically permits
only its exact skill and websearch identities. Its native bash permission is
fixed to `ask`; the broker correlates the pending execution, permission request,
decision, and subsequent updates by tool-call ID before allowing completion.
Every other OpenCode tool remains denied.
Unclassified tool kinds fail closed. Raw tool requests,
decisions, updates, and outputs remain ephemeral, while the completed answer may
contain tool-derived text and is retained like any other answer. Continue in Herdr intentionally leaves that one-shot boundary and
hands the resumable session or transcript to Herdr, which becomes the authority
for native-agent permissions and lifecycle.

The broker does not classify prompt text into action-specific code paths.
Questions and action requests use the same ACP submission contract; the
selected harness decides whether a tool is needed under its fixed policy, and
the broker only mediates structured, request-bound permission events.
One checked-in instruction is supplied through Codex developer instructions,
Claude's system prompt plus `skills: all`, and OpenCode's instruction-file
configuration. It directs providers to use relevant installed skills and never
claim an action completed without a successful performing tool result.

## Compatibility rule

The protocol and release metadata are versioned independently of the manifest schema. Protocol 2 removes user-selected capability fields and makes the broker's automatic provider policy authoritative; legacy stored protocol-1 chats remain readable and are projected into the protocol-2 public shape. The plugin must show an actionable incompatibility error when the cached runtime cannot negotiate its supported protocol; it must not guess at provider output or silently broaden permissions.
