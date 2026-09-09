# Unified Tracker implementation deep dive

## Purpose

This document records the non-obvious behavior found by tracing every tracker
that Unified Tracker intends to cover. It separates behavior that should remain
native from behavior the package must add for its combined contract.

The most important conclusion is that a native tracker result is not merely a
GameState assignment. Native application also owns identity repair, snapshot
selection, lock reconciliation, UI-preserving merges, spatial authority,
journal updates, avatar work, client patches, and lane-specific behavior. The
package validates and splits one combined result, then delegates each child
section to a native applicator with an explicit `main` or `retry` lane.

## Cross-cutting execution

### Request grouping

Agents are grouped inside their phase by provider instance, model, post-process
lane, and whether they include pre-generation or parallel results. Tool-using
agents are removed from normal batches. A compatible group is split round-robin
into up to the connection's `maxParallelJobs` jobs.

There is no rule that groups exactly two agents. A connection configured with
two parallel jobs commonly makes a larger compatible group appear as pairs.
Unified Tracker remains one logical parallel agent, but it may share a provider
request with another compatible parallel agent. Its custom result type does
not force request isolation.

### Native cadence is usable

Normal non-built-in agents already support `settings.runInterval`; no new
cadence hook is required for Unified Tracker.

- The filter runs after agent resolution and before provider grouping.
- It counts user and assistant messages since the last successful raw run.
- A parallel run counts only completed history available when generation
  starts; the in-flight assistant response is considered by a later run.
- Automatic runs opt into `settings.skipOnRegenerate`, so regenerating a swipe
  never creates another provider request. Explicit native reruns bypass this
  automatic-pipeline guard.
- No prior successful run means the agent runs immediately.
- If the last-run message no longer exists, the agent runs instead of remaining
  stuck.
- Native retry/on-request execution does not apply the interval filter.
- The server clamps the effective interval to 1-100 messages, even though the
  generic custom-agent editor currently advertises a maximum of 200.

The UI says "messages", not story turns. Starting from a run anchored to an
assistant message, an interval of 2 normally means every user/assistant cycle;
an interval of 4 normally means every second such cycle. The Unified Tracker
settings must either expose this honestly as messages or convert an advertised
turn count to the native message interval.

Cadence is anchored to `agent_runs.success`, and the raw run is saved before
result application. A successful model response whose custom result handler
later fails still advances cadence today. This is a bridge lifecycle gap worth
fixing or surfacing as an application failure.

### Exact snapshot ownership

All accepted tracker state belongs to the assistant message ID and swipe index
for which it was generated. `agent_runs` has a message ID but no swipe index and
cannot be used for branch-safe tracker recovery.

`GameState.updateByMessage` is the shared exact-target primitive. When the row
does not exist, it clones an explicitly supplied generation baseline (or the
latest state if no baseline was supplied) and preserves unrelated tracker
domains, locks, and hidden fields. The combined handler must use the generation
baseline supplied by the native lane; it must not independently query the
chronologically latest snapshot.

Manual UI edits use the same exact target. The client:

- applies them optimistically;
- debounces writes for 500 ms;
- persists pending patches in local storage;
- serializes writes per chat/message/swipe target;
- requeues non-stale failures;
- drops an explicit target after a 404 rather than writing to a different row;
- flushes on unload and panel cleanup.

Tracker list edits also re-read live GameState and merge only properties changed
from the rendered row. This prevents a delayed edit from overwriting unrelated
generation changes. Unified Tracker should keep native panels and mutation
hooks so this conflict handling remains intact.

### Result-handler lifecycle gap

Mari Bridge currently invokes a package result handler after saving the raw run
and before the native result-type `if` blocks. It supplies exact-target
`state.read`, `state.update`, an SSE patch emitter, and `lane: main|retry`.

The registry catches handler exceptions, logs them, and reports the result as
handled without changing the original successful Agent result. Therefore:

- application failure is not currently reflected in cadence;
- the normal client success event can already have been emitted;
- no automatic model retry is triggered for an application failure;
- there is no transaction spanning several native projections and side
  effects.

The combined handler must validate the entire envelope before writing. A bridge
improvement should make application failure observable. Whole-result atomicity
is not available merely by registering a custom result type.

### Native applicators are not reusable yet

The World, Character, Persona Stats, Custom Tracker, and Quest applicators are
inline in both the main generation route and retry route. Main and retry contain
deliberate differences. A safe dispatch seam therefore requires extracting
package-neutral native functions or adding a native child-result dispatcher;
fabricating native-looking `AgentResult` objects inside the package is not
enough while the only consumers are route-local `if` statements.

## World State

### Native main-generation behavior

- World runs first in result application and normally creates the exact
  message/swipe snapshot.
- Missing or null date, time, location, weather, and temperature preserve the
  generation baseline.
- `recentEvents` does not use the same fallback: omission currently writes an
  empty array.
- Existing world custom fields are normalized and retained when omitted.
- Names use NFKC, trimmed/collapsed whitespace, and case-insensitive matching.
- Duplicate normalized incoming names are discarded.
- Values are coerced to strings and icons are normalized.
- Existing canonical names remain stable. A specific old icon wins; a generic
  tag icon may be replaced by a more specific generated icon.
- Scalar and custom-value locks are applied after normalization.
- Character, persona, and player/quest data are always copied from the baseline
  instead of trusting cross-contaminated fields in the World result.
- Existing locks and hidden fields carry into the newly created snapshot.
- Manual scalar overrides are one-shot. Their edited values influence the
  baseline seen by the model, but the override markers themselves are not
  carried to the new snapshot.
- Spatial Context can own location. The main lane may materialize an assistant
  map transition from generated location guidance, emit a transition event,
  replace the textual location with the authoritative breadcrumb, synchronize
  map metadata, and journal a location change.

### Native retry behavior

Retry is a sparse patch rather than a new full World snapshot:

- only non-null supplied scalars are patched;
- custom fields are patched only when their property is present;
- the authoritative spatial breadcrumb replaces generated Game location;
- locks are enforced;
- the exact retry target is cloned from its retry baseline if missing;
- map metadata may be synchronized and an SSE patch is emitted.

Retry does not perform the main lane's assistant spatial-transition
materialization or location journal entry. Unified Tracker must dispatch with
the actual lane instead of applying main behavior during retry.

### Package requirement

World should be delegated without reinterpretation. The combined validator may
strip disabled or foreign sections, but it should not reimplement map
authority, lock policy, custom-field merging, or journal behavior.

## Combined characters and persona

### Saved character candidate matching

Native Character Tracker canonicalization follows this order:

1. exact character-card ID, case-insensitive;
2. unique normalized saved-card name;
3. exactly one unique saved-card name explicitly quoted with straight or curly
   single/double quotes, or placed in parentheses.

Duplicate normalized card names are removed from the name lookup entirely and
must not be guessed. A matched row receives the card's real ID, canonical name,
avatar path, and crop. Multiple generated rows matching the same card collapse
into the first position, with later row properties spread over earlier ones.

Unified Tracker must extend the candidate set to the active persona. Normal
agent lore includes the persona name and fields but not its ID, so the package's
custom context must explicitly provide the persona ID. Persona and character
names must share one ambiguity check. Exact ID remains the only safe resolution
when their normalized names collide.

Roleplay and Game may intentionally be persona-less. "Always include the
persona" therefore means include the active persona when one resolves; it must
not create a synthetic User identity.

### Historical collection

Native deep character history:

- reads at most 100 recent committed snapshots at or before the visible anchor;
- reads newest first;
- retains at most 50 distinct characters;
- deduplicates by lower-cased ID, or normalized name when no ID is present;
- tells the model that historical characters are not necessarily in the
  current scene.

The extra history block is hard-coded to the `character-tracker` agent type.
Unified Tracker needs the same history query exposed through a package-neutral
context hook or needs native history construction to recognize the combined
agent.

### Native restoration

For every returned row, native application restores from the current target
snapshot and then from long history. Generated rows win. Restoration currently
covers:

- omitted character custom fields, merged by property name;
- omitted stat rows, merged by normalized stat name;
- generated/uploaded NPC avatar paths;
- valid avatar crops;
- portrait focus X/Y and zoom.

It does not restore mood, appearance, outfit, or thoughts. The combined
contract intentionally adds historical restoration for its uniform scene
fields: outfit, location, movement, activity, mood, appearance, and enabled
stats. That extension must happen before locks and must use the combined
checkpoint to distinguish omitted values from explicit replacements.

An absent, non-array, or empty native `presentCharacters` result is a complete
no-op. Native generation therefore cannot express "clear all characters" with
an empty array. A non-empty result is authoritative for unlocked membership:
omitted unlocked characters leave the active array.

### Character locks

Native lock application matches a current character by exact case-sensitive ID,
then normalized name, then final position. The positional fallback exists for
legacy/ambiguous rows; if that fallback lands on a row with any lock, the whole
current row is retained rather than merging an unrelated generated identity.

Per-character locks cover emoji, name, mood, appearance, outfit, thoughts,
stat name/value/max, and custom-field name/value. Any omitted character with at
least one lock is appended back to the result. Character custom fields are also
structurally preserved even when unlocked.

Unified matching should canonicalize real IDs before applying native locks. The
specific combined rule for locked-character mood and appearance is then an
additional server-side discard, not a prompt-only instruction.

### New-chat defaults

New Roleplay chats seed saved character tracker rows only when a character card
has tracker custom-field defaults or enabled RPG pools. Seeded rows contain the
card ID/name, saved appearance, avatar/crop, custom fields, and RPG pools;
outfit and thoughts are empty. Existing rows win, while seeded custom fields
fill omissions and seeded stats are used only when the existing stat list is
empty.

This happens only during new Roleplay chat initialization. The combined agent
must still build its required candidate list from chat membership because many
saved characters have no seeded tracker row.

### Main-only character side effects

Main generation enriches missing avatars from attached cards, the character
library, chat NPC metadata, and stored NPC files. Manual `manual-*` tracker rows
are excluded. Optional Character Tracker settings can start background avatar
generation from appearance/outfit; its later write re-reads the exact snapshot,
merges only generated avatar paths, reapplies locks, and emits another patch.

Main generation also creates journal NPC encounters for newly appearing names,
excluding names matching the chat's saved character cards. Retry performs
identity, restoration, locks, exact write, and SSE only; it does not perform
avatar enrichment/generation or journal creation.

If Unified Tracker is expected to preserve these features, native dispatch must
resolve which Character Tracker settings own avatar generation even when its
standalone model execution is covered.

### Native edit behavior to retain

- Manual additions receive `manual-*` IDs.
- Character rename migrates both lock keys and hidden-field keys.
- Character removal clears feature-card state, all character locks, and hidden
  keys.
- Custom-field rename rejects normalized-name collisions and migrates its lock
  prefix.
- Custom-field removal clears its lock prefix.
- Hiding mood, appearance, outfit, or thoughts also locks and clears the value;
  showing it removes the automatically paired lock.
- Avatar upload resolves the live row again after the asynchronous request and
  drops the write if the target disappeared.

These are reasons to keep the native character surfaces and mutation hooks.

## Tracker Profile Details and persona projection

Tracker Profile Details promotes these fields:

- character: Location, Movement, Activity from `PresentCharacter.customFields`;
- persona: Outfit, Location, Movement, Activity from
  `playerStats.customTrackerFields`.

The client registry normalizes field names, sorts registrations by descending
priority and stable owner/ID order, and lets only the first descriptor claim a
normalized name. Promoted fields are filtered from generic custom-field rows and
rendered in the profile detail area. A descriptor appears only when matching
stored data exists.

Persona merge behavior is presence-sensitive:

- input keys are matched by normalized name;
- stored canonical output names are always Outfit, Location, Movement, Activity;
- omission preserves the old value;
- a present null becomes an empty string;
- value locks use the existing `player.custom.name:<encoded>.value` key;
- unrelated custom fields and package namespaces are preserved;
- duplicate promoted rows collapse to the first stored row.

Character promoted fields inherit native character custom-field preservation
and lock behavior. Persona promoted fields use a separate package result hook
attached to `persona_stats_update`; Unified Tracker cannot depend on that hook
running for its different result type. It must share/reuse the codec or register
an equivalent projection under `unified-tracker` without creating a second
schema.

Tracker Profile Details context currently activates only when
`persona-stats` is active. Unified Tracker needs its own context registration
or a shared activation alias.

## Character and persona stats

### Character stats

Character stats live on each `PresentCharacter.stats` array. Before locks,
native restoration appends every old stat whose normalized name is absent from
the generated list. Thus omitted character stat rows are preserved even when
they are not locked. A generated row with the same normalized name wins as a
whole row before locks.

Locks can restore stat name, value, and max. Color has no native lock key and is
not server-canonicalized. The prompt asks the model to keep configured pools,
but the handler does not enforce configured count, max, or color. If Unified
Tracker wants exact configured structure, that is an intentional stricter rule
and should be tested separately rather than described as native parity.

### Persona stats

Persona stat bars are a separate array with no identity in the result. Current
values overlay configured persona bars by exact case-sensitive name when the
agent context is built. The configured lore includes enabled bar names,
values/maxes, and RPG pools.

Application is property-presence based:

- missing/non-array `stats` leaves persona bars unchanged;
- a supplied array is a full unlocked replacement;
- an explicit empty array clears all unlocked rows;
- rows match locks by normalized name and then position;
- omitted locked rows are appended;
- name, value, and max can be locked; color cannot.

The native Persona Stats handler also accepts status and inventory. Missing
properties preserve them; explicit empty status clears it unless locked; a
supplied inventory array replaces unlocked rows under inventory locks. Main
generation journals newly acquired inventory names; retry does not.

Unified Tracker's Persona Stats toggle is bars-only. The validator must always
discard status and inventory even if the model emits them.

### UI coupling that visibility alone cannot solve

Stored stats render whenever their native character/persona component renders.
Turning off generation does not hide old rows:

- docked character cards render `character.stats` whenever non-empty;
- desktop and mobile Character HUD panels do the same;
- the native Persona panel always renders status and an inventory shelf, and
  renders persona stats when present;
- the desktop Persona Stats widget includes status, while a second widget shows
  inventory;
- the mobile `showPersona` flag enables status, stat bars, and inventory
  together.

Therefore the tracker-surface visibility OR is necessary but not sufficient.
The bridge also needs package-neutral presentation controls that can:

- hide character stat rows without deleting stored stats when Character Stats
  is disabled;
- show persona profile details while suppressing native status and inventory;
- show persona stat bars without status/inventory when Persona Stats is enabled;
- give mobile combined HUD separate `showPersonaStats`, `showPersonaStatus`, and
  `showInventory` decisions.

The current native HUD has no widget for Persona Outfit/Location/Movement/
Activity. A product decision is still needed: keep those details dock-only, add
a small native extension slot to the persona HUD, or provide a package-owned HUD
contribution using the existing native chrome. Simply activating
`persona-stats` would show the wrong fields.

## Custom Tracker overlap

Although generic Custom Tracker is not a Unified Tracker top-level section, it
owns the persona detail storage array and its behavior matters.

- A missing/non-array `fields` property is a no-op.
- A supplied array is a full unlocked replacement; `[]` clears unlocked rows.
- Named rows match locks by normalized name, then position.
- Omitted locked rows are restored.
- Unrelated `playerStats` properties are preserved.
- Legacy `field.locked` is migrated to the current value-lock key.
- The official prompt requires every field because omission otherwise deletes
  it.

Tracker Profile Details filters its four persona rows out of Custom Tracker
context and applies them separately, preventing the generic tracker from owning
those values. Unified Tracker must preserve this filtering and merge persona
details into the full live custom-field array instead of replacing it.

## Quest Tracker

### Input normalization

Quest results are actions. The normalizer accepts `completed`/`failed` aliases,
several alternate name keys, string objectives, alternate objective text keys,
and common nested collection keys. Nested traversal stops after depth 5.
Completed booleans also accept strings such as complete, completed, done, and
true.

Existing malformed/legacy quest collections are normalized from several nested
shapes before merging. This compatibility behavior should remain native.

### Action merge

Initial action matching is exact and case-sensitive against either `name` or
`questEntryId`.

- `create` adds only when no exact match exists. The new entry ID and name both
  equal `questName`, stage is 0, and completed is false.
- `update` changes only objectives, and only when the property is supplied.
- `complete` marks completed and may replace objectives.
- `fail` removes the matched quest.
- Unknown update/complete/fail targets are ignored.
- With auto-remove enabled, completed quests disappear only when they have no
  objectives or every objective is complete.

Case differences can therefore create or miss a quest even though the later
lock reconciler uses normalized names. Unified Tracker must not silently add
fuzzy matching.

Description, rewards, and notes are not stored in active GameState quest rows.
They are journal material only. Moreover, main currently journals normalized
updates only inside the branch where the structural quest array changed after
locks. A description-only update with no objective/state change does not reach
the journal. This exact behavior should either be delegated or intentionally
fixed upstream; the package should not invent a third variant.

### Locks and UI

Quest locks are applied after actions. Quest rows match by exact ID, normalized
name, then position; objectives match normalized text, then position. Locked
name/completed/stage and objective text/completed values are restored. Omitted
quests or objectives with any lock are appended back.

Manual quest additions use `manual-*` IDs. Removal clears all quest/objective
lock keys. Native panel mutations rebase edits against live rows using stable
entry IDs and preserve unrelated concurrent changes.

Main generation writes and journals changed updates; retry writes and emits an
SSE patch but does not journal them.

## GM Notes

### State and action semantics

GM Notes state is schema version 1 under
`playerStats.packageState["gm-notes"]`. Every merge preserves unrelated
`playerStats` fields and package namespaces.

- Kinds are reminder, thread, and debug.
- Text is whitespace-normalized and limited to 600 characters.
- Notes have stable IDs plus created/updated message and swipe stamps.
- Missing IDs are deterministically hashed from kind, text, source, and input
  index.
- Duplicate normalized IDs are discarded while reading state.
- Create rejects an existing ID and rejects same-kind, case-insensitive text.
- Update/remove require an exact ID.
- Locked notes ignore update and remove/resolve/delete.
- Update changes only non-empty supplied kind/text and refreshes updatedSource.
- There is no deterministic note-count limit.

The live agent uses action updates and exact-snapshot Bridge state scope. Its
committed formatter groups notes by kind and its agent-state formatter exposes
the structured state. Unified Tracker should import/share this codec rather
than fork it.

### Historical backfill behavior

- Only completed Roleplay history through the last assistant message is
  eligible.
- Batches start at 8 user/assistant messages and extend until they end on an
  assistant message.
- Individual message text is capped at 8,000 characters.
- Progress is a revision-checked package document keyed deterministically by
  chat ID; completed batches are resumable.
- A missing checkpoint message restarts scanning from the beginning.
- Runs are serialized per chat in memory and abort with the client request.
- Each prompt sees current notes and current native tracker state, excluding the
  GM Notes namespace to avoid self-duplication.
- Only unlocked, non-manual notes created within already processed history may
  be mutated. Later or manually curated notes are read-only.
- State is re-read after the model call and mutable IDs are recalculated before
  applying updates, reducing stale-write risk.
- The resulting cumulative note state is written to the latest exact GameState
  snapshot, while new/updated notes receive the last message of the processed
  batch as their source stamp.
- Active main generation pauses backfill from the client lifecycle; changing
  chats or unloading the element aborts it. The server itself queues backfill
  requests but does not independently lock against main generation.

Unified Tracker should not absorb the backfill loop into normal post-processing
runs. It should keep the existing resumable maintenance action and share the
same state.

### GM Notes UI activation gap

The current GM Notes tracker-section contribution can render when its native
slot says it is enabled, but its HUD element also computes an internal
`enabled` flag from `metadata.enableAgents` plus `activeAgentIds.includes("gm-notes")`.
Virtual surface activation alone will therefore still hide the HUD when the
standalone GM Notes agent is covered.

GM Notes needs a shared activation query or a small update so its UI recognizes
Unified Tracker's GM Notes toggle without adding `gm-notes` to persisted active
agent IDs. Its settings/backfill contribution, state refresh after generation,
serialized manual writes, body-portal cleanup, and pause/resume behavior should
otherwise remain unchanged.

## Context injection

There are two different native tracker-context paths:

1. Agent prompts may attach a read-only GameState block immediately after each
   of the last three eligible assistant history messages. This is correctly
   source-message-relative, but only within the agent's own recent context
   window. Character deep history is an additional hard-coded block.
2. The next main roleplay prompt receives one latest committed tracker context
   block outside chat history, immediately before the latest history or
   last-message block. Native section inclusion is based on real active agent
   IDs.

Mari Bridge can append package sections to the latest main block and structured
package state to each agent-history block when its registered agent type is
active. It cannot currently place a package checkpoint beside its source
assistant message in the main model's growing chat history.

Consequences for Unified Tracker:

- registering under `unified-tracker` can format current enabled state without
  pretending standalone agents are active;
- the package checkpoint should be stored on the exact source GameState
  snapshot, not in raw runs;
- the package-neutral main-history transform attaches stored checkpoints to
  their source assistant message;
- that formatter uses committed active swipes only, respects hidden fields,
  avoid duplicating the latest block, and obey a token/depth budget;
- disabled sections must be removed both from latest state and historical
  checkpoint formatting.

## Standalone coordination and on-request reruns

Unified Tracker does not suppress active standalone trackers. It detects overlap
from chat metadata and warns that both agents will run. Virtual UI activation
never adds or removes standalone IDs, so user enablement, execution, and
visibility remain distinct.

Native retry:

- accepts a list of agent types;
- runs only types that are genuinely active for the chat;
- bypasses automatic cadence;
- can target an older assistant message with `forMessageId`;
- has no generic request-scoped settings or section override.

A virtually activated native rerun uses the Bridge resolver to translate the
clicked inactive native type to an active `unified-tracker` retry. That retry
uses the chat's current enabled-section contract and does not race through
temporary chat metadata.

## Native UI activation and content control

The implemented visibility rule for native sections is:

```text
enabledAgentTypes.has(agentType)
  || mariBridge.shouldShowTrackerSurface(agentType, { chatId })
```

It covers the dock's centralized section check, desktop HUD checks, mobile
outer/group checks, and package contribution gating. It is fail-closed,
reactive, cleanup-safe, and visibility-only.

The implementation includes two nested-content rules:

1. A package-neutral presentation filter/flags API controls nested content
   such as character stats and persona status/inventory/stats. Visibility of a
   parent surface cannot imply that all of its native subdomains are enabled.
2. Package-owned HUD elements such as GM Notes subscribe to the same virtual
   activation source internally.

Rerun eligibility remains separate from visibility.

## Recommended ownership matrix

| Concern | Reuse/delegate | Unified Tracker responsibility |
| --- | --- | --- |
| Agent execution, model, Stop, automatic retry | Native normal agent pipeline | One agent definition and structured prompt |
| Every-N cadence | Native custom-agent `runInterval` | Honest messages/turns UI mapping |
| Exact message/swipe state | Bridge state scope and `updateByMessage` | Store combined checkpoint on the same row |
| World normalization, spatial state, journal | Native World applicator by lane | Validate/strip disabled world output |
| Saved character identity | Native canonicalizer | Add persona candidate and historical unsaved matching |
| Character history | Native committed history query | Restore all combined scene fields |
| Character locks/UI fields | Native lock and preservation helpers | Locked mood/appearance combined rule |
| Persona scene details | Shared Tracker Profile Details codec/storage | Route matched persona row into it |
| Stats locks/storage | Native stat lock helpers | Enforce independent toggles; discard status/inventory |
| Quests | Native quest normalizer/applicator by lane | Validate section and delegate actions |
| GM Notes | Shared GM Notes codec, backfill, UI | Route actions; coordinate virtual activation |
| Dock/HUD structure and editing | Native surfaces and bridge slots | Virtual activation plus subdomain presentation flags |
| Source-depth main context | New package-neutral bridge history seam | Format enabled checkpoint sections at source messages |
| Standalone coordination | Native independent enablement plus settings warning | Detect enabled overlap without suppressing either agent |
| Native section rerun | Bridge virtual-type rerun resolver | Translate inactive native type to Unified retry using current toggles |

## Primary sources inspected

- `references/marinara-engine-staging/packages/server/src/services/agents/agent-pipeline.ts`
- `references/marinara-engine-staging/packages/server/src/services/agents/agent-executor.ts`
- `references/marinara-engine-staging/packages/server/src/services/generation/agent-cadence.ts`
- `references/marinara-engine-staging/packages/server/src/services/generation/committed-tracker-context.ts`
- `references/marinara-engine-staging/packages/server/src/services/storage/game-state.storage.ts`
- `references/marinara-engine-staging/packages/server/src/routes/generate.routes.ts`
- `references/marinara-engine-staging/packages/server/src/routes/generate/retry-agents-route.ts`
- `references/marinara-engine-staging/packages/server/src/routes/generate/generate-route-utils.ts`
- `references/marinara-engine-staging/packages/server/src/routes/chats.routes.ts`
- `references/marinara-engine-staging/packages/shared/src/utils/tracker-field-locks.ts`
- `references/marinara-engine-staging/packages/shared/src/utils/quest-state.ts`
- `references/marinara-engine-staging/packages/client/src/hooks/use-game-state-patcher.ts`
- `references/marinara-engine-staging/packages/client/src/features/tracker-panel/hooks/use-tracker-mutations.ts`
- `references/marinara-engine-staging/packages/client/src/features/tracker-panel/components/sections/PersonaInventoryPanel.tsx`
- `references/marinara-engine-staging/packages/client/src/components/chat/RoleplayHUD.tsx`
- `references/marinara-engine-staging/packages/client/src/components/chat/RoleplayHUDPanels.tsx`
- `packages/mari-bridge/src/server/result-registry.js`
- `packages/mari-bridge/src/server/tracker-context-registry.js`
- `packages/mari-bridge/src/client/tracker-detail-field-registry.js`
- `packages/tracker-profile-details/src/server/persona-fields.js`
- `packages/gm-notes/src/shared/state.js`
- `packages/gm-notes/src/server/backfill.js`
- `packages/gm-notes/src/client/runtime.js`
