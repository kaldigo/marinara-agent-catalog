# Implementation Plan

## Status and migration policy

The dependency kernel, package-owned preload assets, prompt assembler kernel,
bridge-first client overlay, active-chat lifecycle, and native generation
controller lifecycle are implemented and exercised against an isolated Engine
2.4.2 production build. The fail-closed smoke consumer, PWA Helper migration,
and World Map Background migration load successfully through the thin SDK.
Keep `includeInMain: false` until the publication conditions at the end are met.

Every surviving `_mari-bridge` consumer will be rewritten for the installed
bridge. The new runtime does not preserve old custom-element, DOM-observer,
global-event, button-probe, or bundled-runtime contracts.

Every consumer runs through the mandatory thin `_mari-bridge` SDK. Consumer
source never accesses the bridge registry directly. The SDK verifies runtime
health, API compatibility, patch status, and every declared capability before
running feature activation. A failed check means the feature package does not
run; a later required-capability failure revokes the session and runs cleanup.

Response Keeper is retired and excluded from migration. Persona Reapply is
archived, and Memory Core remains a separate work in progress outside this
foundation milestone. Their requirements do not block Mari Bridge publication.
General fetch interception is not rebuilt.

## Retained capability inventory

The implementation is not complete until it provides a replacement for every
retained row:

| Old subsystem | New owner | Migration target |
| --- | --- | --- |
| Runtime version/ownership/capabilities/warnings | Installed runtime registry | All consumers |
| Prompt contributions | Prompt suppression/injection/transform registry | Group Sort Order |
| Prompt macros | Deferred native macro service | Future consumers; not a current blocker |
| Host JSON injection | Normalized host/persistence service | Presence, Group Sort Order |
| Slash commands and augment ownership | Patched native composer command registry | Presence, Better Impersonate |
| Command token/range parsing | Thin SDK utilities | Presence, Better Impersonate |
| Custom Quick Reply `{{input}}` | Patched native Quick Reply resolver | Better Impersonate |
| Active-chat watching | Patched chat/navigation lifecycle store | Presence, Group Sort Order, World Map Background |
| Generation snapshot/abort | Native generation registry | PWA Helper, Group Sort Order |
| Dry-run/raw/Agent calls and streams | Configured generation execution service | Group Sort Order, if required by its parity trace |
| Native composer action invocation | Deferred | No current consumer blocker |
| Composer/chat/message/topbar UI slots | Native React slot registry | Presence and Group Sort Order; other slots are deferred |
| CSS and cleanup helpers | Thin SDK utilities where still useful | Rewritten client packages |
| General fetch interception | Retired | Response Keeper only; do not rebuild |

## Phase 0: fixtures and exact target map

Before runtime code:

1. Record the current reference Engine version/commit and hashes for candidate
   server/client targets.
2. Trace Roleplay, Conversation, Visual Novel, Game, raw, dry-run, and agent
   generation as separate workflows.
3. Trace history processing, tracker context construction, token fit,
   provider dispatch, response commit, abort, and completion.
4. Trace native active-chat/navigation state, composer submission, composer
   actions, generation state, and roster changes.
5. Identify minimal React call sites for every retained native UI slot.
6. Trace the native macro resolver, Agent connection parameter/fallback policy,
   persistence transactions, and missing write operations currently reached by
   `app.inject()`.
7. Capture unpatched fixtures and expected transformed fixtures.
8. Trace server package activation order and client entrypoint load order, then
   identify the exact seams needed to make Mari Bridge ready before consumers.

Deliverable: a machine-readable compatibility manifest and tests that fail if
an anchor is absent, duplicated, or has an unexpected fingerprint.

## Phase 1: loader and installed runtime kernel

Build a direct-`--import` proof that:

- registers synchronous module hooks before Marinara imports;
- transforms one harmless server probe and one client-overlay fixture;
- publishes patch status through `Symbol.for("marinara.mari-bridge.v1")`;
- passes through unchanged when disabled or unsupported;
- never mutates reference or `/app` files;
- records exact target hashes and replacement counts.

Implement the runtime kernel:

- API/implementation version and compatibility status;
- subsystem ownership and duplicate-activation rules;
- capability discovery;
- consumer registration and idempotent cleanup;
- bounded/deduplicated warnings and patch diagnostics;
- unavailable, degraded, incompatible, and disabled states.
- bridge-first server activation and client-runtime initialization;
- scoped consumer sessions with required-capability leases;
- fail-before-callback activation and revoke-with-cleanup behavior.

Exit criteria: supported targets patch exactly once; unsupported targets retain
native behavior; duplicate runtime activation is deterministic; cleanup removes
every owned registration; consumers never wait in or deadlock the sequential
package activation loop; a consumer callback cannot run before the bridge is
ready.

## Phase 2: prompt assembly registry

Implement and test:

- named-section suppression;
- atomic suppression-plus-replacement groups;
- explicit role/anchor/history-depth injection;
- deterministic owner/order handling;
- explicit package/chat/lane-scoped last-successful contribution retention and
  clearing;
- `history.beforeProcessing`;
- `main.beforeFit` and `agent.beforeFit`;
- main/agent after-fit observation;
- post-response commit events;
- prompt inspection without default content logging.

Start with Roleplay, then add Visual Novel, Conversation, and Game only after
tracing each path. Raw, dry-run, and agent lanes are explicit.

Fault tests cover throwing callbacks, invalid message arrays, aborts, timeouts,
conflicting suppressions, missing atomic replacement content, token fitting, and
consumer cleanup.

## Phase 3: host and macro services

Implement the server services needed by surviving consumers.

Host access:

- normalized package-owned Fastify injection;
- relative-path and method validation;
- internal request/recursion marker;
- JSON response/error normalization;
- ownership diagnostics;
- public persistence/resource API preference;
- native transaction and chat-lock integration.

Initial operations are chat metadata, message extra, character reads,
connections/models, and raw generation.

Prompt macros:

- adapter to Marinara's native macro resolver;
- tested fallback for universal identity/context macros only;
- package variables and conditional blocks;
- explicit behavior for unknown macros;
- parity fixtures against native prompt rendering.

Presence owns roster reconciliation and scoped message updates in its server
runtime. It uses the bridge host service for native reads and writes and leaves
summaries entirely untouched.

## Phase 4: configured model and generation service

Implement a server/client generation contract that preserves Marinara policy:

- configured Main/Agent connection category selection;
- saved parameter-send behavior;
- Agent-category fallback;
- structured-schema execution;
- raw execution where still required;
- dry-run/streaming execution;
- abort signal propagation;
- run IDs, ownership, and chat association.

Implement lifecycle state:

- native-main versus package-agent classification;
- started, completed, errored, and aborted transitions;
- snapshot query and subscriptions;
- idempotent declaration controllers;
- reference-counted composer lock;
- exact Stop/abort ownership and restoration.

SSE/JSON stream parsing lives in the thin SDK or generation implementation.
Do not add a general `window.fetch` interceptor.

## Phase 5: package-owned bootstrap

Convert processing to `package-build` only after a prepared package emits a
valid manifest and server entrypoint.

Implement:

- stable bootstrap assets under `DATA_DIR/mari-bridge`;
- loader-active and disable probes;
- graceful `app.close()` coordination;
- POSIX Node 24 `execve` argument reconstruction;
- loop prevention and persistent last-failure diagnostics;
- direct `--import` local launcher;
- status/health route.

Prove the safe Fastify scheduling point. Do not close Fastify recursively from
inside an unsafe lifecycle callback. Always flush storage and release the
writer lease before replacement.

Docker verification:

- install plus one normal user restart reaches a patched healthy server;
- internal bootstrap cannot loop;
- SIGTERM reaches the replacement child;
- storage, sidecar, and runtime cleanup complete;
- bootstrap survives container recreation with the same data volume;
- `MARI_BRIDGE_DISABLE=1` starts native Marinara.

## Phase 6: client lifecycle, commands, and native actions

Patch native client call sites and expose external stores/registries for:

- active chat and navigation changes;
- generation snapshots and aborts;
- composer busy/lock state;
- composer submission command routing;
- native composer action invocation.

Command behavior retains deterministic priority, quoted tokens, command
augmentation/ownership, native range collision avoidance, feedback, and
cleanup. It must not use capture-phase document listeners.

Native actions initially cover trigger-character-response and quick-reply
invocation. Consumers receive structured availability/disabled/result states,
not button elements.

The active migration scope prioritizes a native slash-command registry and a
Quick Reply resolver. Both Roleplay `ChatInput` and Conversation
`ConversationInput` must resolve literal `{{input}}` tokens in saved custom
Quick Reply content from the draft that existed immediately before selection.
The resolved text then follows Marinara's normal send path, so registered slash
commands use native parsing, autocomplete, execution, and feedback. Resolution
is a single pass; content without `{{input}}` remains byte-for-byte unchanged.

## Phase 7: native client UI overlay

Build the client overlay atomically with exact fingerprints. Implement the
slots required by active consumers first:

- `chat.settings`;
- `composer.above-input`;

The broader `message.actions`, `composer.quick-actions`, `chat.toolbar`,
`chat.surface`, and `topbar.panels` contracts are deferred until an active
consumer needs them.

Use direct renderer registrations backed by an external store. Do not emulate
old custom elements, `view`, `capabilityProps`, or prop events.

Chat settings support section/card placement, title, description, icon, order,
visibility, and chat/workflow props. Message actions support chat/message/swipe,
role/speaker, generation state, and native refresh helpers.

Tests cover desktop/mobile Roleplay, grouped/ungrouped Conversation, late
registration, chat switching, message edits/swipes/deletes, cleanup, unsupported
client fallback, and zero MutationObservers/full-chat scans in migrated code.

## Phase 8: thin SDK and consumer rewrites

Replace `_mari-bridge` with a thin SDK containing discovery, contract
validation, stable IDs, cleanup aggregation, command range/token parsing,
stream parsing, and small CSS/lifecycle utilities. It contains no host patcher,
DOM slot finder, fetch interceptor, active-chat poller, or generation button
detector.

The SDK must provide matching server/client activation wrappers that:

- resolve the well-known registry internally;
- authenticate/bind the declared consumer identity where practical;
- require an API major and minimum minor version;
- require an explicit capability list;
- verify that the backing patch for each capability succeeded;
- invoke no feature code on failure;
- return only a scoped consumer session;
- aggregate all consumer cleanup;
- expose a revocation `AbortSignal`;
- stop the consumer if required bridge health is lost;
- emit one actionable failure containing the missing runtime, version, patch,
  or capability;
- never poll, retry via DOM, or fall back to old bridge behavior.

Rewrite and verify the active consumers individually:

1. PWA Helper — native generation snapshots/events.
2. World Map Background — native active-chat lifecycle.
3. Better Impersonate — native slash-command registration plus
   `{{input}}` expansion in system-configured custom Quick Replies. Retire the
   custom button runtime after command parity is proven.
4. Group Sort Order — prompt registry, host access, active-chat/generation
   notifications, and native composer UI.
5. Presence — native commands and chat settings, active-chat lifecycle, and host
   access. Presence retains its own roster reconciliation and never handles
   summaries.

Persona Reapply is archived. Memory Core is a WIP and remains outside the
current bridge completion criteria.

Required capability declarations begin with this matrix and are refined against
the traced implementation:

| Consumer | Required bridge capabilities |
| --- | --- |
| PWA Helper | `client.bridge-first`, `generation.lifecycle` |
| World Map Background | `client.bridge-first`, `chat.active` |
| Better Impersonate | `commands`, `commands.draft-write`, `generation.draft`, `quick-replies.input-macro` |
| Group Sort Order | `prompt.inject`, `host.request`, `chat.active`, `generation.lifecycle`, `ui.composer.above-input` |
| Presence | `commands`, `ui.chat-settings`, `chat.active`, `host.request` |

Response Keeper is not rewritten. Remove it from the publishable catalog only
when the user separately authorizes that package/catalog change; this plan does
not delete it.

Because manifests cannot declare dependencies, each rewritten consumer detects
the installed runtime only through the SDK and fails activation when the
runtime, version, patch set, or declared capability set is unavailable. No
consumer falls back to old bridge behavior.

After the last consumer migration, remove obsolete implementation modules from
`_mari-bridge` in a separate, explicitly reviewed cleanup.

## Proposed source layout

The installed runtime and bundled SDK remain separate source roots. Consumer
packages list `_mari-bridge` in `processing.sharedRoots`; they import only its
public `sdk/` entrypoints and never import implementation files from the
installable `mari-bridge` package.

```text
mari-bridge/
  marinara-source.json
  package.json
  README.md
  docs/
  src/
    bootstrap/
      register.mjs
      loader.mjs
      exec.mjs
    patching/
      compatibility.mjs
      server-transforms.mjs
      client-overlay.mjs
    server/
      runtime.mjs
      routes.mjs
      prompt-registry.mjs
      generation-service.mjs
      lifecycle-registry.mjs
      host-service.mjs
      macro-service.mjs
    client/
      runtime.js
      registry.js
      chat-store.js
      generation-store.js
      command-registry.js
      slot-registry.js
    shared/
      contracts.js
      command-parser.js
      stream.js
  patches/
    <engine-fingerprint>/
  scripts/
    build.mjs
    check.mjs
    dev-launch.mjs
  tests/

_mari-bridge/
  sdk/
    server.js             # activateWithMariBridge
    client.js             # activateClientWithMariBridge
    contracts.js          # requirements, sessions, typed failures
    cleanup.js            # idempotent cleanup aggregation
    ranges.js             # pure message-range/token helpers
    stream.js             # pure SSE/JSON stream helpers
  tests/
    activation-gate.test.*
    revocation.test.*
    contracts.test.*
```

Do not create empty placeholders before their first implementation is needed.
The SDK must stay small enough to bundle into every consumer. It contains no
runtime singleton, loader, Engine patch, UI host, persistence owner, polling,
or compatibility fallback; those belong exclusively to installed
`mari-bridge`.

## Verification matrix

| Area | Required verification |
| --- | --- |
| Metadata/runtime | Source/prepared manifest; API versions; ownership; cleanup |
| SDK gate | bridge-first order; missing/incompatible/unhealthy checks; no callback on failure |
| Session revocation | required capability loss aborts and cleans consumer exactly once |
| Loader | Supported/unsupported fingerprints; zero/one/multiple anchors |
| Prompt | Roleplay, Conversation, VN, Game, raw, dry-run, agent separately |
| Prompt phases | Main/agent isolation; suppression atomicity; token fit |
| Host access | path/method validation; recursion guard; transactions; JSON errors |
| Macros | parity fixtures; variables; conditionals; unknown macro behavior |
| Summaries | create/generate/edit/toggle/delete; audiences; missed-event recovery |
| Rosters | ordered add/remove; bulk backfill; idempotency |
| Model execution | saved parameters; Agent selection/fallback; schema; abort |
| Generation lifecycle | native/package states; lock reference counts; Stop ownership |
| Commands | priority; augmentation; quoted tokens; native range collisions |
| Chat lifecycle | navigation/chat switches without polling or history monkeypatches |
| Native actions | availability, disabled, invoke, completion, failure |
| UI slots | every retained slot; desktop/mobile; late load; cleanup |
| Shutdown | DB flush, writer lease release, sidecar/runtime cleanup |
| Docker | install/restart, cold restart, volume recreation, disable recovery |
| Local | direct preload launcher, server fixtures, client overlay fixture |
| Consumer migrations | focused checks for PWA Helper, World Map Background, Better Impersonate, Group Sort Order, and Presence |
| Security | path validation, no shell invocation, diagnostics redaction |

## Open decisions

1. Live POSIX/Docker evidence for the implemented first-start `execve` bounce,
   loop guard, disable recovery, and repeated container restarts.
2. Dependency/install UX until the manifest schema supports dependencies.
3. Supported Engine build/version policy and patch maintenance cadence.
4. Exact native tracker field/stat APIs and transaction boundaries.
5. Prompt inspection integration with native dry-run versus a bridge route.
6. Exact boundary between native macro resolver access and the SDK fallback.
7. Exact React seams for the retained chat settings, message actions, composer,
   chat toolbar/surface, and topbar registries.

## Conditions before publication

- `processing.kind` is a reproducible `package-build` path.
- Server/client entrypoints and prepared manifest validate.
- At least one Engine build is fully fingerprinted.
- Runtime, prompt, host, macro, model, lifecycle, command, and slot contracts
  pass focused tests.
- Docker/local bootstrap and recovery paths pass.
- No reference or generated catalog file is hand-edited.
- Consumer dependency UX is explicit.
- `_mari-bridge` SDK fail-closed checks and bridge-first activation tests pass.
- A migration branch exists for at least one simple surviving consumer.
- Response Keeper remains explicitly excluded rather than accidentally broken
  by a partial compatibility promise.
