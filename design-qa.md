# OmaPilot perimeter-motion design QA

## Comparison target

- Source visual truth:
  `/home/sbull/.codex/generated_images/01a014a9-a73e-71e3-beaf-8afd052ca604/exec-0755f5a7-8ed6-4a8e-893f-582f4f33330a.png`.
- Installed defect evidence:
  `/home/sbull/Pictures/screenshot-2026-08-18_14-33-42.png`.
- Native blur-only scene-graph evidence:
  `screenshots/implementation-perimeter-blur-only.png`.
- State: dark Omarchy theme, active streaming response, plain
  `Receiving response…` status, and one perimeter runner.

## Viewport and normalization

- The installed screenshot is 1036 by 676 pixels and the native Wayland fixture
  is compositor-tiled to 1232 by 1252 pixels. They are not compared for global
  proportions; the scoped comparison is whether a separate hard stroke appears
  inside the moving bloom.
- The native fixture is required because Qt's software offscreen renderer omits
  the GPU MultiEffect entirely.
- The runner is intentionally in a different perimeter position between still
  frames. Position is phase-dependent and is not a fidelity mismatch.

## Findings

- No actionable P0 or P1 mismatch remains.
- Resolved P2: the installed two-layer runner exposed its 2-pixel core as a
  separate solid dash. The core layer is removed, and the native Wayland render
  confirms that only the softened MultiEffect result remains.

## Full-view comparison evidence

The component-only change leaves the accepted panel hierarchy untouched: the
OmaPilot identity and permission posture remain quiet, the response is the
dominant surface, the question and phase copy share the top row, and the moving
signal belongs to the response perimeter rather than the status text.

The streaming implementation contains response copy that is absent from the
concept. That difference is expected product behavior: the runner stays active
through both preparing and token streaming without representing completion.

## Focused comparison evidence

The owner screenshot shows the previous crisp core as a short cyan dash inside
the wider glow. The new native Wayland evidence shows one softened accent form
traveling on the rounded boundary, with no separate hard core painted over the
bloom. The ordinary border remains legible beneath the effect.

## Required fidelity surfaces

- Fonts and typography: the production Omarchy font family, caption sizing,
  medium status weight, hierarchy, antialiasing, and single-line truncation are
  retained. The source's globally softened display treatment is intentionally
  not applied to readable UI copy.
- Spacing and layout rhythm: the existing 860 by 320 panel geometry, response
  padding, question/status alignment, native radius, fixed status slot,
  smoothed height, and follow-latest scrolling are unchanged. The overlay does
  not participate in layout.
- Colors and visual tokens: the bloom source and MultiEffect colorization both
  resolve from `Color.accent` through the panel's active accent property. No
  accent literal or separate animation palette is shipped.
- Image quality and assets: no raster, generated, inline SVG, emoji, or text
  glyph is used in the product motion. The generated image remains reference
  evidence only; the runner uses Qt's native Shape and GPU effect primitives at
  runtime.
- Copy and content: the selected plain `Receiving response…` and provider-aware
  preparing copy remain truthful. The rejected three dots and adjacent route
  line are removed, and the animation does not imply progress percentage.

## State and interaction evidence

- The real component probe verifies preparing starts motion, preparing to
  streaming preserves phase, completion stops and settles, and reduced motion
  leaves only the ordinary static response border.
- The temporal renderer captures fourteen consecutive frames, verifies positive
  bounded phase steps, and checks the streaming handoff does not reset phase.
- The seven-frame direction strip shows the runner advancing left-to-right on
  the authored top edge before continuing around the clockwise path. The UI
  contract pins the inverted Qt dash offset that produces that direction.
- The real-component probe animates the response-card height from 156 to 236
  pixels during the preparing-to-streaming handoff and verifies the runner
  neither restarts nor jumps phase.
- Waiting and streaming 860 by 320 previews load with the active theme tokens.
- A native Wayland Quickshell run loaded the component and rendered the bloom.
  No OmaPilot motion error or TypeError was logged. The preview fixture retains
  one pre-existing `Composer.qml` undefined-bool warning unrelated to this
  component.
- The source QA pass itself did not mutate the active shell. After separate
  owner authorization, the scoped production payload was installed, validated,
  loaded through a guarded fresh-shell restart, and accepted in a real response.
  The existing shell configuration remained byte-identical.

## Comparison history

- Installed owner evidence at
  `/home/sbull/Pictures/screenshot-2026-08-18_14-33-42.png` exposed the 2-pixel
  crisp core as a visibly separate solid dash at one end of the bloom. The core
  layer was removed; the hidden Shape now feeds only one GPU-blurred effect.

## Open questions

- The owner should confirm the blur-only runner in the installed panel. Commit,
  push, merge, and release remain separate decisions.

## Implementation checklist

- [x] Use one clockwise perimeter runner rendered as a single soft bloom.
- [x] Resolve every runner color from the active Omarchy accent.
- [x] Remove the three-dot/route treatment from response status.
- [x] Preserve phase across preparing and streaming.
- [x] Stop and settle on terminal, hidden, and reduced-motion states.
- [x] Pass focused QML, temporal rendering, full repository, and visual gates.

## Follow-up polish

- None before the installed owner gate.

final result: pending installed owner confirmation
