# Custom Script tools: GameState patches

Requires Mari Bridge 1.1.0 and Engine 2.4.6. This is an addition to the
existing isolated Script runtime, not a new tool or package endpoint.
The native `CUSTOM_TOOL_SCRIPT_ENABLED=true` switch and custom-tool
enablement/argument validation still apply.

## Authoring a custom tool

In Marinara's existing custom-tool editor, choose Script and supply your own
name, description, parameters and script. For example, a world-state script:

```js
mari.gameState.patch({
  date: args.date,
  time: args.time,
  location: args.location,
  weather: args.weather,
  temperature: args.temperature
});
return { ok: true };
```

Required inputs, outdoor temperature semantics and formatting belong in your
tool's schema/script. `patch()` records a request; it does not return stored
state. `context.gameState`, when native hidden context is enabled, remains an
isolated snapshot. Changing that object alone never persists anything.

## Writable data

| Property | Shape |
| --- | --- |
| `date`, `time`, `location`, `weather`, `temperature` | String or null |
| `worldCustomFields` | Native `{name, value, icon?}` rows, or `{updates: rows, removed: names}` |
| `presentCharacters` | Native complete character rows, including custom fields, stats and thoughts |
| `recentEvents` | String array |
| `playerStats` | Partial native player object, or null |
| `personaStats` | Native `{name, value, max, color}` rows, or null |

Player data includes stats, attributes, skills, inventory, quests, status,
custom tracker fields, and the Inventory Tracker's currencies, equipped and
carried rows. Omitted player properties are retained. Array fields follow
native tracker merging and locks; world custom-field arrays upsert by name.
Use the native `removed` form to remove a world custom field explicitly.
Supply complete rows for character/stat/quest arrays. Unknown nested fields,
wrong types and duplicate row identities fail validation.

```js
mari.gameState.patch({
  playerStats: { status: "Resting" },
  personaStats: [{ name: "Energy", value: 75, max: 100, color: "#22c55e" }],
  recentEvents: ["The party reached the harbor."]
});
return "Updated the scene";
```

Snapshot IDs, chat/message/swipe ownership, commit status, timestamps,
manual overrides, field locks and hidden-field settings cannot be written by
scripts. Native editing controls remain their owner. Location writes are
rejected when Spatial Context owns the location.

## Save and failure behavior

The supported host is normal saved Roleplay generation (including Visual
Novel display) and Game generation. Conversation, impersonation, dry runs,
standalone executor calls and agent execution without this save host reject
effects instead of reporting an unsaved success.

Multiple calls in one successful script merge into one patch: the last value
for a field wins, and partial `playerStats` objects merge by property. Limits
are 64 calls and a combined 256 KiB UTF-8 patch per script. Scripts without
effects keep their existing return format. Scripts with effects return:

```json
{
  "result": { "ok": true },
  "gameState": {
    "applied": false,
    "pending": true,
    "patch": { "time": "12:05" },
    "note": "Queued for this turn. The change is not applied until this response is saved."
  }
}
```

The native per-responder pending queue preserves order with built-in state
calls. It stores effects, never reruns the script. An exception, timeout,
invalid patch or an explicit `{error: "..."}` return discards that script's
effects. A generation that fails or is cancelled before save writes no Script
state. A successful tool-only turn uses Marinara's hidden message anchor.
Regeneration writes the newly saved swipe's snapshot, retaining older swipes.

At commit, the native transaction rereads the exact target/base snapshot and
rechecks locks. If a lock would change any requested result, the entire script
patch fails. A lock acquired after the pending receipt can therefore reject
the eventual commit; the final native tool-result event reports that failure.
Unrelated GameState data and UI lock/visibility settings are preserved using
native snapshot storage. Other enabled agents retain their normal result
application behavior and can subsequently update unlocked fields.

## UI integration

Only a committed write emits a marked native `game_state_patch` event carrying
the actual saved snapshot. The count-checked client seam applies it to
Marinara's shared GameState store, including deletions and null clears, then
updates Agent Suite's separate `agent-suite/game-state` query cache. All native
HUD, docked tracker and popup panels consuming that state refresh normally.
Native panel visibility and edit/lock controls keep their existing settings.
No DOM polling, duplicate panel, or parallel GameState store is added.

## Optional model follow-up

Since Bridge 1.2.0, a custom Script tool's top-level return can include the
boolean `noFollowup` option:

```js
mari.gameState.patch({ weather: "Rain", time: "12:05" });
return { ok: true, noFollowup: true };
```

`true` ends the current chat responder's tool loop after the current batch
finishes. No tool-result follow-up, forced final tool round, separate Game
narrator request, or Game dice narration rewrite is sent. Any already generated
prose is retained. If there is no prose, the native hidden-message anchor
completes the turn without an empty assistant bubble. GameState effects still
commit through the normal saved-turn path and update all affected trackers.

`false` or omission keeps native follow-up behavior. Only boolean `true`
stops it; strings such as `"true"` do not. The option also works without a
GameState patch, in normal Roleplay, Game and Conversation chat generation.
It belongs in the Script return object, not in `mari.gameState.patch(...)`.

If any Script in a batch returns `noFollowup: true`, that batch finishes and
then the responder stops, even when another tool returns `false`. An explicit
`{error: "...", noFollowup: true}` also suppresses a model retry; the failure
is still reported and its GameState effects are discarded. A returned flag is
also honored if Bridge rejects the proposed state patch. A thrown exception
or timeout supplies no returned flag and follows the native error path.
Independently enabled agents and other group responders
retain their own lifecycle; this option controls the current chat responder,
not agent tool loops. Impersonation is outside this saved-turn contract.

## Verification

From the workspace root, with the shared harness lease held when using its
build or port:

```powershell
node packages/mari-bridge/scripts/check-script-game-state.mjs --engine=<built-2.4.6-root> --typescript=<typescript.js>
```

This exercises the patched QuickJS worker, executor, file-backed transactional
storage, real native generation route and compiled client state applier against
temporary fixture data. Add `--serve=1` to expose a disposable full-app fixture
on port 7861 for manual UI verification; stop it after closing the browser.

Run `npm run check` in `packages/mari-bridge`, plus the existing `check-engine`
integration test and consumer checks. Engine integration remains version-bound;
future internal anchor/schema changes require a new compatibility audit.

Verified locally on 2026-09-22 against the built Engine 2.4.6 distribution:
Bridge/SDK and all nine consumer checks; isolated worker, storage, generation
and compiled-client tests; live native generation updating World, Persona,
Character, Quest, Inventory and Custom docked sections and HUD summaries;
World and Persona popups; and persistence after a browser reload. Agent Suite
cache synchronization has executable coverage. The local test provider was
deterministic; Docker startup was not rerun for this change.

The 1.2.0 follow-up checks count provider calls through 39 native Roleplay,
Game and Conversation generation scenarios: boolean/omitted flags, failures,
mixed tool batches, empty and visible replies, saved patches, regeneration,
the final tool round, a separate Game tool connection and dice narration.
The existing compiled UI applier test still verifies the committed snapshot.
