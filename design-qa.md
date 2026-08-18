# OmaPilot perimeter-motion design QA

## Comparison target

- Source visual truth:
  `/home/sbull/.codex/generated_images/01a014a9-a73e-71e3-beaf-8afd052ca604/exec-0755f5a7-8ed6-4a8e-893f-582f4f33330a.png`.
- Rendered implementation:
  `screenshots/implementation-omapilot-streaming.png`.
- Combined full-view evidence:
  `screenshots/implementation-perimeter-full-comparison.png`.
- Combined focused evidence:
  `screenshots/implementation-perimeter-glow-comparison.png`.
- Clockwise direction evidence:
  `screenshots/implementation-perimeter-direction.png`.
- Native scene-graph evidence:
  `/tmp/omapilot-wayland-final-streaming-v2.png`.
- State: dark Omarchy theme, active streaming response, plain
  `Receiving response…` status, and one perimeter runner.

## Viewport and normalization

- The source is 2055 by 765 pixels. Its aspect ratio was normalized directly to
  the production preview's 860 by 320 logical-pixel surface.
- The implementation is an 860 by 320 offscreen QML capture at one output pixel
  per requested logical pixel. The combined full view therefore compares equal
  860 by 320 regions without browser chrome, device framing, or density drift.
- The native Wayland preview was compositor-tiled to 1232 by 1252 pixels. It is
  not used to judge full-view proportions; it is focused evidence that the real
  Qt scene graph renders the MultiEffect bloom that the software offscreen
  renderer omits.
- The runner is intentionally in a different perimeter position between still
  frames. Position is phase-dependent and is not a fidelity mismatch.

## Findings

- No actionable P0, P1, P2, or P3 mismatch remains.
- The owner accepted the glow strength and motion feel during a real installed
  response after the guarded fresh-shell load.

## Full-view comparison evidence

The combined 860 by 320 comparison preserves the selected concept's hierarchy:
the OmaPilot identity and permission posture remain quiet, the response is the
dominant surface, the question and phase copy share the top row, and the moving
signal belongs to the response perimeter rather than the status text. The
implementation intentionally keeps production's sharper native rendering and
compact shell scale instead of reproducing the concept image's global blur.

The streaming implementation contains response copy that is absent from the
concept. That difference is expected product behavior: the runner stays active
through both preparing and token streaming without representing completion.

## Focused comparison evidence

The combined runner crop compares the actual source glow and the native Wayland
scene-graph result in one image. Both use one short, bright core traveling on a
rounded accent-colored boundary with a soft bloom localized around the runner.
The implementation's ordinary border remains legible beneath the effect, and
there are no dots, route glyphs, or a separate line beside the status copy.

## Required fidelity surfaces

- Fonts and typography: the production Omarchy font family, caption sizing,
  medium status weight, hierarchy, antialiasing, and single-line truncation are
  retained. The source's globally softened display treatment is intentionally
  not applied to readable UI copy.
- Spacing and layout rhythm: the existing 860 by 320 panel geometry, response
  padding, question/status alignment, native radius, fixed status slot,
  smoothed height, and follow-latest scrolling are unchanged. The overlay does
  not participate in layout.
- Colors and visual tokens: core stroke, bloom source, and MultiEffect
  colorization all resolve from `Color.accent` through the panel's active accent
  property. No accent literal or separate animation palette is shipped.
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

- The first combined artifact used a waiting implementation against the source's
  streaming label. The evidence was normalized to the streaming capture before
  judgment; this was an evidence-state correction, not a product fix.
- The normalized full-view and focused comparisons found no P0, P1, or P2
  difference, so no visual-fix iteration was required.

## Open questions

- None for this motion scope. Merge and release remain separate decisions.

## Implementation checklist

- [x] Use one clockwise perimeter runner with a crisp core and soft bloom.
- [x] Resolve every runner color from the active Omarchy accent.
- [x] Remove the three-dot/route treatment from response status.
- [x] Preserve phase across preparing and streaming.
- [x] Stop and settle on terminal, hidden, and reduced-motion states.
- [x] Pass focused QML, temporal rendering, full repository, and visual gates.

## Follow-up polish

- None required by the accepted installed result.

final result: passed
