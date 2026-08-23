# Pi personal-assistant harness plan

Date: 2026-08-22

Planning branch: `pi-harness-personal-assistant-plan`

Rebased base: local `dev` at `1e79b8bd344da183b4c9b87e512e98418d19cfae`

Implementation status: the first desktop slice now covers official Omarchy
skill discovery, a bundled desktop skill, installed app discovery with
focus-or-launch, bounded desktop state, exact window focus/move/resize/float/
close actions, workspace focus/monitor movement, and broker-side post-state
receipts. The system, productivity, browser-interaction, and connector slices
remain follow-on milestones. A bounded `web_handoff` bridge now covers the
lighter browser-research case: the user selects DuckDuckGo, Google, ChatGPT
Search, Claude, or Grok; Pi opens the reviewed question in that site and never
claims to have consumed the browser's answer. This does not replace the later
browser snapshot/interaction milestone.

## Audit verdict (pre-implementation baseline)

The current Pi harness is reliable at model/session/auth/permission mechanics, but
it is not yet a capable Omarchy personal assistant. It gives the model Pi's broad
coding tools plus only two purpose-built device actions: `open_url` and
`media_control`. App discovery, open-window inspection, workspace control, window
movement, and window resizing all fall back to generic `bash` even though the
policy asks the model to prefer structured Omarchy actions.

The recent experience regression is most likely an installed-worktree ownership
regression, not a broken test suite:

- The live plugin currently resolves to
  `/home/sbull/.t3/worktrees/omarchy-omapilot/t3code-261f82ed`, where the harness
  exposes only `open_url` and `media_control`.
- The previously installed `omarchy-omapilot-bottom-glow` worktree still contains
  an uncommitted, tested prototype of `app_catalog`, `launch_app`,
  `hyprland_state`, and `hyprland_control`.
- Those prototype changes were never landed on `dev`, so installing the later
  voice worktree silently removed them from the live broker.

Do not copy or reset the dirty bottom-glow worktree. Extract only the reviewed
harness, skill, test, policy, bundle, and packaging portions into this isolated
branch when implementation begins.

## Evidence and gaps

### High: the official Omarchy skill is invisible to built-in Pi on this host

The current resource loader disables Pi's default skill discovery and explicitly
loads only:

- `~/.agents/skills/`
- `<cwd>/.agents/skills/`
- `<cwd>/.pi/skills/`

Omarchy 4.0 installs its Pi skill at `~/.pi/agent/skills/omarchy`. That link exists
on this machine, while `~/.agents/skills/omarchy` does not. The harness therefore
cannot see the official skill even though its policy tells the model to follow
it. Add the real global Pi skill root and test this exact host layout.

Do not rely on a skill for authorization or correctness. Skills teach tool choice
and workflow; schemas, permission metadata, command mapping, and verification
must remain broker-enforced.

### High: structured device authority is much narrower than the policy

The root model receives `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, a
named-agent tool, `open_url`, and `media_control`. The policy mentions installed
apps, Omarchy commands, device navigation, browser interaction, and web search,
but the built-in harness has no structured implementations for most of those
capabilities. Pi 0.84.2 has no built-in MCP support, and executable extensions are
intentionally disabled here, so Apps/connectors cannot appear without an
OmaPilot-owned tool-provider bridge.

### High: the current desktop snapshot cannot safely target a window

Submit-time context is useful observational data: active app/title,
workspace/monitor, grouped app counts, occupied workspaces, and media. It omits
the exact window address/stable ID, geometry, monitor ID, and mode details needed
for deterministic focus, movement, resize, or verification. Fresh structured
state is required for actions.

### Medium: the structured-control prototype is useful but incomplete

The dirty prototype already provides a sound starting pattern:

- read-only app and Hyprland discovery;
- exact catalog IDs and exact `0x...` window addresses;
- approval-gated launch/control;
- one-action dispatch; and
- a skill that requires inspect, act, inspect.

It still lacks the user-requested resize operation and moving a workspace between
monitors. It also lacks close, swap, scratchpad, grouping, pinning, monitor focus,
and launch-or-focus behavior described by the Omarchy manual. Its toggle actions
can reverse an already-correct state, and verification is merely requested from
the model rather than enforced by the tool.

### Medium: `pi-harness.ts` is becoming the wrong ownership boundary

The file already owns auth, provider discovery, sessions, retries, approvals,
skills, named agents, and desktop commands. Adding every Omarchy domain there
will create an unreviewable monolith. Device tools should move behind a small
registry with per-domain modules and shared permission/result contracts.

### Medium: tests prove mapping, not the user-visible outcome

Both focused baselines pass:

- live/current harness and policy: 42 tests;
- dirty structured-control prototype and policy: 45 tests.

There is no end-to-end gate proving that an installed broker can find an app,
focus or launch it, move/resize its exact window, move a workspace, and observe
the requested final state. A successful process exit or Hyprland `ok` is not that
proof.

## Product model

Use three layers with distinct responsibilities:

1. **Policy:** a short, always-on contract for outcome ownership, least authority,
   untrusted context, approval boundaries, and honest completion reporting.
2. **Skills:** progressively disclosed playbooks that teach when and how to
   combine capabilities. Skills never grant authority.
3. **Tools:** typed, bounded, broker-owned actions that validate targets, request
   the correct approval, execute exact argv, inspect post-state, and return an
   evidence-bearing receipt.

The model should never need to synthesize a raw `hyprctl dispatch` string for a
supported action. Generic `bash` remains an explicit fallback for unsupported
work, not the normal personal-assistant path.

## Skill set

### 1. Official `omarchy` skill

Use the skill shipped by Omarchy rather than copying it into this repository. It
owns customization guidance, stable CLI discovery, config locations, refresh and
restart behavior, privilege rules, and the broader system manual.

Harness work:

- discover `~/.pi/agent/skills` in addition to the current shared/project roots;
- preserve deterministic precedence and report duplicate-name collisions;
- expose skill diagnostics in debug/ready state; and
- test root and named-agent discovery with the actual Omarchy layout.

### 2. Bundled `omapilot-desktop` skill

Own the state -> action -> verification workflow for:

- installed desktop apps and TUIs;
- open windows and exact targeting;
- focus and launch-or-focus;
- workspaces and monitors;
- moving windows to workspaces;
- moving workspaces to monitors;
- resizing and arranging windows;
- floating, fullscreen, maximized, pseudo, pin, scratchpad, and groups.

Keep it narrow. Do not force every general question through this skill. Its
description should trigger only for desktop/app/window requests.

### 3. Bundled `omapilot-system` skill

Map the Omarchy manual's device domains to typed tools:

- audio and media;
- display and keyboard brightness;
- network and Bluetooth state/control;
- idle, night light, notification silencing, touchpad, and bar visibility;
- battery, weather, time, and system status; and
- lock/power actions with elevated confirmation rules.

Persistent configuration, installs, updates, refresh/reinstall, secrets, and
session-ending actions must use higher risk tiers and must not be eligible for
dangerous auto-approve or durable grants.

### 4. Bundled `omapilot-productivity` skill

Cover manual workflows that make the assistant personally useful:

- set/show/clear reminders;
- send and inspect notifications;
- screenshots, screen recording, QR, and OCR;
- clipboard history and explicit paste/copy;
- file/folder selection and LocalSend sharing; and
- opening the correct Omarchy panel/menu when direct structured control is not
  available.

Clipboard contents, Wi-Fi passwords, selected files, and captured pixels are
sensitive data. Read/access operations need explicit user intent and bounded
results even when they do not mutate the device.

### 5. Optional `omapilot-app-workflows` skills

Add these only after there is a corresponding tool provider. A skill alone
cannot make an App, connector, or rendered browser controllable.

- local app workflows can combine desktop focus with app-specific CLIs;
- browser workflows need broker-owned snapshot/interaction tools, not just
  `open_url`;
- remote Apps/connectors need an explicit credential-isolated tool-provider
  bridge; and
- calendar/tasks should be the first personal-assistant connector slice because
  reminders already provide a local fallback.

## Target tool surface

### Discovery and state (read-only)

- `capabilities`: report available tools, relevant command versions, skill
  diagnostics, and unavailable reasons.
- `app_catalog`: search desktop entries, Omarchy launch routes, web apps, TUIs,
  and relevant executable commands with stable IDs.
- `desktop_state`: return bounded monitors, workspaces, and windows with address,
  stable ID, app/class, active state, workspace, monitor, geometry, and modes.
- `omarchy_commands`: search the live `omarchy commands --json` inventory and
  return help/source metadata without executing it.
- domain status tools for media/audio, brightness, network, Bluetooth, battery,
  reminders, weather, idle, and notification silencing.

### Actions (approval-gated)

- `app_open`: exact catalog ID plus `auto`, `focus_existing`, or `new_window`;
  verify a matching window/focus result when the app is graphical.
- `window_action`: exact address plus a typed action. Initial actions:
  focus, move to workspace, swap direction, resize by a bounded delta, set
  floating, set fullscreen/maximized, close, pin, move to/from scratchpad.
- `workspace_action`: focus, next/previous, move an exact workspace to an exact
  monitor, and set dwindle/scrolling layout.
- `omarchy_action`: curated typed operations for the system/productivity domains;
  do not expose arbitrary routes as a supposedly safe structured action.

Prefer desired-state inputs (`floating: true`) over toggles. When Omarchy or
Hyprland only exposes a toggle, inspect first and dispatch only when a change is
needed.

### Action receipt

Every mutating tool should return a stable receipt:

```json
{
  "action": "move_window_to_workspace",
  "target": { "address": "0x..." },
  "requested": { "workspace": 3 },
  "before": { "workspace": 1 },
  "after": { "workspace": 3 },
  "changed": true,
  "verified": true
}
```

The UI approval card and durable approval fingerprint should be derived from the
same normalized action object. Do not fingerprint a display string separately
from the argv actually executed.

## Implementation sequence

### Milestone 0: preserve and reconcile the starting state

1. Keep this worktree based on local `dev` until the user chooses whether to
   reconcile its one-ahead/two-behind divergence from `origin/dev`.
2. Record the live installed symlink and source/bundle hashes before any future
   install.
3. Extract only the structured-control prototype from the dirty bottom-glow
   worktree. Do not merge or overwrite its unrelated UI/voice changes.
4. Review the older `install-omapilot-skill` branch for reusable collision and
   packaging tests, but do not revive forced all-turn skill invocation or the
   known Codex ACP false-pass.

Checkpoint: reviewed extraction diff with no unrelated files.

### Milestone 1: modular tool registry and skill discovery

1. Move device capabilities into `runtime/src/tools/` modules:
   `registry.ts`, `desktop.ts`, `apps.ts`, `omarchy.ts`, and shared
   `permissions.ts`/`receipts.ts`.
2. Register tools conditionally from live command/version probes.
3. Add the actual Omarchy global Pi skill root and collision diagnostics.
4. Add the narrow bundled `omapilot-desktop` skill.
5. Keep the always-on policy short and capability-neutral.

Checkpoint: typecheck, lint, focused tests, bundle parity, packaged skill roots,
and a fixture where only `~/.pi/agent/skills/omarchy` exists.

### Milestone 2: complete desktop control

1. Port the prototype's app catalog, launch, Hyprland state, and bounded actions.
2. Expand state with monitor, geometry, stable ID, pinned/group/scratchpad, and
   active/focus fields.
3. Add launch-or-focus, exact-window focus, move window to workspace, move
   workspace to monitor, bounded resize, swap, close, and desired-state modes.
4. Perform pre-state and post-state verification inside each mutating tool.
5. Fail closed on target disappearance, ambiguous app identity, unsupported
   compositor versions, mismatched post-state, timeout, or partial execution.

Checkpoint: deterministic command fixtures plus a real desktop smoke test using
a disposable app window and restoring the original workspace/layout.

### Milestone 3: Omarchy system and productivity tools

1. Build read-only command/capability discovery from
   `omarchy commands --json`.
2. Add typed tools in small slices: reminders/notices, audio/brightness, toggles,
   capture/OCR, clipboard/files/share, then network/Bluetooth.
3. Assign each action a broker-owned risk tier.
4. Reserve installs/removals, package/update/refresh/reinstall, secrets, power,
   and privileged commands for separate explicit flows.
5. Add `omapilot-system` and `omapilot-productivity` skills only as their tools
   land.

Checkpoint: every advertised manual workflow has an availability probe, schema,
approval rule, failure test, and outcome verifier.

### Milestone 4: Apps, browser work, and personal context

1. Define a `ToolProvider` interface so built-ins and future connectors share
   schemas, availability, risk, execution, cancellation, and receipts.
2. Extend the browser companion only through narrowly scoped, inspectable
   snapshot/interaction operations; launching a URL remains separate.
3. Add calendar/task connectors first, with local Omarchy reminders as fallback.
4. Keep connector credentials outside model prompts, tool output, history, and
   inherited process environments.
5. Add opt-in user preferences/memory only after retention, inspection, edit,
   delete, and disable controls are designed.

Checkpoint: connector/browser threat-model review and user-visible permission
copy before enabling any provider.

### Milestone 5: installed/runtime verification and rollout

1. Rebuild tracked bundles and require source/bundle/packaging parity.
2. Install the exact candidate worktree only after explicit approval; restart the
   shell and bind verification to the new broker PID and source hash.
3. Exercise the scenario matrix below through the installed UI and built-in Pi
   model, not only direct unit calls.
4. Keep a rollback target and restore the previous installed symlink if any
   user-visible scenario fails.

Checkpoint: independent review, full repo checks, installed broker handshake,
live scenario evidence, then merge decision.

## Acceptance scenario matrix

The first release is done only when the installed assistant can:

1. List installed apps, launch a named app, and verify its window appeared.
2. Detect an already-open app and focus it without launching a duplicate unless
   asked for a new window.
3. List open windows without leaking unrelated titles in the final response.
4. Focus an exact window, move it to a numbered workspace with and without
   following, and verify the final workspace.
5. Resize an exact window by small/normal/large bounded steps and verify geometry.
6. Move a workspace to an exact monitor and verify monitor ownership; skip with a
   clear reason on a single-monitor fixture.
7. Set floating/fullscreen/maximized state idempotently.
8. Set, show, and clear a reminder through Omarchy.
9. Change and restore one reversible system control such as volume, brightness,
   night light, or notification silencing.
10. Deny an action and prove no state changed.
11. Handle a window disappearing between inspection and action without acting on
    another window.
12. Resume a Pi conversation without replaying or persisting a failed action.
13. Load the official Omarchy skill from the real Pi path and the bundled desktop
    skill without a duplicate-name ambiguity.
14. Report unavailable browser/connector capabilities honestly instead of
    inventing them.

## Remaining human gates

- Test workspace-to-monitor movement on a real multi-monitor session; this host
  exposed only one monitor during implementation, so the exact command and
  receipt path are fixture-tested but not physically exercised across displays.
- Decide whether advanced window modes (fullscreen, maximize, groups, pin, and
  scratchpad) should join the structured surface or remain explicit raw-command
  fallbacks.
- Decide which connector platform, if any, should back calendar/tasks after the
  local desktop milestones are complete.
