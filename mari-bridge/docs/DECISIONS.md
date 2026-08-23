# Decisions

This is the short decision log for the investigation. Revisit a decision when
new Engine integration points appear, not merely because implementation is
awkward.

## D-001: Mari Bridge becomes an installed package

Decision: create `mari-bridge` as a real capability package. Keep
`_mari-bridge` as the thin shared source/SDK layer used by consumer builds.

Reason: one installed runtime should own patch ordering, compatibility,
diagnostics, and native client mounts. Bundling a patcher into every consumer
would create conflicting transforms and version skew.

Constraint: Marinara currently has no package dependency field, so consumers
must detect and report a missing bridge until dependency installation exists.

## D-002: No upstream Engine change

Decision: use package-owned compatibility patches. Do not modify the upstream
reference checkout or require an upstream PR for this work.

Consequence: every supported Engine build needs fingerprints and focused tests.
Unknown builds fail back to native behavior.

## D-003: In-memory server transformation is the primary method

Decision: use early Node module hooks to transform known server modules in
memory. Do not persistently rewrite `/app/packages/server/dist`.

Reason: module hooks are reversible, work against explicit source targets, and
do not disappear because a Docker image is recreated. The preload is stored in
the persistent data directory.

Clarification: self-`execve` is not the patch method. It is only the install-only
bootstrap used when the Docker command did not preload the module hook.

## D-004: Package installation plus normal restart is the target UX

Decision: the package prepares its own loader/overlay and transparently
bootstraps after the package restart. Manual Compose environment changes are
optional, not required.

Consequence: a zero-configuration Docker cold start may have one short internal
graceful bootstrap bounce. An externally supplied `--import` avoids it.

## D-005: Never bypass graceful Marinara shutdown

Decision: close Fastify and allow Marinara's `onClose` path to flush storage,
stop runtimes/sidecars, and release the writer lease before process replacement.

Reason: direct `execve` or `process.exit` during activation can lose debounced
writes and leave an unsafe storage lifecycle.

## D-006: Native UI mounts replace bridge DOM observation

Decision: patch small React call sites only for native surfaces required by an
active consumer. The implemented mounts cover native agent-card additions,
composer additions, the docked Tracker panel, and Roleplay HUD. Migrated
packages register scoped contributions; they do not locate hosts with
MutationObservers or repeated DOM scans.

Constraint: a mount extends the native surface. It is not permission to replace
the native agent editor, settings schema, tracker behavior, or application
shell. Contributions must match the corresponding native interaction patterns.

Consequence: the production client build needs a verified overlay because Node
module hooks do not transform browser assets served from disk.

## D-007: Prompt control has three separate operations

Decision: do not expose one unrestricted "mutate final prompt" callback. Define:

- structural suppression of named native sections;
- contributions with explicit role, anchor/depth, and ordering;
- message transforms at named history/main/agent processing phases.

Reason: suppression, placement, and message processing have different safety,
ordering, and diagnostic requirements.

## D-008: Keep Marinara workflows separate

Decision: trace and patch Roleplay, Conversation, Visual Novel, Game, raw,
dry-run, and agent calls explicitly.

Reason: sharing helper names does not mean those workflows assemble prompts or
track generation identically.

## D-009: Internal state is generated after the main response

Status: archived design context for a separate project. D-009 through D-012 do
not define the Mari Bridge foundation or current consumer migration scope.

Decision: preserve the main model's reasoning/instructions for consuming state,
but remove state-maintenance output from its visible response. Run one separate
agent call after the assistant response is committed.

The state agent returns structured operations. Deterministic package code owns
validation, numeric rules, IDs, idempotency, and persistence.

## D-010: First internal-state storage split

Decision:

- NPC agendas and locations use character tracker custom fields.
- Relationship BOND/Sparks/Grudge use tracker stats.
- Spatial positioning and scene physics use a tracker custom field.
- GM notebook and Chekhov bullets use dedicated feature storage/handling.

Titles/skills, factions/secrets/lies/awareness, and world simulation are skipped
for the first version. NPC thoughts, quests/DND, and inventory/status remain
unselected future scope.

## D-011: One state-agent call, composed per chat

Decision: state modules are toggled at chat level. One call is built from the
enabled module fragments, relevant history, and a private state/GFX rendering
generated from stored data.

Reason: this keeps state updates coherent and avoids one agent request per
tracker category.

## D-012: GM notes remain prompt-visible state

Decision: inject relevant GM notebook content into every applicable main-model
request unless a later retrieval/index design proves it can preserve behavior.

Reason: unlike character-owned tracker fields, GM notes contain cross-turn,
cross-character reminders and loose threads with no existing native owner.

## D-013: Local and Docker use the same patch contracts

Decision: Docker can self-bootstrap; local production-build tests launch
directly with `--import`. Client source/Vite testing needs a separate transform
adapter or verified production overlay.

Reason: `process.execve` is POSIX-only, and a Node module hook does not
automatically transform source files read internally by Vite.

## D-014: Every surviving consumer is rewritten for the installed bridge

Decision: migrate each surviving package to the new Mari Bridge contracts. Do
not maintain the old custom-element, `capabilityProps`, DOM-slot, global-event,
or bundled-runtime APIs as a compatibility layer.

Reason: a clean consumer rewrite lets the installed bridge expose direct,
coherent APIs instead of carrying two generations of lifecycle and rendering
contracts indefinitely.

Consequence: migration is atomic per consumer. A rewritten package declares the
bridge requirement and does not silently fall back to its old DOM/fetch patch.
The old `_mari-bridge` implementation remains available only while unmigrated
packages still exist in development; it is removed after the last migration.

## D-015: Response Keeper is retired

Decision: do not migrate Response Keeper and do not reproduce APIs used only by
it.

Specifically, the general `window.fetch` interception pipeline can be scrapped.
Prompt and generation hooks must use native patched call sites instead of a
global fetch wrapper.

SSE parsing/streaming remains available where it is needed by surviving
dry-run, raw, or agent-generation consumers. It is retained as a thin SDK or
generation-service implementation detail, not as Response Keeper compatibility.

## D-016: Preserve every other materially used bridge capability

Decision: preserve every capability materially used by an active consumer:
slash commands and ranges, active-chat lifecycle, generation state/abort,
scoped host access, runtime ownership/versioning, and the native UI slots
currently selected.

Do not retain or build speculative replacement services merely because an old
bridge once exposed something similar. Native prompt macros, generation,
actions, persistence, and UI remain native unless a current consumer proves a
missing seam.

## D-017: `_mari-bridge` is the mandatory consumer SDK

Decision: every surviving consumer imports the thin `_mari-bridge` SDK and uses
it as the only supported route into the installed `mari-bridge` runtime.
Consumer packages do not read bridge global symbols, patch Marinara, or recreate
health/version/capability checks themselves.

The SDK owns discovery, API-version negotiation, required-capability checks,
scoped consumer sessions, cleanup aggregation, typed unavailable errors, and
pure shared helpers.

## D-018: Consumers fail closed when the installed bridge is not healthy

Decision: before performing feature activation, each consumer declares its
required server/client capabilities through the SDK. If Mari Bridge is absent,
disabled, still starting, incompatible, degraded in a required subsystem, or
missing a required patch, the feature package does not run.

Server activation fails before registering routes, prompt hooks, services,
timers, or writes. Client activation mounts no UI and installs no listeners or
background work. If required bridge health is lost after activation, the
consumer session is revoked and its aggregated cleanup runs.

There is no old-bridge fallback. Failure is surfaced as an actionable package
status naming the missing runtime, version, patch, or capability.

## D-019: Mari Bridge starts before its consumers

Decision: the early patch layer enforces bridge-first server package activation
and client runtime initialization. Runtime package order cannot be left to
installation order because consumers must not deadlock waiting for a bridge
package scheduled later in the same sequential activation pass.

The preload kernel exists before Engine imports; the installed server runtime
is activated before consumers; the client overlay/runtime is ready before
consumer client entrypoints execute. The SDK check is therefore deterministic,
not a timing race or polling loop.

## D-020: Native Marinara owns the default workflow

Decision: packages reuse native agent definitions, settings, connection/model
selection, generation, dry runs, Stop behavior, persistence routes, and standard
UI whenever available. Mari Bridge adds only a missing hook or native extension
slot. Package code owns only feature-specific behavior and state with no native
owner.

Consequences:

- a normal agent remains a normal `agents.json` agent;
- package settings extend its native card instead of replacing the editor;
- package routes do not proxy an existing native route;
- feature UI mounted in native slots follows native inline edit, add/remove
  mode, locking, responsive popover, and cleanup behavior;
- prompt guidance does not become a destructive storage cap without an
  explicit product rule;
- screenshots are insufficient verification: persistence and interactions must
  be exercised in the harness.
