# Mari Bridge

Mari Bridge is the installable compatibility foundation for capability packages
that need control beyond Marinara's current public package API.

This folder contains the published package implementation:

- `includeInMain` is `true`.
- `processing.kind` is `package-build`.
- The prepared package emits one installer server entrypoint plus a stable Node
  preload and its self-contained runtime modules.
- The injected server/client runtime exposes version negotiation, scoped
  consumer sessions, cleanup, and revocation before packages are loaded.
- The `_mari-bridge/sdk` wrappers fail closed before consumer code runs.

The consumer SDK is stable at API major version 1. Engine source patches remain
explicitly version-bound.

## Native-first boundary

Mari Bridge exists to expose capabilities Marinara does not currently expose to
packages. It is not a framework for replacing native Marinara behavior.

Consumers must use native agent definitions and native settings, connection,
model, prompt, generation, dry-run, Stop, persistence, and rendering behavior
whenever those paths already exist. The bridge adds only the missing seam: for
example a result type, tracker-context formatter, group-selector delegation,
command registration, lifecycle event, or verified native UI mount.

The decision order is:

1. Native Marinara API/component/workflow unchanged.
2. A small package-neutral bridge hook into that native workflow.
3. Package-specific implementation only where Marinara has no owner.

Bridge UI slots mount inside native React surfaces. They do not authorize a
consumer to create a parallel settings system or application shell. Added UI
must follow the matching native component's interactions as well as its visual
tokens. Standard agent settings stay in Marinara's standard editor; an
`agent.settings` contribution may add only a missing package-specific control.

## Current implementation boundary

Version `1.0.35` supports Marinara Engine 2.4.4 and keeps the injected client
kernel available when an optional native UI hook drifts. It also adds
package-owned structured agent result types, committed and agent-facing
tracker-context sections, native Agent Suite tracker-data registrations, and
native tracker-section contributions and Roleplay HUD mount points. Agent Suite tracker-data registrations receive a
post-save callback after Marinara's native GameState refresh, allowing their
package-owned surfaces to invalidate cached display data immediately. Dry-run
generation now accepts native generation guidance, supports provider-level
impersonation continuation prefills with an explicit continuation result, and
can expose reasoning on non-impersonation runs when the caller opts in. The
native Impersonate settings section also receives a native `SettingsSwitch`
for presets that already contain their own impersonation instructions. When a
specific preset and that switch are active, dry-run impersonation omits only
the normal Impersonate prompt template; guidance and continuation prefills keep
their native roles. Tracker
contributions are inserted inside Marinara's ordered section list and receive
the native section header, collapse behavior, edit mode, active-agent state,
and rerun callback; consumers provide only descriptors and feature-specific
body content. It also
retains the injected runtime, SDK dependency gate, prompt kernel, and first
client lifecycle patches. Count-checked transforms build a complete copied
server distribution before launch, patch both preset assembly and no-preset provider
preparation, and emit native active-chat and generation-controller events. The
installed package is only the versioned installer and restart handoff; consumer
ordering no longer depends on its activation. The injected runtime also owns per-chat streamed dry runs through
`generation.draft`; patched Roleplay commands receive `context.setDraft(text)`,
which writes through Marinara's persisted draft store after the originating
screen unmounts. The isolated test instance verifies the bridge and its current
consumers all reach `ready` after a restart.

Agent Suite tracker-data registrations reuse Marinara's existing Tracker Data
block, JSON editor, Save/Reset, dirty-state guard, AI Edit, GameState refresh,
and manual patch flow. Consumers provide only the agent ID, labels, state reader,
and merge-safe feature-state patch builder.

The version-bound preset-assembly patch extends Marinara's native macro context
with `{{active-agents}}`, `{{group_scenario_override}}`, and `{{group_mode}}`.
The scenario override resolves to the chat's trimmed Group Scenario Override or
an empty string. Group mode resolves to exactly `SOLO`, `MERGED`, or
`INDIVIDUAL`, based on the chat's full character roster rather than only the
currently active responders. These Bridge reads work through the native macro
engine in direct output, conditional operands, variable writes, nested card
fields, and bracketed per-character expansion. Card fields remain owned by
Marinara's native macro resolver; the bridge only makes preset assembly trigger
the native lorebook scan when an
Outlet macro is nested inside a character/persona field, then carries the
native Outlet map into the deferred per-character resolution pass.

Roleplay HUD hosts use a layout-transparent wrapper, so contributed widgets are
native flex items and inherit the HUD's exact alignment and `gap-0.5` spacing.
The `chat.background` client capability binds Marinara's existing Roleplay
background store at its native selector and lets an active-chat consumer apply
an already-persisted URL and blur immediately. Consumers do not render a second
background or own a competing cache. An early active-chat write is retained and
replayed as soon as the native store binds, so package activation order cannot
drop the initial background. The `spatial.context` capability observes the
shared native TanStack Query cache and publishes successful spatial-context
updates from World Maps without intercepting requests or probing its UI.
The server overlay also normalizes model-emitted XML-like spatial commands such
as `<spatial_move: destination_id="location-id"/>` immediately before native
World Maps parsing. The compatibility stream filter hides that form while it is
generated; native World Maps remains responsible for validation, movement,
suppression, persistence, and visible response cleanup.

The client runtime is emitted inside the patched client overlay and imported as
a static dependency of Marinara's main module. ESM dependency evaluation and
runtime initialization finish before Marinara's entry body can start any
capability client. It does not fetch package health or wait for the
`mari-bridge` client package, and there is no package-load ordering or polling
delay.

Before creating an overlay, the preload requires an exact supported Engine
version and preflights every target module and anchor. A version mismatch,
missing module, or changed anchor creates no patched server and leaves native
Marinara untouched. For a supported Engine, the complete built server tree is
copied into `DATA_DIR/mari-bridge/server` and patched on disk. Its metadata
records the Engine and Mari Bridge versions; a Bridge version change rebuilds
the copy. The live process then starts from that copied `index.js`, with the
original Engine root carried explicitly and runtime dependencies linked to the
native installation.

The package writes a stable preload under `DATA_DIR` and contains the POSIX
first-start `execve` bounce with a persistent loop guard. The direct local
launcher and restart path are tested; live Docker/POSIX self-bounce verification
remains required before publication.

## Intended outcome

Installing `mari-bridge` and performing Marinara's normal package restart should
be sufficient. The package should own its loader, patched client overlay,
compatibility metadata, state, diagnostics, and cleanup under `DATA_DIR`.
Docker Compose edits, an upstream Engine change, a custom image, and persistent
mutation of `/app` are not part of the intended installation flow.

The bridge provides six broad capability groups:

1. Prompt assembly control: named-section suppression, explicit-depth
   injection, and message transforms at defined processing stages.
2. Native client extension points: inline agent-card additions, composer
   slots, tracker surfaces, and Roleplay HUD contributions without consumer DOM
   observation. These extend native surfaces; they do not replace them.
3. Lifecycle infrastructure: compatibility checks, package registration,
   prompt inspection, patch diagnostics, and safe failure when Marinara changes.
4. Native active-chat, command, Quick Reply, composer-slot, and generation
   lifecycle APIs that replace DOM observation and button probing.
5. Package-neutral tracker integration: JSON result dispatch at normal and
   retry application points, exact-snapshot state adapters, and shared tracker
   context assembly.
6. Shared host services only where no public package API exists: scoped native
   request access, package coordination, and native group-selector delegation.
   `message.prepare` runs at native message creation, `message.persist` runs
   after native message persistence, and `chat.changed` runs after native chat
   or metadata persistence. Consumers receive structured events from exact save
   boundaries and must not rebuild native workflows from generic request hooks.

## Relationship to `_mari-bridge`

`../_mari-bridge` remains the shared source root copied into package builds.
Migrated consumers copy only its thin `sdk/` surface. This folder is a real
installable capability package; `_mari-bridge` contains no runtime implementation
or legacy compatibility layer.

The intended split is:

- `mari-bridge`: the installer that versions the stable preload/runtime bundle
  and performs guarded restart handoffs.
- `_mari-bridge`: the mandatory thin build-time SDK bundled into every consumer.
  It is the sole supported consumer integration surface: it verifies that the
  injected runtime is healthy and compatible, acquires a scoped consumer
  session, registers/cleans up behavior, and exposes the typed client/server
  session contracts.

Marinara's current package manifest does not declare package-to-package
dependencies, so every migrated consumer uses the SDK as a deterministic
runtime dependency gate; see `docs/IMPLEMENTATION-PLAN.md`.

Every active consumer will be rewritten for the new contracts. The injected
runtime will not emulate the old custom elements, DOM slots, global events, or
fetch interception. Response Keeper is retired, Persona Reapply is archived,
and Memory Core remains out of scope while it is a WIP.

Consumers must fail closed. If `mari-bridge` is absent, disabled, incompatible,
not fully started, missing a required patch/capability, or becomes unhealthy,
the SDK prevents or stops that consumer's feature runtime. Consumers do not
register partial routes, prompt hooks, UI, listeners, timers, or background
jobs and never fall back to the old bridge.

## Documents

- `docs/ARCHITECTURE.md` — design, lifecycle, persistence, and patch strategy.
- `docs/DECISIONS.md` — decisions already made and alternatives deliberately
  rejected or deferred.
- `docs/API-DRAFT.md` — proposed prompt and client registration contracts.
- `docs/BOOTSTRAP.md` — why early loading is required and how Docker/local
  startup can work.
- `docs/INVESTIGATION.md` — traced upstream behavior and source map.
- `docs/IMPLEMENTATION-PLAN.md` — phased work, verification, risks, and open
  decisions.

## Non-goals

- Replacing Marinara's entire prompt pipeline.
- Reimplementing native agent settings, model/connection policy, generation,
  dry runs, Stop behavior, persistence, or standard tracker controls.
- Copying or permanently editing the Engine installation.
- Making arbitrary third-party source patches without fingerprints.
- Reimplementing Fastify generation routes.
- Publishing before supported Engine builds are explicitly tested.
