# Mari Bridge

Mari Bridge is the installable compatibility foundation for capability packages
that need control beyond Marinara's current public package API.

This folder contains the published package implementation:

- `includeInMain` is `true`.
- `processing.kind` is `package-build`.
- The prepared package emits server and client entrypoints plus a stable Node
  preload.
- The server/client runtime exposes health, diagnostics, version negotiation,
  scoped consumer sessions, cleanup, and revocation.
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

Version `1.0.14` supports Marinara Engine 2.4.3 and adds package-owned structured
agent result types, committed and agent-facing tracker-context sections, and
native tracker-section contributions and Roleplay HUD mount points. Tracker
contributions are inserted inside Marinara's ordered section list and receive
the native section header, collapse behavior, edit mode, active-agent state,
and rerun callback; consumers provide only descriptors and feature-specific
body content. It also
retains the package-owned loader, SDK dependency gate, prompt kernel, and first
client lifecycle patches. Count-checked
transforms make `mari-bridge` activate first, serve its client before the Engine
client, patch both preset assembly and no-preset provider preparation, and emit
native active-chat and generation-controller events. It also owns per-chat streamed dry runs through
`generation.draft`; patched Roleplay commands receive `context.setDraft(text)`,
which writes through Marinara's persisted draft store after the originating
screen unmounts. The isolated test instance verifies the bridge and its current
consumers all reach `ready` after a restart.

The version-bound preset-assembly patch extends Marinara's native macro context
with `{{active-agents}}`, `{{group_scenario_override}}`, and `{{group_mode}}`.
The scenario override resolves to the chat's trimmed Group Scenario Override or
an empty string. Group mode resolves to exactly `SOLO`, `MERGED`, or
`INDIVIDUAL`. Card fields remain owned by Marinara's native macro resolver; the
bridge only makes preset assembly trigger the native lorebook scan when an
Outlet macro is nested inside a character/persona field, then carries the
native Outlet map into the deferred per-character resolution pass.

Roleplay HUD hosts use a layout-transparent wrapper, so contributed widgets are
native flex items and inherit the HUD's exact alignment and `gap-0.5` spacing.

The client runtime is prepended directly to Marinara's patched main module. It
is ready before Marinara can import any capability client, with no package-load
ordering, polling delay, or separate bootstrap-module dependency.

Before registering Node loader hooks, the preload requires an exact supported
Engine version and preflights every target module and anchor. A version mismatch,
missing module, or changed anchor applies no patches: Marinara starts with its
native code, Mari Bridge exposes diagnostics only, and all consumer packages
remain stopped. This is the safe rollback boundary; patches are never removed
after an Engine module has begun evaluating.

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
   request access, package coordination, native group-selector delegation, and
   host lifecycle contributions. Consumers must not use these to rebuild
   available native workflows.

## Relationship to `_mari-bridge`

`../_mari-bridge` remains the shared source root copied into package builds.
Migrated consumers copy only its thin `sdk/` surface. This folder is a real
installable capability package; `_mari-bridge` contains no runtime implementation
or legacy compatibility layer.

The intended split is:

- `mari-bridge`: one installed runtime that owns host patching and shared
  registries.
- `_mari-bridge`: the mandatory thin build-time SDK bundled into every consumer.
  It is the sole supported consumer integration surface: it verifies that the
  installed runtime is healthy and compatible, acquires a scoped consumer
  session, registers/cleans up behavior, and exposes the typed client/server
  session contracts.

Marinara's current package manifest does not declare package-to-package
dependencies, so every migrated consumer uses the SDK as a deterministic
runtime dependency gate; see `docs/IMPLEMENTATION-PLAN.md`.

Every active consumer will be rewritten for the new contracts. The installed
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
