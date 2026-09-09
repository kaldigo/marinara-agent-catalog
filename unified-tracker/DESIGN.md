# Unified Tracker design

## Status

This document records the confirmed product contract and implementation
constraints for Unified Tracker 1.0. The runtime, Bridge seams, shared codecs,
focused checks, and native UI verification described here are implemented.

## Purpose

Run one structured tracker agent for the enabled tracker sections instead of
running a separate model job for every native tracker. The combined agent must
retain the useful behavior of each native tracker:

- exact message/swipe GameState ownership;
- committed-history boundaries;
- stable character matching;
- returning-character restoration;
- field locks;
- native state projection;
- native docked Tracker panels and Roleplay HUD panels;
- native agent settings, connection/model selection, retries, Stop behavior,
  and generation lifecycle.

The package must not create a parallel tracker application or duplicate native
panels.

## Confirmed controls

The package has one master agent enablement control and per-chat controls for
the work included in a run:

- World
- Characters
- Character stats, normally off
- Persona stats, normally off
- Quests
- GM Notes

Persona scene details are part of `characters`; they are not a separate result
section. Character stats are meaningful only when Characters is enabled.
Persona stats can be enabled without adding default persona status or inventory
tracking.

Each toggle controls all of the following for its section:

1. prompt instructions and input context;
2. admitted result properties;
3. result application;
4. future prompt/context injection;
5. visibility of the corresponding native docked and HUD tracker surfaces.

A disabled section must not be updated accidentally by cross-contaminated model
output.

Settings belong on the native Unified Tracker agent card through the native
`agent.settings` contribution slot. They are stored per chat in a package
namespace and must preserve unrelated chat metadata.

## Agent execution

Unified Tracker is one normal parallel agent with a package-owned custom result
type named `unified_tracker_update`. It reads the completed history available
when generation starts and normally finishes while the main response is still
being generated. The in-flight assistant response is handled by a later run.

Automatic pipeline execution is disabled for regenerations through the
package-neutral `settings.skipOnRegenerate` Bridge guard. Explicit reruns use
the native retry route and remain available.

The custom result type is required because the package needs to validate and
apply its package-owned scene detail fields directly. It is not intended to
replace the mature native applicators for world state, character state, persona
stats, quests, or locks.

The custom result handler validates the parent result, normalizes it, commits
the package-owned checkpoint to the exact message/swipe, and projects accepted
sections into native-shaped child results. Mari Bridge dispatches those child
results through native applicators, avoiding copied native logic.

The combined agent remains one logical task. Marinara may still batch that task
with another compatible agent request. A custom result type does not itself
isolate the provider request.

### Cadence

Available run modes are:

- every turn;
- every N turns;
- on request only;
- every N turns plus explicit on-request runs.

Native custom-agent cadence already supports the package's normal agent through
`settings.runInterval`. It filters before provider grouping and explicit
reruns/on-request runs bypass it.

The native unit is user/assistant messages, not completed story turns. Parallel
cadence is evaluated from history already present when generation starts; it
does not count the assistant response currently being generated. The settings
UI must either call this value messages or convert an advertised turn count to
the native interval. The server clamps it to 1-100 messages.

Unified validation and exact-snapshot package-state application run during
Bridge result expansion, before the raw parent result is persisted for cadence.
A failure marks the result unsuccessful and does not advance the interval.

## Result contract

The outer result is schema-versioned and contains only enabled sections. The
shape below is the version 1 implementation contract:

```json
{
  "schemaVersion": 1,
  "world": {
    "date": "...",
    "time": "...",
    "location": "...",
    "weather": "...",
    "temperature": "...",
    "customFields": []
  },
  "characters": [
    {
      "id": "...",
      "name": "...",
      "outfit": "...",
      "location": "...",
      "movement": "...",
      "activity": "...",
      "mood": "...",
      "appearance": "...",
      "stats": []
    }
  ],
  "quests": {
    "updates": []
  },
  "gmNotes": {
    "updates": []
  }
}
```

There is exactly one array field named `characters`. There is no nested
`presentCharacters` result, no `type` discriminator, no `persona:` or
`character:` ID prefix, and no `inScene` field.

Every entry uses the same field vocabulary. Storage routing happens only after
native-style matching and is not exposed as a second model-facing concept.

`stats` is admitted only when the applicable stats toggle is enabled. When
disabled it is omitted, not returned as an empty array, and existing stats are
preserved.

Omitted top-level sections mean "do not update this section." Invalid or
disabled extra sections are discarded before application.

## Characters

### Required and discovered entries

The agent input always includes:

- the chat's active persona;
- every saved character attached to the chat.

Other characters are added when they are relevant to the current scene. The
model does not decide whether the persona or chat characters are part of the
required input list.

### Matching

Matching follows native Character Tracker behavior as closely as possible:

1. match an existing real ID;
2. otherwise match a unique normalized saved name;
3. otherwise accept an explicit quoted or parenthetical alias only when it
   resolves uniquely;
4. otherwise use unique normalized historical-name matching for a returning
   unsaved character.

Duplicate candidate names must not be guessed. After a persona or saved
character is matched, the normalized result uses its real ID and canonical
name. No synthetic ID prefix is added.

Multiple returned rows matching the same saved identity collapse into one row,
with later generated properties merged over earlier ones, matching native card
canonicalization behavior.

### Historical restoration

Restoration order is:

1. generated value from the current run;
2. value from the immediately preceding visible snapshot;
3. newest matching value from committed historical snapshots;
4. saved persona/character defaults where applicable.

Historical values fill omissions; they do not overwrite a valid newly
generated value.

Unlike native Character Tracker's current implementation, returning-character
restoration covers every combined field:

- outfit;
- location;
- movement;
- activity;
- mood;
- appearance;
- enabled stats.

The history query must use committed snapshots at or before the visible
generation anchor so inactive swipes and future branches cannot contaminate the
result. Native Character Tracker's limits of 100 recent committed snapshots and
50 distinct returned characters are the initial reference values; final limits
remain configurable implementation details, not prompt rules.

### Locks

Matching and historical restoration happen before locks are enforced.

For locked characters, generated mood and appearance are discarded and the
stored values are retained. Other existing native/package field locks remain
authoritative for their fields. An omitted locked entry must be restored rather
than deleted.

The model may be told which values are locked to reduce wasted output, but the
server-side result handler is the authority.

### Native storage projection

After matching, the package projects the unified row into the existing native
storage owned by that identity:

- saved/scene character tracker values continue through native character
  tracker state and `customFields`;
- persona Outfit, Location, Movement, and Activity continue through the
  established `playerStats.customTrackerFields` names;
- enabled stats continue through the existing character/persona stat storage.

The model-facing array remains unified even though native persistence has
separate owners.

## World

World application follows native World State closely:

- missing scene scalars preserve the preceding value;
- existing custom fields match by normalized name;
- omitted existing custom fields are retained;
- existing canonical names are retained;
- specific existing icons are retained unless native policy permits replacing
  a generic icon;
- locks are applied after normalization;
- authoritative map/spatial state may override generated location;
- character, persona, quest, or notes fields accidentally emitted inside the
  world section are ignored.

The package must preserve native map synchronization and journal side effects
by delegating to the native world-state path rather than reimplementing it.

## Stats

Character and persona stats are independent opt-in controls and default off.

When enabled:

- character stat omissions are restored by normalized name, while persona stat
  arrays use native full-replacement semantics when supplied;
- generated values are reconciled by the same named-row and lock behavior as
  the native trackers;
- stat changes are proportional to events in the source turn.

Native locks protect name, value, and maximum, but not color. Native handlers
also do not enforce configured count, maximum, or color after generation. Any
stricter schema canonicalization would be a deliberate Unified Tracker rule and
must be decided and tested explicitly rather than assumed to be native parity.

Persona stats means stat bars only. Default persona status and inventory are
outside the current package scope and must remain unchanged.

When a stats control is disabled, stats are removed from the prompt output
contract and the result applier preserves stored stats even if the model emits
an accidental `stats` property.

## Quests

Quest results remain action updates, not replacement state:

- `create` adds a genuinely new quest;
- `update` changes an existing exact match;
- `complete` resolves an existing quest;
- `fail` removes an abandoned or failed quest;
- an empty updates array makes no change;
- supplied objectives are the complete replacement objective list for that
  quest;
- omitted objectives preserve the stored objective list;
- quest and objective locks are applied after reconciliation;
- native journal side effects are preserved.

The initial implementation should retain native exact-name/entry-ID matching.
It must not silently introduce fuzzy quest matching.

## GM Notes

GM Notes retains the existing package's action-based semantics and schema:

- stable note IDs;
- create, update, remove/resolve actions;
- locked notes cannot be edited or removed;
- duplicate creates are rejected by kind and case-insensitive text;
- created and updated message/swipe source stamps are retained;
- unrelated package namespaces are preserved;
- there is no deterministic note-count cap.

The unified package must reuse or share the existing GM Notes state codec and
merge rules. It must not create a second incompatible note schema or allow the
standalone GM Notes agent and Unified Tracker to write the same turn.

## Snapshot and historical storage

Marinara GameState snapshots, not raw `agent_runs`, are authoritative for
tracker continuity. Raw agent runs do not contain a swipe index and are not a
safe source for branch-aware recovery.

Every applied unified result is associated with the exact assistant message ID
and swipe index for which it was generated. The package should store its
normalized combined checkpoint in a package namespace on that same GameState
snapshot, then project accepted values into native fields. This preserves the
original combined contract for history and custom context while allowing native
panels and downstream consumers to keep reading native state.

When no target snapshot exists, the native exact-message update path must clone
the generation baseline rather than mutate an older turn.

The normalized checkpoint must preserve unrelated GameState fields and package
namespaces. Accepted swipes become committed history; inactive swipes remain
isolated.

## Context injection

The agent receives:

- the relevant recent chat history;
- current enabled tracker sections;
- the required persona and chat-character candidates;
- returning-character history;
- lock information needed for enabled fields;
- existing quests and GM Notes when their sections are enabled.

Disabled sections are removed from agent context to reduce tokens and prevent
cross-section updates.

For main-generation context, a stored unified checkpoint is injected at the
depth of the assistant message for which it was generated. It must stay attached
to that source message as the conversation grows. A static tail-relative depth
is insufficient.

The package uses Mari Bridge's package-neutral history transform to attach each
checkpoint to its source message. Latest-state-only tracker context is not used
for this requirement.

## Native docked and HUD surfaces

Enabling a Unified Tracker section must make its corresponding native docked
Tracker panel and Roleplay HUD surface visible:

- World enables the native world/scene tracker surfaces.
- Characters enables the native character tracker surfaces and the established
  profile-detail placements used by the combined character rows.
- Character stats makes stat rows visible within native character surfaces.
- Persona stats enables the native persona-stat surfaces.
- Quests enables the native quest surfaces.
- GM Notes enables the existing GM Notes docked and HUD contributions.

This must remain true without requiring the equivalent standalone tracker agent
to be active.

This is an activation requirement, not merely a requirement to have data in
GameState. The current client derives a set of enabled agent types directly from
`chat.metadata.activeAgentIds`. The docked Tracker panel filters its section
order through that set, and Roleplay HUD renders its widgets through direct
checks against the same native agent IDs. Writing tracker data alone will not
make either surface appear.

The confirmed surface activation aliases are:

| Unified Tracker control | Native surface agent IDs to activate |
| --- | --- |
| World | `world-state` |
| Characters | `character-tracker`; persona detail placement uses the profile content-mode hook described below |
| Character stats | No additional panel; enables stat content inside the character surface |
| Persona stats | Persona/profile surface in bars-only content mode; a raw `persona-stats` alias is too broad |
| Quests | `quest` |
| GM Notes | `gm-notes` package contributions |

The persona/profile surface may be present for the combined Characters section
even when Persona stats is off. The native Persona panel always includes status
and inventory, the desktop Persona widget includes status, and the mobile
`showPersona` flag includes status, bars, and inventory together. A plain
visibility override would expose fields that are explicitly outside this
package.

Likewise, native character panels render any stored character stats whenever
the Character surface is visible. Disabling Character Stats must hide those
rows without deleting them.

Mari Bridge provides package-neutral presentation flags/content filters for
nested tracker domains:

- Character Stats controls character stat rows in docked and HUD surfaces.
- Persona details can render without native status or inventory.
- Persona Stats controls bar rows only.
- Mobile Persona stats, status, and inventory need separate visibility inputs.

The current native HUD has no Persona Outfit/Location/Movement/Activity widget,
so those persona details remain in the docked Persona panel for 1.0. Characters
still activates the native Present Characters HUD. Persona Stats activates its
own HUD only when that separate section is enabled.

Agent execution and UI activation are separate concepts: Unified runs its own
selected sections, while activation controls which native tracker state and UI
surfaces are in use.

Unified Tracker must not persistently add the covered standalone tracker IDs to
`activeAgentIds` just to make their UI appear. Doing so would make Chat Settings
claim those standalone agents are enabled, allow them into normal batching, and
lose whether an ID was enabled by the user or only by the package.

Instead, Mari Bridge provides a package-neutral visibility override function backed
by registered package callbacks. The native visibility checks stay intact and
gain one OR condition:

```text
enabledAgentTypes.has(nativeAgentType)
  || mariBridge.shouldShowTrackerSurface(nativeAgentType, { chatId })
```

The bridge function returns `true` when any registered package says that native
surface should be visible for the active chat. Unified Tracker registers one
callback which reads its per-chat section toggles and answers only for the
corresponding native tracker agent IDs. The function is visibility-only: it does
not add an ID to `activeAgentIds`, enable an agent configuration, or participate
in server-side agent resolution.

The OR must be injected into:

- the docked Tracker panel's centralized `isSectionEnabled` check;
- each desktop HUD tracker widget check;
- each mobile combined-HUD `show...` check and its outer group check;
- Mari Bridge's package `tracker.section` and `roleplay.hud` agent-ID gating
  where a contribution uses a native activation alias.

Package-owned elements may have their own internal enablement checks. GM Notes
subscribes to the same virtual activation registry so its HUD and docked panel
react immediately to the Unified toggle.

The override is recomputed when the active chat, master agent enablement, or a
Unified Tracker section toggle changes. It is not written to chat metadata and
leaves no stale activation after disable, uninstall, or package failure. A
missing bridge, callback exception, or unavailable chat state returns false so
the original native condition remains authoritative.

Native rerun controls must not blindly reuse the visibility override. Their
existing raw `enabledAgentTypes.has(agentType)` guard can remain false for a
virtually activated surface until a separate bridge rerun resolver invokes
Unified Tracker on request with only that section selected. This prevents a
visibility override from silently running the covered standalone agent. If the
native agent is independently enabled and deliberately rerun, its normal native
retry path remains available under the standalone-agent policy.

The bridge/native slot continues to own placement, lifecycle, responsive
behavior, collapse state, edit modes, and cleanup. Unified Tracker supplies only
section activation, rerun resolution, and package-specific data.

No MutationObserver, DOM scan, button probing, duplicated tracker panel, or
parallel HUD is acceptable.

## Standalone tracker coordination

Unified Tracker does not suppress or rewrite independently enabled standalone
trackers. If a selected Unified section overlaps one, the settings card warns
that both agents will run. Disabling either agent leaves the other untouched.
Standalone reruns keep their native behavior; reruns from a virtually activated
surface are translated to a section-scoped Unified Tracker retry.

## Required bridge/native seams

The implementation uses these package-neutral capabilities:

1. Custom result-type admission and exact-snapshot application. Mari Bridge
   already provides the base registry.
2. Result expansion or native result dispatch so validated child sections can
   use native applicators.
3. A client tracker-surface visibility override, injected as an OR alongside
   native docked/HUD agent checks and independent of `activeAgentIds`.
4. Nested tracker presentation flags/content filters so a visible parent panel
   does not expose disabled stats, status, or inventory.
5. Historical tracker context formatting attached to source messages in the
   main model prompt.
6. Native tracker-surface rerun resolution so a virtually activated section can
   request Unified Tracker with the chat's current enabled-section contract.
7. Pre-persistence validation and package-state application so failed Unified
   results do not become cadence checkpoints.

Each hook was traced to a verified native caller and kept package-neutral. Where
an existing native or Bridge seam already did the job, it is reused unchanged.

## Failure behavior

- A total parse or schema failure applies nothing.
- Disabled sections are always ignored.
- No section may clear unrelated native state because another section failed.
- Enabled-section schema validation is atomic: a missing or malformed enabled
  section rejects the parent before any native child result is emitted.
- Stop/abort must use Marinara's native generation cancellation and leave no
  package-owned process running.
- Failure must not leave standalone coordination or UI activation stuck for the
  next turn.
- Checkpoint application failures occur during expansion, mark the parent
  unsuccessful, and do not silently become cadence checkpoints.

## Verification checklist

### Matching and history

- Persona and every chat character are included in agent input.
- Real IDs and canonical names replace matched output values.
- Duplicate names do not produce ambiguous matches.
- Explicit aliases match only unique candidates.
- Returning unsaved characters recover omitted historical fields.
- Current generated values win over current and historical state.
- Inactive swipe history never leaks into the active branch.

### Locks

- Locked character mood and appearance discard generated changes.
- Omitted locked characters are restored.
- Native world, stat, quest, objective, custom-field, and GM Note locks remain
  effective.
- Unlocking allows the next valid result to update the field.

### Toggles and standalone coordination

- Every section can be enabled and disabled independently where its dependency
  rules permit.
- Disabled result properties cannot mutate state.
- Disabled stats preserve all stored stat rows.
- Independently enabled standalone agents continue to run and produce an
  overlap warning on the Unified settings card.
- Disabling either the Unified section or standalone agent leaves the other
  configuration untouched.

### UI

- Each enabled section appears in the correct native docked Tracker panel.
- Each enabled section appears in the correct native Roleplay HUD surface.
- Standalone execution does not hide the panel or HUD.
- Surface activation does not add virtual native agent IDs to persisted
  `activeAgentIds`.
- Desktop, mobile combined HUD, docked Tracker, and package-contributed tracker
  sections call the same bridge visibility override.
- Rerun from a virtually activated native section requests Unified Tracker
  rather than running an inactive standalone agent. The retry uses the chat's
  current enabled-section contract.
- Edit, add, remove, lock/unlock, collapse, reload, and responsive/mobile
  behavior continue to follow native patterns.
- Disabling a section updates visibility without leaving stale contributions.

### Persistence and lifecycle

- Every result writes to the correct assistant message and swipe.
- Regeneration creates or updates only the target swipe snapshot.
- Reload restores toggles, normalized package state, native projections, and
  locks.
- Context checkpoints stay attached to their source assistant messages.
- Cadence and on-request runs write accurate source stamps.
- Failure, abort, disable, uninstall, and restart clean up registrations and
  virtual surface state.

## Resolved 1.0 decisions

Version 1 uses the `unified_tracker_update` result type and `unified-tracker`
package-state namespace. Cadence remains the native message-based 1-100 setting,
with interval 1 as the agent default and the normal automatic/on-request toggle.
Enabled-section validation is atomic. GM Notes and Tracker Profile Details share
source codecs through `_tracker-codecs`; they remain independently installable
packages. Persona scene details are dock-only because no matching native detail
HUD exists. Stats are canonicalized to saved configuration. World and
Characters start enabled; Character stats, Persona stats, Quests, and GM Notes
start disabled.
