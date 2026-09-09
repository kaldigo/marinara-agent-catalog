# Native tracker behavior reference

This is a concise record of the upstream behavior Unified Tracker intends to
preserve. The reference checkouts are read-only and remain the source of truth.
Detailed edge cases and implementation consequences are recorded in
`implementation-deep-dive.md`.

## Shared execution and persistence

- Tracker agents are normal post-processing agents.
- Successful raw results are written to `agent_runs`, but those rows have a
  message ID and no swipe index. Native continuity does not reconstruct tracker
  state from them.
- Applied state is stored in GameState snapshots keyed by assistant message and
  swipe.
- World State is processed first and normally creates the snapshot. Other
  trackers update the same target snapshot. When it is missing, the exact-message
  update path clones the generation baseline.
- Only committed snapshots feed normal historical context.
- The last three assistant messages with committed tracker data can receive a
  read-only tracker block immediately after their source message in agent
  history.
- Quest data and quest locks are filtered from non-Quest agent context.
- Hidden character tracker fields and their visible lock markers are filtered
  from agent context.
- Normal custom agents support native message-based `runInterval` cadence. The
  filter runs before request grouping and explicit retry bypasses it.
- Raw successful runs are saved before result application, so they can advance
  cadence even if a package result handler later fails.

## Native tracker UI activation

Native tracker state does not make its UI visible by itself. Both major tracker
surfaces are tied to the chat's active individual agents:

- `useTrackerPanelModel` builds `enabledAgentTypes` only when agents are enabled
  for the chat and only from `chat.metadata.activeAgentIds`.
- The docked Tracker panel maps `world`, `persona`, `characters`, `quests`, and
  `custom` to `world-state`, `persona-stats`, `character-tracker`, `quest`, and
  `custom-tracker`, then filters out sections whose agent ID is absent.
- `ChatArea` independently builds the Roleplay HUD's enabled-agent set from the
  same metadata.
- Desktop HUD widgets use direct checks for each native tracker ID.
- The mobile HUD uses the same checks to decide which parts of its combined
  world/player widgets are visible.
- Native docked rerun controls also require the corresponding individual agent
  ID and send that agent type to the retry route.
- Mari Bridge package-owned `tracker.section` contributions currently filter by
  their registered `agentIds`, but the bridge has no existing hook that
  virtually activates an existing native tracker section.
- Parent visibility is not granular enough for Unified Tracker: character stats
  render whenever stored, while the native persona surface couples status,
  inventory, and stats.

Consequently, the smallest bridge seam is to retain every native check and
inject an OR with a package-neutral function:

```text
enabledAgentTypes.has(nativeAgentType)
  || mariBridge.shouldShowTrackerSurface(nativeAgentType, { chatId })
```

The dock has a centralized section-enabled function where this can be applied.
The HUD has repeated simple checks for its desktop and mobile widgets, so each
of those checks must call the same bridge function. The function consults
registered package callbacks and returns false when there is no override.

This visibility result must not replace or mutate the real `activeAgentIds`,
because the real set still controls normal agent execution and settings state.
Native rerun guards must also remain separate so making a section visible does
not accidentally execute its covered standalone agent.

A second presentation seam is required to hide disabled nested domains without
deleting their stored data. GM Notes also has an internal HUD enablement check
which must consume virtual activation rather than only real `activeAgentIds`.

Primary sources:

- `references/marinara-engine-staging/packages/client/src/features/tracker-panel/hooks/use-tracker-panel-model.ts`
- `references/marinara-engine-staging/packages/client/src/features/tracker-panel/lib/tracker-panel.constants.ts`
- `references/marinara-engine-staging/packages/client/src/features/tracker-panel/components/TrackerSectionList.tsx`
- `references/marinara-engine-staging/packages/client/src/components/chat/ChatArea.tsx`
- `references/marinara-engine-staging/packages/client/src/components/chat/RoleplayHUD.tsx`
- `packages/mari-bridge/src/client/runtime.js`

Primary sources:

- `references/marinara-engine-staging/packages/server/src/services/storage/game-state.storage.ts`
- `references/marinara-engine-staging/packages/server/src/services/storage/agents.storage.ts`
- `references/marinara-engine-staging/packages/server/src/services/agents/agent-executor.ts`
- `references/marinara-engine-staging/packages/server/src/routes/generate.routes.ts`

## World State

- Prompt contract asks for all five scene scalars and all existing custom world
  fields.
- Generated missing/null scene scalars fall back to the preceding snapshot.
- Custom fields normalize NFKC/case/whitespace names, reject duplicate normalized
  names, coerce values to strings, and normalize icons.
- Existing custom rows are retained when omitted from the result.
- Existing canonical row names are retained.
- A specific existing icon is retained; a generic icon may be improved.
- Scalar and custom-value locks are enforced.
- Other tracker domains are always carried from the previous snapshot, even if
  batch cross-contamination puts them in the World State result.
- Authoritative map/spatial state can override location.
- Location changes can update the journal.

## Character Tracker

- Prompt contract returns `presentCharacters` and excludes the persona.
- Card matching uses exact ID, unique normalized card name, or a unique explicit
  quoted/parenthetical alias.
- Matched rows receive the canonical card ID, name, avatar, and crop.
- Multiple rows matching one card collapse to one.
- A separate history scan reads up to 100 committed snapshots, newest first,
  retaining up to 50 distinct characters.
- History deduplicates by ID, or by normalized name when no ID exists.
- Current-result rows restore first from the immediate preceding snapshot and
  then from long history.
- Programmatic restoration covers custom fields, stats, NPC avatars, crops, and
  portrait positioning. Mood, appearance, outfit, and thoughts currently rely
  on prompt compliance.
- An entirely missing/empty character array makes no change.
- In a non-empty result, omitted unlocked characters disappear. Omitted
  characters with any locks are restored.
- Character locks match ID, normalized name, then position as last resort.
- The lock matcher uses exact case-sensitive IDs, unlike saved-card
  canonicalization's case-insensitive ID lookup; canonical identity must be
  applied before locks.
- Native result application also performs avatar enrichment, optional NPC avatar
  generation, SSE patching, and NPC journal creation.

## Persona Stats

- The active persona is resolved before agent execution; the result contains no
  persona identity and uses separate persona storage.
- The prompt asks for the exact configured stat bars plus status.
- Omitted result sections preserve their stored values.
- A supplied stats array replaces unlocked rows; an explicit empty array clears
  unlocked rows.
- Stat locks match normalized names and then position.
- Omitted locked rows are restored.
- Name, value, and maximum can be locked; color cannot. The handler does not
  enforce configured maximums, colors, or row count after generation.
- Status is patched only when supplied and respects its lock.
- The handler supports inventory when supplied even though the current official
  prompt does not request it.
- There is no dedicated deep persona history scan; snapshot carry-forward and
  recent committed tracker context provide continuity.

## Custom Tracker

- The prompt requires all custom fields every run and states that omission
  deletes a field.
- A supplied fields array replaces unlocked rows while preserving unrelated
  `playerStats` properties.
- Lock reconciliation matches normalized name, then position.
- Omitted locked rows are restored; omitted unlocked rows are removed.
- There is no dedicated deep history scan.

Tracker Profile Details filters its persona fields out of Custom Tracker input
and merges Outfit, Location, Movement, and Activity separately. It canonicalizes
their names, preserves omissions and unrelated custom fields, and respects
their native custom-field value locks. Character Location, Movement, and
Activity use native character `customFields`, so native character restoration
already retains them when the model omits them.

## Quest Tracker

- Results are action updates rather than a replacement quest list.
- The initial merge matches exact case-sensitive quest name or quest entry ID.
- `create` adds only an unmatched quest.
- `update` replaces objectives only when objectives are supplied.
- `complete` marks a matched quest completed and may replace its objectives.
- `fail` removes a matched quest.
- Unknown update/complete/fail targets are ignored.
- Fully completed quests are removed when all objectives are complete or none
  exist.
- Quest and objective locks are applied after the action merge using identity,
  normalized names/text, and final position fallbacks.
- Description, rewards, and notes primarily feed journal output; the current
  GameState merge retains the structural quest fields.
- Journal updates occur only when the structural quest list changed after
  locks, so a description-only action does not currently reach the journal.
- There is no deep quest-history scan. Active quests carry through snapshots;
  completed/failed history lives outside the active list, including the journal.

## Inventory Tracker status

The official Marinara Agents checkout includes an `inventory-tracker` prompt,
but the inspected Engine staging source has no result-type mapping or native
applicator for it. It currently resolves through the generic context-injection
fallback. Inventory is outside Unified Tracker's confirmed scope.

## GM Notes package behavior

GM Notes is not a native Engine tracker, but Unified Tracker intends to preserve
its established package contract:

- action updates keyed by stable note ID;
- server-side lock enforcement;
- duplicate-create suppression by kind and case-insensitive text;
- source message/swipe stamps for create and update;
- cumulative storage in `playerStats.packageState["gm-notes"]`;
- exact-snapshot application through Mari Bridge;
- committed and agent-state context formatters;
- native docked Tracker and Roleplay HUD contributions.
- resumable Roleplay backfill in assistant-boundary batches, with progress in a
  revisioned package document and mutation limited to unlocked non-manual notes
  created inside already processed history.

Primary package sources:

- `packages/gm-notes/src/shared/state.js`
- `packages/gm-notes/src/server/index.js`
- `packages/tracker-profile-details/src/server/persona-fields.js`
