# Architecture

## Design principles

Mari Bridge is a narrow adapter around verified Marinara seams, not a fork of
the Engine. The package owns reusable registries and missing native extension
points. Consumer packages own only their feature-specific prompts, schemas,
logic, and state; native Marinara remains the owner of standard agents,
settings, generation, persistence, and UI behavior.

Patches must be:

- structural rather than broad text replacement where possible;
- restricted to known Engine versions and target fingerprints;
- count-checked so a missing or duplicate anchor fails closed;
- visible in diagnostics and prompt inspection;
- reversible by starting Marinara without the bridge loader;
- scoped separately for Roleplay, Conversation, Visual Novel, and Game Mode;
- free of package-owned MutationObservers for native UI integration.

## Integration decision order

Every consumer change follows the same order:

1. Reuse the native API, component, store, route, or workflow unchanged.
2. If it is not publicly reachable, patch the smallest verified call site and
   expose a package-neutral bridge capability.
3. Implement package-specific behavior only when there is no native owner.

The bridge must not become a second application layer. In particular, it does
not own replacement agent editors, connection/model resolution, generation
pipelines, dry-run behavior, Stop controls, or generic tracker CRUD. A bridge
host may mount missing feature content inside a native surface, but the content
must follow that surface's native interaction contract.

## Runtime layers

### 1. Early server loader

A Node preload stored under the persistent data directory registers synchronous
module load hooks before Marinara's entrypoint is imported. It transforms only
known server modules and inserts calls to a global bridge adapter.

The registry identity should use a versioned global symbol rather than a string
property:

```js
const PROMPT_CONTROL = Symbol.for("marinara.prompt-control.v1");
```

Patched Engine code calls a small, synchronous adapter. The preload constructs
the registry before importing Engine code; consumer packages only add their
scoped contributions later. If the registry is absent, every adapter call must
return the unchanged native value.

The loader is the patch mechanism. The bootstrap bounce described in
`BOOTSTRAP.md` is only a way to ensure the loader runs early enough without
requiring Docker configuration.

### 2. Installer package

The normal `server.mjs` capability entrypoint only:

- materializes the stable loader and its runtime modules under
  `DATA_DIR/mari-bridge/`;
- coordinates a guarded version handoff when the loader is missing or changed;
- verifies that the installed files exist;
- otherwise performs no runtime, route, prompt, UI, SDK, or consumer work.

The injected preload owns the versioned server registry, scoped sessions,
prompt/result/tracker hooks, host binding, client overlay preparation, and
client registry. Those facilities remain available independently of installer
package activation order.

### 3. Client overlay and native registry

Mari Bridge has no client package entrypoint. A version-specific client overlay
patches small native call sites so they render bridge slots, and makes the
client runtime a static dependency of Marinara's main entry module.

Consumer client modules register contributions with a versioned external
store. Patched React components create bridge-owned hosts at exact native call
sites. The current transport mounts deterministic
`marinara-capability-<package>` elements and supplies scoped capability props;
the host/store publishes late registrations without DOM discovery. Consumers
must not search for those native call sites themselves.

The client overlay also patches stable native lifecycle call sites for active
chat/navigation changes, generation state and aborts,
composer submission/commands, composer locking, and supported native composer
actions. These use the same external-store/registry model as UI slots.

The production overlay should be prepared under `DATA_DIR/mari-bridge/client/`
from the readable host client build. The original `/app` build remains
untouched. The server patch selects the verified overlay as the static client
root. Unknown or failed client fingerprints fall back to the original client.

Patching minified browser chunks is the highest-risk part of this design. Each
supported Engine build needs exact input hashes, expected replacement counts,
and a browser smoke test. If source maps or stable emitted anchors are absent,
the patch definitions must be version-specific rather than heuristic.

### 4. Thin consumer SDK

The build-time `_mari-bridge` SDK is the mandatory integration surface for all
consumer packages. It exposes:

- discovery of the installed bridge service and client registry without
  exposing global-symbol details to consumers;
- server/client readiness, API-version, patch, and required-capability checks;
- scoped consumer sessions that are revoked if required bridge health is lost;
- typed/validated registration helpers;
- stable phase, section, and slot identifiers;
- command tokenization and message-range parsing;
- SSE/JSON stream parsing used by retained generation paths;
- cleanup aggregation;
- a clear disabled-state result when the runtime is missing or incompatible;
- no second copy of the host patcher.

The current capability activation context can register a host service but does
not expose the Engine's internal `getCapabilityService` function to another
package. Consumer-to-bridge discovery should therefore use the versioned global
registry installed by the preload/runtime. `registerService` remains useful for
patched Engine call sites and host diagnostics; it is not the consumer lookup
API unless Marinara later exposes one.

Consumer source does not perform that global lookup directly. The SDK performs
it and returns a scoped session only after all declared requirements pass. The
session aggregates registrations and feature cleanup. A failed initial check
runs no feature callback; later loss of a required capability revokes the
session and runs cleanup once.

Migration is package-by-package, but each surviving consumer is rewritten for
the new API. The injected runtime's scoped capability elements are an explicit
native-slot transport, not compatibility with the old DOM-slot finder. The
runtime does not restore DOM observers, global generation events, button
probing, or fetch interceptors. Migrated packages have no old-bridge fallback.

Response Keeper is not migrated. Its general fetch interception pipeline is
intentionally omitted; retained request/prompt behavior attaches at explicit
native patched call sites.

## Activation ordering and health gating

The early loader must make activation order deterministic:

```text
preload kernel and patch registry
  -> verify required Engine patches
  -> prepare the verified client overlay
  -> create and mark the injected server registry ready
  -> bind it to the native Fastify host
  -> activate consumer server packages through SDK checks

patched Marinara client main module
  -> evaluate its mari-bridge runtime dependency first
  -> initialize the injected mari-bridge client registry/store
  -> mark client registry ready
  -> load consumer client entrypoints through SDK checks
```

Waiting inside an arbitrarily ordered sequential package activation loop is not
acceptable. The server registry exists before that loop and is bound at its
verified host call site; the installer package is not involved. On the client,
the overlay makes the complete bridge runtime a static dependency of Marinara's
fingerprinted main module, so dependency evaluation finishes before native
capability loading can begin.

Health is capability-specific. A client UI patch failure does not necessarily
disable a server-only consumer, but any consumer requiring that UI capability
stays stopped. No consumer may enter a partially active state while one of its
declared required capabilities is unavailable.

## Client and generation lifecycle

The target client flow is:

```text
native navigation/store change
  -> patched bridge adapter publishes typed chat/roster/summary event
  -> bridge external store updates
  -> package subscriptions and native slot hosts rerender

native or package generation starts
  -> bridge run declaration/snapshot update
  -> optional reference-counted composer lock
  -> streamed or structured model execution
  -> complete/error/abort snapshot
  -> exact lock cleanup and subscriber notification
```

Native main and package Agent work are distinct kinds. Prompt hooks, generation
events, and UI busy state must not infer one from another. The bridge model
executor resolves saved parameters and Agent-category fallback through native
server logic rather than reconstructing connection policy in each package.

## Commands and native actions

Composer submission is patched before native dispatch. The command registry
performs deterministic matching, ownership checks, quoted tokenization, and
native-command/range collision avoidance. It returns an explicit handled result
to the patched composer instead of cancelling DOM keyboard/form events.

Native composer actions are invoked through stable action IDs and typed options.
The bridge adapter calls the underlying React/store action; consumers do not
find or click buttons.

## Host and feature lifecycle services

The bridge host service normalizes package-owned Fastify injection only when
public capability persistence/resources do not cover a required operation. It marks
internal requests to avoid recursion, validates relative API paths, and prefers
native persistence transactions/chat locks where available.

Consumers use public/native routes directly when those routes already express
the operation. They must not create package routes that merely proxy native
chat, GameState, agent, or message APIs.

Presence owns roster reconciliation and scoped message updates. It uses the
bridge host service for native requests and leaves summaries untouched. Prompt
macro rendering should delegate to Marinara's native resolver, with only a
tested minimal fallback in the SDK.

## Server prompt flow

The target flow for a main generation is:

```text
native request
  -> native messages/history collected
  -> history.beforeProcessing transforms
  -> native history processing
  -> named native sections assembled, with suppression decisions
  -> bridge contributions inserted by anchor/depth/order
  -> main.beforeFit transforms
  -> native token fitting/truncation
  -> main.afterFit inspection (mutation discouraged)
  -> provider request
```

Agent calls use parallel agent-specific phases. A consumer should not
accidentally alter both the main model and a post-response state agent merely
because they share an internal helper.

All transformations return values. Patched Engine code must not expose mutable
internal arrays to arbitrary packages when an immutable replacement contract is
practical.

## Separate post-response project pattern

This pattern is retained as reference for a separate future project and is not
part of the Mari Bridge foundation completion scope. A future consumer may add
a package-owned job after an assistant response is committed:

```text
assistant response committed
  -> enqueue state job for (chatId, assistantMessageId, swipe/version)
  -> build agent input from chat history + current structured state view
  -> one agent call for all enabled state modules
  -> validate strict structured result
  -> compare source revision / discard stale result
  -> apply tracker and custom-store mutations transactionally
  -> publish state-updated client event
```

The main response is never required to emit internal-state HTML. GFX/state
markup needed by the state agent is rendered from stored data into that agent's
private prompt.

Jobs must be serialized per chat. Edits, deletions, regenerations, and swipe
changes require stable source identifiers and idempotency keys. A late result
must not overwrite state derived from a newer active response.

## Persistence

Bridge-owned infrastructure belongs below a stable directory such as:

```text
DATA_DIR/mari-bridge/
  bootstrap/
    register.mjs
    loader.mjs
  client/
    <engine-fingerprint>/
  compatibility/
    supported-builds.json
  diagnostics/
  state.json
```

Installed package files continue to live in Marinara's own
`DATA_DIR/capability-packages` layout. Runtime snapshots are temporary and must
not be used as the stable preload path.

Feature data should use the existing native owner first: message extra, chat
metadata, GameState, agent settings, or character tracker fields/stats. Only
genuinely package-specific data belongs in a package namespace. It never belongs
in the bridge infrastructure directory.

Prompt guidance is not automatically a persistence invariant. A prompt may ask
an agent to prefer a bounded working set without deterministic code truncating
stored data. Code-level caps require an explicit product rule. Stored locks must
also be enforced by result application, not only displayed in UI.

## Compatibility and failure behavior

Compatibility is a two-stage gate:

1. Manifest Engine range prevents obviously incompatible installation.
2. Runtime fingerprints verify every patched server and client target.

Supported-build metadata should record:

- Engine semantic version and, where available, build commit;
- path or logical target name;
- whole-file or normalized-region hash;
- expected anchor/replacement count;
- patch implementation version;
- verification fixture version.

Failure rules:

- Never partially enable prompt suppression when required injection patches
  failed.
- Never serve a partially patched client overlay.
- Preserve native behavior and mark the bridge unavailable.
- Surface the exact failed target in logs and the package status UI.
- Consumer packages must see an explicit unavailable/incompatible result.
- Consumer SDK sessions requiring a failed subsystem are never created or are
  revoked with cleanup if the subsystem fails later.

## Security boundary

Capability server packages already execute trusted Node code in the Marinara
process. Mari Bridge does not create a security sandbox. It does increase the
blast radius of a bug, so registrations need ownership, deterministic ordering,
timeouts for asynchronous contribution builders, schema validation, and
cleanup tied to package activation.

Prompt diagnostics must redact connection secrets and avoid persisting full
private chats unless the user explicitly exports a snapshot.
