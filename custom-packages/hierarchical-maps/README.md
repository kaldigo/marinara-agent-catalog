# World Maps

Exploratory fork of Pasta-Devs World Maps 1.5.2. This replaces the official
`hierarchical-maps` package; it is not a second Maps installation. Native map
storage, routes, agent identity and UI slots are preserved. The initial 1.0.0
build hit Engine's blocklist for an old official version; the prompt split was prepared
locally as 1.0.1 and location effects were prepared as 1.1.0. The catalogue replacement
is 1.5.3, retaining upstream's major/minor and advancing its patch so existing
official 1.5.2 installations can update. `includeInMain: true`
enables the custom source to replace the official entry in our catalogue by its
unchanged `hierarchical-maps` ID.

## Optional known-location list

In World Maps agent details, open **Turn prompt insert**, edit the Roleplay or
Game template, remove `${knownLocationsBlock}`, and save. The authority rules,
current location and nearby destinations remain. Each mode has its own template.
Existing saved templates without the new variable omit the list automatically;
resetting a template restores the upstream-style list as a separate variable.

Without the list, automatic moves to distant places have less naming/ID context.
Nearby destination IDs and manual map travel remain available.

## Location backgrounds

In the World Maps agent details or chat settings, enable **Use location image as
chat background**. In Roleplay, the current location's reference image becomes
the native chat background. This setting is independent of the reference-image
checkbox used for illustrations. A location without an image, turning this option
off, or disabling Maps restores the previous background. A manually replaced
background is preserved until the next location change. Use Marinara's native
Background Blur setting; there is no second renderer or package blur field.

## Excluded lore

Select a saved location in the map editor, open **Excluded lore here**, search
for entries and select the ones to suppress. These settings apply to this chat
and this exact location. They are separate from the reusable/shared map, and
parent/child locations do not inherit them.

The fork uses native `entryStateOverrides`, not global entry changes. It records
only the enabled flags it temporarily changes and restores their prior values
when leaving. Previously disabled entries remain disabled, and native counters
and unrelated fields are preserved. Suppression applies before ordinary and
linked-location activation. Explicitly copying lore text into prompts or history
is outside this activation filter.

## Maps → World State

While Maps is enabled, map changes update the native World State location with
the full hierarchy joined by comma and space: `Home, Upstairs, Bedroom`.
There is no reverse sync: tracker edits and tracker-agent location guesses never
move the map. This includes the generic Away node if it is selected; the full
map path is used without special treatment.

Only location is written through the native tracker API. Existing weather,
date/time, temperature and other tracker fields are preserved. If no World State
exists yet, the native API creates its initial state. A locked location field
pauses the Roleplay sync; unlocking resumes it. Selected swipes use their own
resolved map location. World State keeps the last location when Maps is disabled.

## Integration and lifecycle

No Engine changes or retired bridge are used. The package uses the trusted
server's native Fastify lifecycle hooks, native movement validation and scoped
chat-lock/transaction APIs. Before `/api/generate` reads metadata, a validated
pending move prepares the destination's effects; native Engine still owns the
movement and generation. A rejected request reconciles back to the actual state.
Commit hooks also cover narrated movement. World State writes run after Maps'
transaction releases its chat lock, and streaming completion reconciles any late
tracker-agent output. Mutation-response hooks cover saved
map edits, selected swipes and chat settings. Preview/dry-run reads do not write
location effects. Startup reconciliation runs after listening, so native gallery
requests cannot deadlock activation. Deactivation restores managed state.

These integration points depend on the inspected Engine 2.5.1 request paths and
snapshot lifecycle. Recheck them when updating upstream. Entry flags edited while
suppressed share the native enabled field; the fork restores only a flag that
still has the value it wrote, preserving distinguishable intervening edits.

## Verification

`npm run check` covers the Roleplay/Game prompt contracts, optional list removal,
required authority, nearby destinations, saved-template normalization and map
immutability, plus restoration, overlapping exclusions and intervening edits.
The isolated harness script
`scripts/verify-host.mjs` exercises browser
edit/save/reload/restore, background rendering, exclusion controls, ordinary and
linked lore, actual move-and-reply prompts, narrated moves, selected swipes,
rejected moves, disabling Maps, another chat's isolation, and the official World
State agent. Acquire the shared harness lease before running it. It defaults to
this workspace layout; set `MARINARA_WORKSPACE_ROOT` if the source is elsewhere.

## Build

Install package dependencies and run `npm run build` and `npm run check`.
For local development, `MARINARA_ENGINE_ROOT` may point to an installed Engine
checkout to supply build dependencies. Runtime does not read that checkout.
Prepared output is `dist/package`; the catalogue workflow owns publication.

## Passageway location types

Under **Location types**, choose **Edit location types** and tick **Passageway**
for hallway, landing or similar types. Available destinations expand breadth-first
through those locations, stopping at ordinary types. First discovery wins, so each
destination appears once with the shortest passageway route. Parent/child moves
and available links retain their existing direction and visibility rules. A Home
container starts with its immediate children; an ordinary exterior destination
stops expansion into the town. Backgrounds, lore and World State change only for
the destination actually reached. Existing types default to unchecked.
