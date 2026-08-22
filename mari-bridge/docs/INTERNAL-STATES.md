# Internal States Consumer

> Archived design context for a separate project. It is not part of the Mari
> Bridge foundation implementation or its current publication plan.

## Goal

The first Mari Bridge consumer replaces model-generated FF5.2 internal-state
markup with a post-response agent update. The main model retains the reasoning
instructions that tell it how to use state, but it no longer has to generate
the state block in its visible response.

This distinction is fundamental:

- Main-model prompt: receives the current relevant state and uses it while
  writing the roleplay response.
- State-agent prompt: runs after the response and calculates structured state
  changes.
- Stored data: tracker fields/stats or package-owned records.
- UI: renders stored state without putting maintenance markup in chat history.

## Source material inspected

The design was derived from `FF5.2 Internal States BOLT Setup.json`. The source
preset contains:

- modular internal-state prompts injected primarily as user-role depth-zero
  material;
- BOLT reasoning instructions that consume those modules;
- an HTML `<internal_states>` block appended to every response;
- prompt-only regexes that strip older state markup at selected depths;
- presentation regexes for collapsible sections and relationship bars;
- state categories for agendas, locations, factions, relationships, quests,
  inventory/status, Chekhov bullets, NPC thoughts, GM notes, DND state, world
  simulation, and scene physics.

The prompts and reasoning are useful. The undesirable part is requiring the
main response to reproduce all persistence/display data every turn.

Do not copy the preset wholesale into Mari Bridge. The internal-states feature
package should adapt only the enabled modules and keep its prompt text
inspectable and user-editable where practical.

## Agreed first scope

| State | Storage/handling | First version |
| --- | --- | --- |
| NPC agendas | Character tracker custom field | Include |
| NPC locations | Character tracker custom field | Include |
| Relationship BOND/Sparks/Grudge | Character tracker stats | Include |
| Spatial positioning and scene physics | Tracker custom field | Include |
| GM notebook | Package-owned custom store and prompt renderer | Include |
| Chekhov bullets | Package-owned custom store and rules engine/agent output | Include |
| Titles and skills | — | Skip |
| Factions, secrets, lies, awareness | — | Skip |
| World simulation | — | Skip |

Inventory/status was discussed together with titles/skills in the source
preset. It should remain out of the first slice unless separately selected;
do not silently include it merely because the original prompt combined them.

NPC internal thoughts and DND/quest state were present in FF5.2 but were not
selected in the agreed bridge scope. Treat them as future decisions, not first
version requirements.

## Chat-level configuration

Each state module is independently toggleable per chat. A likely settings
shape is:

```json
{
  "enabled": true,
  "modules": {
    "npcAgendas": true,
    "npcLocations": true,
    "relationships": true,
    "spatialPhysics": true,
    "gmNotebook": true,
    "chekhovBullets": true
  }
}
```

Configuration belongs to the internal-states feature package, not Mari Bridge.
Mari Bridge supplies the native `chat.settings` slot and prompt/lifecycle APIs.

## Single state-agent call

One post-response agent call should cover all enabled modules. Its prompt is
assembled from module fragments closely based on the relevant FF5.2 prompts.
Disabled module fragments and schemas are omitted.

The call should use `bridge.generation.execute()` with the Agent connection
category so it inherits Marinara's saved Agent parameters, structured-output
handling, abort behavior, and Agent-category fallback. Internal States should
not call raw provider routes or duplicate connection resolution.

The call receives:

- relevant chat history, including the newly committed assistant response;
- active roster and character identities;
- a rendered, private GFX-equivalent view generated from current stored data;
- module rules and invariants;
- current chat time/location when available;
- the exact source message/swipe revision;
- a strict output schema.

It does not receive or return visible HTML. An illustrative result shape:

```json
{
  "source": {
    "chatId": "...",
    "assistantMessageId": "...",
    "swipe": 0
  },
  "tracker": {
    "characters": [
      {
        "characterId": "...",
        "agenda": { "goal": "...", "step": 1, "max": 3 },
        "location": { "scene": "...", "activity": "..." },
        "relationships": []
      }
    ],
    "scene": {
      "spatialPhysics": "..."
    }
  },
  "gmNotebook": {
    "upsert": [],
    "remove": []
  },
  "chekhov": {
    "load": [],
    "update": [],
    "fire": [],
    "prune": []
  }
}
```

The real schema should prefer stable IDs and operations over replacing entire
lists. Every operation is validated and applied by deterministic code; the
agent never writes tracker storage directly.

## State semantics to retain

### NPC agendas and locations

The FF5.2 agenda module initializes a named NPC goal, tracks a bounded step
counter, advances off-screen activity, handles completion effects, and records
location. The first implementation should retain the useful behavioral idea
while separating fields:

- agenda goal, progress, completion/replacement;
- current location and activity;
- last source message/revision;
- optional next-update timing.

Do not advance an agenda twice because a message is regenerated or a job is
retried. The deterministic applier needs an idempotency key.

### Relationships

The source model tracks BOND, Sparks, and Grudge, including caps, conversion
cadence, and behavioral tiers. Store numeric values as native tracker stats.
The state agent proposes evidence/events; deterministic code should enforce
caps, conversion intervals, maximum per-turn changes, and idempotency.

This avoids asking a model to perform persistent arithmetic reliably. The main
prompt renders only the relevant relationship state and behavioral guidance,
not the full maintenance ledger.

### Spatial positioning and physics

Store concise, current scene geometry in a tracker custom field: participants,
relative position/orientation, important barriers, held/contact state, and
environmental constraints. It should be replaced or reconciled each turn rather
than grow without bound.

The prompt renderer can convert it into a compact state section at the selected
depth. The public UI can expose it in a collapsible tracker panel.

### GM notebook

The FF5.2 notebook is a capped scratchpad of reminders, plot threads, and debug
items. It must be custom-handled because it is not naturally character-owned.

Recommended record fields:

- stable entry ID;
- kind: reminder, thread, debug;
- concise text;
- created/updated source message IDs;
- optional resolved flag;
- ordering and cap policy.

The source prompt caps the notebook at 20 entries and excludes facts already
owned by dedicated trackers. Preserve those principles. GM notes needed by the
main model must be injected on every applicable generation unless a later
summary/index retrieval design proves sufficient.

### Chekhov bullets

The FF5.2 module stores narrative debt with weight, age, prerequisites/locks,
eligibility, firing, jamming, and pruning. It is custom-handled because bullets
are cross-character narrative objects with lifecycle rules.

Recommended record fields:

- stable bullet ID and description;
- weight and age;
- status: locked, loaded, active/fired, pruned/jammed;
- typed locks/dependencies;
- subject character/location/mood references;
- creation and last-update source IDs;
- optional deadline expressed as structured time.

Let the state agent identify narrative debt, natural openings, and semantic
dependencies. Let deterministic code age bullets, enforce minimum age/cap,
calculate thresholds, and perform seeded/random checks. That division retains
the prompt's narrative judgment without trusting the model with repeated
bookkeeping arithmetic.

## Main-model prompt changes

When internal states are enabled for a chat:

1. Suppress the built-in tracker context if the feature package is replacing
   it.
2. Render tracker-backed and custom state into explicit bridge contributions.
3. Inject at configured depth/anchors with the same reasoning instructions the
   main model needs to use the data.
4. Transform history to strip legacy FF5.2 `<internal_states>`/GFX blocks from
   old messages before prompt processing.
5. Do not ask the main model to output updated internal states.

The history transform should target explicit legacy markers such as
`<!-- GFX_START --> ... <!-- GFX_END -->` and `<internal_states>` blocks. It
must not remove arbitrary user-authored `<details>` HTML.

## Correctness rules

- Run after the assistant response is stored, not before it is sent to the
  user.
- Queue per chat; allow parallel work only across different chats.
- Record source message and active swipe/version with every state transaction.
- Discard or recompute stale jobs after edits, deletes, or swipe changes.
- Retrying a job must not double-advance counters or relationships.
- A state-agent failure leaves previous state intact and exposes retry status.
- Tracker updates and custom-state updates should commit atomically where the
  available persistence APIs permit; otherwise use a journal and recovery.
- The next user message may arrive before state finishes. Define whether main
  generation waits briefly for the pending state job or uses the last committed
  snapshot and records a lag warning.

## UI needs

The consumer needs the bridge's native `chat.settings` slot for module toggles,
model/agent selection, status, and manual rerun. Optional `message.actions`
controls can inspect, rerun, or invalidate state derived from one assistant
message.

The visible state viewer should render structured data directly. It should not
rely on FF5.2 regex styling or hidden HTML in message content.
