# Mari Bridge Foundation Maintenance Plan

## Current status

The foundation is implemented for Marinara Engine 2.4.3. The installed
`mari-bridge` runtime owns the version-bound preload/client overlay and shared
registries. `_mari-bridge` is the thin SDK bundled into consumers.

Active consumers have been realigned to native Marinara ownership:

| Consumer | Native owner retained | Missing bridge seam |
| --- | --- | --- |
| Better Impersonate | Global Impersonate prompt/settings, generation guide, dry run, draft store, Stop | Slash commands, persistent draft lifecycle, provider-level draft continuation result, optional dry-run reasoning exposure, Quick Reply `{{input}}` |
| Group Sort Order | Agent editor/model/prompt and native group response queue | Smart group-selector delegation |
| Presence | Native message visibility and native agent card | Message-create lifecycle, scoped host access, commands, avatar-picker addition |
| GM Notes | Normal tracker agent settings/execution and native GameState APIs | Structured result type, committed context, Tracker panel and Roleplay HUD mounts |
| World Map Background | Native World Maps state, chat background renderer/store, agent card | Active-chat/lifecycle events, scoped native background update, and blur control addition |
| PWA Helper | Browser wake-lock/PWA behavior | Native generation lifecycle snapshot |

Response Keeper and Tracker JSON Editor are archived. Persona Reapply is
archived. Memory Core is a separate WIP and is not part of this plan.

## Mandatory native-first gate

Before adding a capability or changing a consumer:

1. Trace the current Engine source and identify the native owner.
2. Use the native API/component/workflow directly when it already satisfies the
   requirement.
3. If the native owner is inaccessible, add one small, package-neutral bridge
   seam at a verified call site.
4. Add package-owned behavior only for the feature-specific remainder.

Reject designs that introduce a second agent editor, settings page,
connection/model resolver, generation pipeline, dry-run implementation, Stop
button, GameState wrapper route, message store, or application shell.

## Implemented bridge responsibilities

### Bootstrap and compatibility

- persistent preload/client overlay under `DATA_DIR/mari-bridge`;
- exact Engine version and anchor-count checks before transformation;
- no patch application on unsupported or changed targets;
- bridge-first server and client activation;
- deterministic health, capability, diagnostics, and consumer session state;
- graceful restart/bootstrap behavior for local and Docker installations.

### Server extension points

- structured package agent result-type registration;
- committed and agent-facing tracker-context registration;
- smart group-selector delegation;
- scoped host request access where no public package API is available;
- host message/lifecycle contributions;
- prompt suppression/injection/transforms for consumers that genuinely need
  prompt assembly control.

These services expose missing seams. They are not alternatives to native agent
execution or public persistence APIs.

### Client extension points

- native slash-command registration and command draft writes;
- Quick Reply `{{input}}` resolution;
- active-chat and generation lifecycle snapshots;
- native Agent-card additions through `agent.settings`;
- native composer additions through `composer.above-input`;
- native docked Tracker sections through `tracker.section`;
- native Agent Suite Tracker Data through `agent-suite.tracker-data`;
- Roleplay HUD content through `roleplay.hud`;
- scoped updates through Marinara's native Roleplay background store and
  background-value adaptation.

The client overlay creates deterministic hosts at exact React call sites.
Consumers never discover these locations through MutationObservers, repeated
DOM scans, or button probing.

## UI contribution requirements

A native slot does not make arbitrary custom UI acceptable. Each contribution
must use the closest native component as its behavioral reference.

- Standard agent options remain in Marinara's agent editor.
- `agent.settings` adds only a package-specific field that the standard schema
  cannot represent.
- Tracker/HUD contributions use native chrome tokens, responsive sizing, and
  clamped body-level popovers.
- Editable data uses click-to-edit, inline save/cancel, explicit add mode,
  explicit remove mode, and stored/enforced locks where those concepts apply.
- `alert()`, `prompt()`, and `confirm()` are not normal editing interfaces.
- Cleanup removes subscriptions, timers, observers, global listeners, portal
  nodes, and outstanding feature work.

## Data and result rules

Use native storage before adding package storage:

1. message fields/`message.extra`;
2. chat metadata;
3. GameState/player stats;
4. standard agent settings;
5. character tracker fields/stats;
6. a package namespace only when none of the above owns the concept.

Every partial write preserves unrelated fields and package namespaces. Agent
results are validated and applied deterministically. Stored locks prevent agent
updates/removals as well as manual destructive actions.

Prompt guidance is advisory unless the product explicitly defines a hard data
invariant. For example, a prompt may tell an agent to prefer 20 concise working
notes without runtime normalization truncating note 21.

## Engine update procedure

For every new Marinara Engine version:

1. refresh the read-only reference checkout;
2. trace every currently used patch target against the new source;
3. add exact version/anchor fixtures and expected replacement counts;
4. run bridge checks and all active consumer checks;
5. prepare the complete harness with the catalog URL used by real updates;
6. test install, update, restart, clean restart, and unsupported-version
   fail-open behavior;
7. verify package health and agent discovery;
8. exercise functional browser flows, not screenshots alone;
9. only then extend the manifest Engine range and publish a patch release.

If any required target fails, the bridge applies no incompatible patch and
consumers requiring it stay stopped with an actionable diagnostic. Marinara
must remain startable and updateable in native mode.

## Verification matrix

| Area | Required verification |
| --- | --- |
| Bootstrap | first install, normal restart, clean restart, Docker persistence, loop guard |
| Compatibility | supported version, wrong version, missing/duplicate anchor, no partial patch |
| Ordering | bridge-first server/client activation regardless of installed order |
| Updates | catalog refresh, package update, restart persistence, no rollback to prior version |
| Agents | package health ready, native agent discovery, per-chat enablement |
| Settings | standard native editor, correct global/chat scope, only intended custom additions |
| Commands | native autocomplete/listing, parsing, collision handling, Quick Reply macro |
| Generation | native settings, lifecycle, Stop/abort, background-tab recovery |
| Tracker UI | HUD, docked panel, mobile/desktop, popover clamping, cleanup |
| Editing | inline edit, add mode, remove mode, lock/unlock, reload persistence |
| Results | schema validation, exact snapshot, locked-state enforcement, namespace preservation |

## Deferred work

Add a new bridge capability only when an active package has a traced need. The
following are not foundation blockers:

- speculative message-action, toolbar, or topbar slots;
- a replacement macro engine;
- a generic model executor when native agents/dry runs already work;
- general fetch interception;
- the separate Internal States project;
- Memory Core.

## Publication check

Before a commit or push:

- run `git diff --check` and inspect the scoped diff/status;
- run `mari-bridge` checks for bridge changes;
- run every affected consumer check;
- run the local harness from a clean restart;
- preserve unrelated and WIP files, especially `memory-core/`;
- bump only packages whose source or prepared output changed.
