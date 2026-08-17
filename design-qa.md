# OmaPilot design QA

## Reference and scope

- Selected reference: `/home/sbull/.codex/generated_images/01a00be1-4685-7fc3-8db3-390b6d71668c/exec-4df27182-89cb-45b2-ac78-7ca8bb5f7ef2.png`.
- Selected mark reference: `/home/sbull/.codex/generated_images/01a00be1-4685-7fc3-8db3-390b6d71668c/exec-e7bae836-9753-4248-b4df-553b566c4739.png`.
- Implementation captures: `screenshots/implementation-omapilot-empty.png`,
  `screenshots/implementation-omapilot-dangerous-settings.png`,
  `screenshots/implementation-omapilot-actions-settings.png`,
  `screenshots/implementation-omapilot-waiting.png`,
  `screenshots/implementation-omapilot-streaming.png`,
  `screenshots/implementation-omapilot-error.png`, and
  `screenshots/implementation-omapilot-error-details.png`.
- Mark comparison: `screenshots/comparison-omapilot-mark.png`, with the
  selected source and the rendered 42-pixel production mark in one image.
- Reference dimensions: 1680 by 938 pixels, interpreted as an approximately
  840 by 469 logical-pixel concept at 2x.
- Implementation dimensions: 860 by 320 logical pixels at the headless test
  scale.
- Compared state: empty unified request surface with the current provider,
  safety notice, integrated composer, and both quick actions visible.
- Comparison scope: code and headless static rendering. The owner subsequently
  authorized installation of the validated merge and a guarded shell restart;
  no claim below treats that install alone as visual or interaction validation.

## Visual comparison

The full-view comparison preserves the reference's hierarchy: identity is the
first row, the safety contract stays beside the provider metadata, the composer
is the dominant surface, and quick actions are quiet secondary choices. A
focused header/composer/action-row comparison confirms that the production
components keep the reference's left-aligned brand, compact settings
affordance, single bordered composer, and natural-width action buttons. The
earlier Ask / Act switch was removed after hands-on review because it duplicated
the permission setting without improving the request flow.

The implementation intentionally differs in three places:

- It uses Quattro Color, Style, spacing, radius, border, focus, and typography
  tokens instead of the reference's fixed blue glow and gradient.
- It is substantially shorter in the empty state. This is required by the
  content-driven compact-height contract; response content grows the panel only
  until the screen-aware cap, after which the transcript owns scrolling.
- It keeps truthful provider/model metadata and an exact-approval notice. The
  reference's desktop-context selector is omitted because that capability is
  owned by the separate provider/context stream.

The new production mark uses the selected generated asset, including the
broken Omarchy-square frame, centered heading arrow and dot, and square lower
edge without the rejected protruding tab. Qt Quick Controls applies the active
Quattro accent color to the source asset at both header and bar sizes. The
side-by-side comparison confirms the geometry is preserved; only scale,
antialiasing, and theme color differ.

The settings capture verifies that Dangerous auto-approve stays inside the
Permissions group, uses the native toggle, remains visually secondary while
off, and reveals a concise urgent warning while on. The warning does not move
provider/model or quick-action controls out of the bounded scrollable pane.
The action-editor capture verifies native fields and pointer/keyboard targets
for editing, removal, and directional reordering; the list remains inside the
same capped settings scroll owner.

The response captures verify three distinct states without changing transcript
ownership: a fixed-route energy wave while waiting, real-content-driven node
energy while streaming, and an urgent but compact error notice. Waiting and
streaming share one fixed, screen-aware status slot, and their copy crossfades,
so phase changes do not resize the adjacent question. The route has no moving
marker: both ends of each wave render the same resting geometry, eliminating
the visible teleport that made the earlier treatment feel rough. The error
notice opens a separate selectable details pane with the normalized message,
code, retryability, and Copy action. No animation claims completion percentage.

Copy, icon weight, border contrast, and control density are internally
consistent. The implementation title and mark are intentionally smaller than
the concept so they fit the native shell scale and leave more room for
conversation content.

## Iteration history

1. The first 860 by 430 render exposed excessive empty space between the
   composer and actions, and layout stretch pushed the two quick actions apart
   (P2).
2. The preview was reduced to its content-driven 320-pixel height, the filler
   was removed, and the actions were changed to a natural-width row. The final
   full-view capture has no remaining P0, P1, or P2 visual issue.
3. The temporary gauge-and-spark glyph was replaced with the selected mark.
   Its alpha mask is colorized through the Qt Quick Controls icon API, avoiding
   a hardcoded theme color while retaining the exact generated geometry.
4. The enabled dangerous setting initially contradicted the ordinary approval
   description. The copy now switches with the flag and the separate urgent
   warning states the concrete device and network risk.
5. Hands-on review found the Ask / Act split redundant. The switch, mode state,
   provider filtering, auto-denial branch, and mode-gated quick actions were
   removed; approval behavior is now controlled solely by the dangerous toggle.
6. The two fixed action toggles became a bounded editor for up to five ordered
   prompts. The empty surface uses a wrapping native Flow so additional actions
   do not clip horizontally.
7. The one-shot three-dot waiting reveal became an OmaPilot route signal. Its
   waiting motion runs once and settles; subsequent pulses occur only when a
   real streamed content event increments the activity revision.
8. Error copy became an explicit details affordance and pane so the compact
   conversation remains readable while diagnostics stay available on demand.
9. Hands-on review exposed a first-token snap and question-row reflow. The route
   marker now moves through a non-layout `Translate`, waiting-to-streaming queues
   rather than resets the active sweep, bursty chunks coalesce into one pending
   pulse, opacity and travel durations match, and one stable status slot owns
   waiting, streaming, and completion copy.
10. A second hands-on review found that non-layout movement still looked rough:
    the marker necessarily teleported home between pulses, fixed-duration panel
    and transcript animations repeatedly restarted under streaming updates, and
    the header mark overshot on every busy-state change. The production pass now
    keeps route geometry fixed and transfers only node energy, latches each
    in-flight wave's duration across the first-token handoff, inserts a long rest
    between waiting waves, coalesces streaming bursts, crossfades phase copy,
    uses `SmoothedAnimation` for moving height/scroll targets, and replaces the
    header bounce with a quiet accent state.

## State and interaction evidence

- The shared production header, composer, quick actions, and
  settings view load in the real Quickshell binary through the offscreen visual
  harness; screenshot creation is asserted by the UI contract check.
- Focused QML tests cover screen-aware height capping, transcript viewport
  ownership, near-bottom streaming follow, waiting/streaming presentation,
  settings, history, and error Escape dismissal, approval posture, bounded
  action add/edit/remove/reorder behavior, serialized action migration, error
  normalization, and exact editable prompt prefills.
- The enabled dangerous-settings capture proves the toggle and warning load in
  the bounded production settings view; focused broker tests prove the visual
  flag's no-prompt behavior separately from this rendering evidence.
- The headless preview fails on QML load errors and rejects TypeError output.
- A Quickshell motion probe exercises the real component timeline and fails if
  first-token streaming stops, resets, or changes the duration of an in-flight
  wave; if a content event is discarded while it runs; if waiting skips its
  resting cadence; or if reduced motion leaves animation queued.
- A separate real-component renderer captures ten consecutive waiting-to-
  streaming frames. The UI contract requires every frame and successful harness
  completion, making temporal load failures visible instead of relying on one
  static screenshot or source grep.
- The merged installed path passes the same QML/UI contracts, its shell-owned
  broker was relaunched from the new deterministic bundle, and the recovered
  shell log contains no OmaPilot/Quickchat-specific load error.
- Pointer feel, keyboard traversal in the installed anchor, reduced-motion
  behavior in a real compositor, and real provider waiting/stream/cancel/error
  transitions remain live-validation gates.

## Severity result

- P0: none.
- P1: none.
- P2: none after the second render.
- P3: the native mark/title scale is smaller than the generated reference;
  accepted for the shell-sized checkpoint.

final result: passed
