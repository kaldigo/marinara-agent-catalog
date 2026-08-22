# Architecture

## Design principles

Mari Bridge is a narrow adapter around verified Marinara seams, not a fork of
the Engine. The package owns reusable registries; consumer packages own feature
prompts, schemas, storage decisions, and UI.

Patches must be:

- structural rather than broad text replacement where possible;
- restricted to known Engine versions and target fingerprints;
- count-checked so a missing or duplicate anchor fails closed;
- visible in diagnostics and prompt inspection;
- reversible by starting Marinara without the bridge loader;
- scoped separately for Roleplay, Conversation, Visual Novel, and Game Mode;
- free of package-owned MutationObservers for native UI integration.

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

Patched Engine code calls a small, synchronous adapter. The installed package
later populates the registry with registered consumer contributions. If the
registry is absent, every adapter call must return the unchanged native value.

The loader is the patch mechanism. The bootstrap bounce described in
`BOOTSTRAP.md` is only a way to ensure the loader runs early enough without
requiring Docker configuration.

### 2. Installed server runtime

The normal `server.mjs` capability entrypoint should:

- materialize the stable loader and overlay assets under
  `DATA_DIR/mari-bridge/`;
- expose a versioned service such as `mari-bridge:v1` through
  `registerService`;
- publish the consumer-facing bridge registry through a versioned global symbol
  in the shared Node realm;
- register package routes for status, diagnostics, prompt previews, and
  consumer configuration;
- accept consumer prompt, lifecycle, command, UI, and generation
  registrations;
- provide normalized host-route/persistence access, native prompt macro
  resolution, and configured Agent-category model execution;
- report target fingerprints and patch results;
- coordinate a guarded bootstrap when the loader was not active early enough;
- leave bootstrap assets in place during the one-shot graceful restart.

Normal runtime cleanup must unregister services, routes, callbacks, timers, and
client registrations. It must not delete persistent bootstrap files during an
internal bootstrap restart.

### 3. Client overlay and native registry

The existing client capability loader can load the Mari Bridge client
entrypoint, but it cannot create mount points that the native React tree does
not contain. A version-specific client overlay therefore patches small native
call sites so they render bridge slots.

Consumer client modules register renderers with a versioned external store.
Patched React components subscribe to that store (for example through
`useSyncExternalStore`) and render bridge-owned native hosts using direct props.
Late package activation must cause a normal React update; it must not require a
DOM scan.

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
the new API. The installed runtime does not emulate old custom elements,
`capabilityProps` events, DOM observers, global generation events, or fetch
interceptors. Unmigrated packages may continue bundling the old shared root
during development, but migrated packages have no old-bridge fallback.

Response Keeper is not migrated. Its general fetch interception pipeline is
intentionally omitted; retained request/prompt behavior attaches at explicit
native patched call sites.

## Activation ordering and health gating

The early loader must make activation order deterministic:

```text
preload kernel and patch registry
  -> verify required Engine patches
  -> activate installed mari-bridge server runtime first
  -> mark server registry ready
  -> activate consumer server packages through SDK checks

patched client bootstrap
  -> initialize mari-bridge client registry/store first
  -> mark client registry ready
  -> load consumer client entrypoints through SDK checks
```

Waiting inside an arbitrarily ordered sequential package activation loop is not
acceptable; it could deadlock when a consumer is encountered before Mari
Bridge. The loader/client overlay must either reorder activation explicitly or
initialize the complete required bridge kernel before consumer activation.

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

The bridge host service normalizes package-owned Fastify injection when public
capability persistence/resources do not cover a required operation. It marks
internal requests to avoid recursion, validates relative API paths, and prefers
native persistence transactions/chat locks where available.

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

## Post-response package job flow

A future consumer may add a separate package-owned job after an assistant
response is committed:

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

Feature data should stay with the feature package or native tracker, not in the
bridge infrastructure directory.

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
