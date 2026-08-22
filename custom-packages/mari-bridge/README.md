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

## Current implementation boundary

Version `1.0.2` supports Marinara Engine 2.4.3 and adds package-owned structured
agent result types, committed and agent-facing tracker-context sections, and
native mount points for the docked Tracker panel and Roleplay HUD. It also
retains the package-owned loader, SDK dependency gate, prompt kernel, and first
client lifecycle patches. Count-checked
transforms make `mari-bridge` activate first, serve its client before the Engine
client, patch both preset assembly and no-preset provider preparation, and emit
native active-chat and generation-controller events. It also owns per-chat streamed dry runs through
`generation.draft`; patched Roleplay commands receive `context.setDraft(text)`,
which writes through Marinara's persisted draft store after the originating
screen unmounts. The isolated test instance verifies the bridge and its current
consumers all reach `ready` after a restart.

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

The bridge provides five broad capabilities:

1. Prompt assembly control: named-section suppression, explicit-depth
   injection, and message transforms at defined processing stages.
2. Native client mount points: chat settings, message actions, composer slots,
   and related surfaces without package-owned DOM observers.
3. Lifecycle infrastructure: compatibility checks, package registration,
   prompt inspection, patch diagnostics, and safe failure when Marinara changes.
4. Native active-chat, command, Quick Reply, composer-slot, and generation
lifecycle APIs that replace DOM observation and button probing.
5. Package-neutral tracker integration: JSON result dispatch at normal and
   retry application points, exact-snapshot state adapters, and shared tracker
   context assembly.
6. Shared host services for persistence/route access, configured Agent
   execution, prompt macros, streaming, and package coordination.

## Relationship to `_mari-bridge`

`../_mari-bridge` remains the shared source root copied into package builds.
Migrated consumers copy only its thin `sdk/` surface; legacy compatibility
helpers remain temporarily for packages that have not yet been retired.
This new folder is a real installable capability package.

The intended split is:

- `mari-bridge`: one installed runtime that owns host patching and shared
  registries.
- `_mari-bridge`: the mandatory thin build-time SDK bundled into every consumer.
  It is the sole supported consumer integration surface: it verifies that the
  installed runtime is healthy and compatible, acquires a scoped consumer
  session, registers/cleans up behavior, and provides pure helpers such as
  message-range and stream parsing.

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
- Copying or permanently editing the Engine installation.
- Making arbitrary third-party source patches without fingerprints.
- Reimplementing Fastify generation routes.
- Publishing before supported Engine builds are explicitly tested.
