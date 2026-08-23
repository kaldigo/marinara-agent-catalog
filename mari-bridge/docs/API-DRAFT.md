# API Draft

These names are provisional. The important part is the separation between
suppression, injection, message transformation, and observation.

This document is subordinate to the native-first package policy in
`packages/AGENTS.md`. An API is justified only when an active package cannot use
an existing Marinara agent, setting, store, action, or UI surface directly. It
must expose the smallest missing native seam; it must not become a parallel
settings, generation, persistence, or rendering framework.

## Server discovery

Consumer server entrypoints use the `_mari-bridge` SDK. They do not read the
global registry directly:

```js
import { activateWithMariBridge } from "../../../_mari-bridge/sdk/server.js";

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "presence",
      api: { major: 1, minMinor: 0 },
      require: ["consumer.sessions", "host.request", "runtime.health"],
    },
    async (session) => activatePresence(session, context),
  );
}
```

The capability activation context can register a service, but its runtime host
does not currently expose the Engine's internal service-registry getter to
consumer packages. Mari Bridge may also call `registerService` for patched
Engine consumers and diagnostics, but packages must not import private Engine
paths to retrieve it.

Internally the SDK resolves `Symbol.for("marinara.mari-bridge.v1")`, validates
runtime identity, and requests a scoped consumer session. Missing or unhealthy
bridge state throws a typed activation error before the feature callback runs.
The package runtime can then report a clear activation failure rather than
leaving partially registered behavior.

Every registration returns an idempotent cleanup function and records the
owning package ID.

Client packages use the corresponding SDK entrypoint:

```ts
import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";

activateClientWithMariBridge(
  {
    consumerId: "presence",
    api: { major: 1, minMinor: 1 },
    require: [
      "chat.active",
      "client.bridge-first",
      "commands",
      "consumer.sessions",
      "runtime.health",
      "ui.agent-settings",
    ],
  },
  (session) => mountPresenceClient(session),
);
```

If the client bridge is not already ready, the callback does not run. There is
no polling, DOM fallback, or late self-activation by the consumer.

The common requirement and failure contracts should resemble:

```ts
interface BridgeRequirements {
  consumerId: string;
  api: { major: number; minMinor: number };
  require: readonly string[];
}

type BridgeUnavailableReason =
  | "missing"
  | "disabled"
  | "starting"
  | "incompatible-api"
  | "patch-failed"
  | "capability-missing"
  | "unhealthy";

class MariBridgeUnavailableError extends Error {
  reason: BridgeUnavailableReason;
  consumerId: string;
  missingCapabilities: readonly string[];
  failedPatches: readonly string[];
}
```

Both wrappers use the same requirement validation and error taxonomy. The
server wrapper rejects package activation; the client wrapper reports the
disabled reason through the bridge/package diagnostics surface without
mounting the consumer. Neither wrapper calls consumer code speculatively.

The runtime registry also exposes:

```ts
interface BridgeRuntime {
  apiVersion: { major: number; minor: number };
  implementationVersion: string;
  status: "ready" | "degraded" | "incompatible" | "disabled";
  capabilities: ReadonlySet<string>;
  patches: ReadonlyArray<PatchStatus>;
  registerConsumer(input: ConsumerRegistration): ConsumerSession;
}
```

`registerConsumer` should return a scoped `ConsumerSession`, not the unrestricted
root registry. It includes only validated APIs/capabilities, an abort signal for
revocation, cleanup registration, and current health. The session is bound to
the declared consumer/package identity.

Only one injected runtime owns each subsystem. Duplicate initialization with
the same implementation is idempotent; an incompatible duplicate fails explicitly.
The old bundled-copy "newest wins" behavior is not a public compatibility API,
because all consumers will be rewritten, but ownership and version negotiation
remain required for safe activation and package updates.

## Request scope

Every prompt callback receives a frozen scope resembling:

```ts
interface PromptScope {
  requestId: string;
  workflow: "roleplay" | "conversation" | "visual-novel" | "game";
  lane: "main" | "agent" | "dry-run" | "raw";
  chatId: string | null;
  characterIds: readonly string[];
  activeCharacterId: string | null;
  sourceMessageId: string | null;
  regeneration: boolean;
  continuation: boolean;
  signal: AbortSignal;
}
```

Callbacks can narrow their own chat-level toggle state. The bridge should not
invent global enablement semantics for every consumer.

## Named-section suppression

Suppression controls whether native prompt sections are assembled. It must be
structural; consumer packages should not delete arbitrary matching strings from
the final prompt.

```ts
bridge.prompt.suppress({
  id: "example-package:replace-native-tracker",
  section: "tracker.context",
  lanes: ["main"],
  workflows: ["roleplay", "visual-novel"],
  priority: 100,
  when(scope) {
    return isEnabledForChat(scope.chatId);
  },
});
```

Initial section IDs to trace and expose:

- `tracker.context`
- `summary.context`
- `lorebook.before`
- `lorebook.after`
- `persona.description`
- `character.description`
- `character.personality`
- `scenario`
- `dialogue.examples`
- `history`
- `capability.context`

Only sections required by a real consumer should be patched. Others should not
be patched speculatively.

Conflict policy:

- any active suppression suppresses the native section;
- diagnostics list every owner that voted to suppress;
- a consumer cannot unsuppress a section suppressed by another owner;
- required replacement injection may declare an atomic group so suppression is
  cancelled if its replacement cannot be built.

## Explicit-depth injection

```ts
bridge.prompt.inject({
  id: "example-package:replacement-context",
  lanes: ["main"],
  workflows: ["roleplay", "visual-novel"],
  role: "system",
  placement: { kind: "history-depth", depth: 4, side: "before" },
  order: 200,
  retention: "last-successful-per-chat",
  async build(scope) {
    return renderInternalStateContext(scope.chatId);
  },
});
```

Supported placement should distinguish:

- named anchors (`before`/`after` a native section);
- history depth, counted from the newest message with a documented zero point;
- beginning/end of the assembled system region;
- immediately before the final user turn.

Contributions include role, content, cache hint, stable ID, owner, order, and an
optional token budget. Empty content is omitted. Ordering is deterministic:
placement, numeric order, owner package ID, registration ID.

Retention is explicit. `none` recomputes or omits on every request;
`last-successful-per-chat` preserves the last successful non-empty contribution
when a resolver returns `undefined`, matching the useful behavior of the old
prompt-contribution bridge. Returning `null`, disabling the registration, or
calling the package-scoped clear API removes the retained value. Retained values
are isolated by owner, registration, chat, and lane.

The bridge must define what happens when requested depth exceeds available
history. The proposed behavior is clamping to the oldest available history
boundary and reporting the clamp in diagnostics.

## Message transforms

Message transforms modify message text or metadata at explicit stages:

```ts
bridge.prompt.transformMessages({
  id: "example-package:strip-legacy-markup",
  phase: "history.beforeProcessing",
  lanes: ["main"],
  order: 100,
  transform(messages, scope) {
    return messages.map(stripLegacyInternalStateMarkup);
  },
});
```

Required first phases:

- `history.beforeProcessing`: raw stored history before Marinara applies its
  prompt-facing processing.
- `main.beforeFit`: assembled main-model messages before token fitting.
- `agent.beforeProcessing`: raw history entering an agent task.
- `agent.beforeFit`: assembled agent messages before token fitting.

Observation-only phases:

- `main.afterFit`
- `agent.afterFit`
- `response.afterCommit`

Mutation after token fitting should be disallowed initially because it can
invalidate the token budget.

Transforms must preserve message IDs and roles unless their registration
explicitly requests and is allowed to change them. Each phase should validate
the returned shape and isolate a failing optional transform. Atomic transform
groups fail as a unit.

## Prompt inspection

The bridge needs a dry-run/inspection API that reports:

- native sections present or suppressed;
- contribution owner, placement, role, order, and token estimate;
- message-transform counts and changed message IDs;
- final ordering before and after token fit;
- patch target/fingerprint status.

Inspection must be opt-in and must not log prompt contents by default.

## Post-response jobs

The first consumer needs an event registration resembling:

```ts
bridge.lifecycle.afterAssistantCommit({
  id: "example-package:post-response-job",
  workflows: ["roleplay", "visual-novel"],
  enqueue(event) {
    return stateQueue.enqueue(event);
  },
});
```

The event must identify chat, assistant message, active swipe/version, generation
type, preceding user message, and whether the response replaced an earlier
active result.

This hook should enqueue work and return quickly. It must not delay the main
response reaching the user.

## Host access and persistence

Surviving packages currently use `app.inject()` when the public persistence or
resource host lacks a required write. The bridge should expose a normalized,
package-owned host request service rather than making every consumer rebuild
that adapter:

```ts
await bridge.host.request({
  owner: "presence",
  method: "PATCH",
  path: `/api/chats/${chatId}/messages/${messageId}/extra`,
  body: patch,
});
```

The service must:

- use Fastify injection, never loop over the external network;
- add a bridge-internal request marker to prevent prompt/request recursion;
- normalize JSON responses and errors;
- validate method/path and reject absolute URLs;
- record the owning package in diagnostics;
- prefer public persistence/resource methods where they cover the operation;
- support transactions/chat locks through the native capability persistence
  host when possible.

Required first operations include chat metadata, message extra, summary
entries, connection/model reads, and package-owned Long-Term Memory records.

## Prompt macro resolution

Consumer-authored prompts need the same identity and chat context across
packages. Expose:

```ts
const context = await bridge.prompts.buildMacroContext({ chatId, model });
const rendered = await bridge.prompts.renderMacros(template, context);
```

The preferred implementation patches or calls Marinara's native macro resolver
so behavior matches ordinary prompts. The retained minimum set includes user,
character/group identities, latest input, model, persona/character fields,
package variables, conditionals, and date/time. Unknown macros should remain
visible unless the native resolver defines different behavior; never silently
delete arbitrary tokens.

The injected preset context currently adds three native-style read macros:

- `{{active-agents}}` resolves to the comma-separated active agent IDs;
- `{{group_scenario_override}}` resolves to the trimmed shared group scenario
  or an empty string;
- `{{group_mode}}` resolves to exactly `SOLO`, `MERGED`, or `INDIVIDUAL`, using
  the full chat roster to distinguish a group from a solo chat.

They must remain usable anywhere a native read macro is usable, including bare
conditional operands, comparisons and `contains`, variable write values,
nested character fields, and bracketed per-character expansion.

## Native generation lifecycle

Normal prompt agents must use Marinara's native agent runner. Commands that are
variants of an existing native workflow must invoke that workflow rather than
reconstructing its request, connection, model, streaming, or abort handling.

The bridge exposes lifecycle observation and ownership only where a package
needs a signal Marinara does not publish:

```ts
bridgeSession.generation.subscribe(listener);
bridgeSession.generation.getSnapshot();
```

Snapshots distinguish native main generation from bridge-owned draft work and
report started, completed, errored, and aborted states. The bridge's patched
native adapter owns lifecycle declarations and abort controllers; ordinary
consumers observe only the scoped session surface. Native generation tracking
uses patched stores/call sites rather than Stop-button DOM detection.

Composer locking is reference-counted by chat/run. The native send control
becomes a Stop action only when the owning run is abortable, and cleanup restores
the exact native state.

SSE parsing and JSON-stream helpers remain private to the narrow native draft
adapter used by Better Impersonate. They are not a general package generation
API. The old fetch-interceptor pipeline is not retained.

## Chat and host lifecycle

Replace active-chat polling with events from exact native call sites:

```ts
bridgeSession.chat.active.getSnapshot();
bridgeSession.chat.active.subscribe(listener);
bridgeSession.chat.background.set({ chatId, url, blurPx });
bridgeSession.lifecycle.register(listener);
```

Chat events include the active chat ID and workflow. Host lifecycle events are
added only for an active consumer and carry structured native state. Presence
uses these events for roster/message reconciliation and writes Marinara's native
message visibility fields. Presence does not observe or alter summaries.

`chat.background` is active-chat scoped. Mari Bridge binds Marinara's existing
Roleplay background store at its native selector, and `set` delegates to the
store's native `setChatBackground` action after the consumer has persisted its
metadata. It returns `false` for a non-active chat or before the native store is
available. The Bridge retains only the live blur associated with that owner and
URL; it does not render a second background, persist metadata, or introduce a
parallel background cache.

## Slash commands and native composer actions

Slash commands become a native composer registry rather than capture-phase DOM
listeners:

```ts
bridgeSession.commands.register({
  id: "presence",
  commands: ["/presence"],
  description: "Show or update character presence for this chat",
  usage: "/presence [status or character]",
  handler({ raw, context }) {},
});
```

The registry retains quoted tokenization, deterministic priority, ownership
checks, native command/range collision avoidance, chat context, feedback, and
cleanup. Message-range parsing remains a thin SDK utility.

Roleplay command contexts expose `setDraft(text)` when the consumer requires
`commands.draft-write`. Long-running draft work uses
`bridgeSession.drafts.generate({ chatId, body, onUpdate })`; the bridge owns the
stream independently of the mounted chat surface, while `setDraft` commits each
update through Marinara's native per-chat draft store. Consumers stop their own
run with `bridgeSession.drafts.abort(chatId)`.

Draft requests use Marinara's native request fields. `generationGuide` carries
guidance without replacing the impersonation prompt. An impersonation draft may
send `impersonateContinuation` to place an existing draft in the provider's
assistant-prefill position; the dry-run result then includes the generated
`continuation` separately. Non-impersonation dry runs may opt into reasoning
with `includeReasoning: true`, producing `thinking` stream events and a final
`reasoning` value. Impersonation runs always suppress reasoning exposure.

The compatibility return remains the generated string. Callers that need the
structured fields may set `returnDetails: true`; `output: "continuation"`
selects the continuation for ordinary string updates and return values.

## Client registration

Implemented native extension slots:

- `agent.settings`
- `composer.above-input`
- `tracker.section`
- `roleplay.hud`

Each slot is mounted at an exact native render site and exists because an active
consumer needs a field or surface Marinara does not expose. Future slots are not
added speculatively.

Example registration:

```ts
bridgeSession.ui.register({
  id: "example-package:agent-field",
  slot: "agent.settings",
  agentId: "example-package",
  view: "agent-field",
});
```

`agent.settings` is for package-specific fields inside an existing native agent
card. Marinara still renders and saves the standard agent settings, prompt
templates, connection/model, tools, and enablement. A consumer may not use this
slot to replace the whole card.

`tracker.section` and `roleplay.hud` extend native tracker surfaces. A tracker
section registration supplies its title, icon key, owning agent IDs, placement,
rerun agent ID, and body view. Mari Bridge renders the native section shell,
header, collapse control, active-agent gating, edit-mode props, and rerun action;
the consumer must not render a second section header or panel shell. Their
interactions must follow the closest native behavior: inline editing, explicit
add/remove/lock modes where applicable, responsive clamped portals, and no
browser alert/prompt/confirm workflow. `composer.above-input` is reserved for a
real control that cannot be expressed as a native command or existing composer
action.

Patched React mounts own host creation and destruction. Consumer cleanup only
unmounts its renderer. No MutationObserver, repeated full-chat scan, or selector
probing belongs in the new native-slot path.

The patched host creates deterministic `marinara-capability-*` elements and
delivers scoped `capabilityProps` through the
`marinara-capability-props` event. This is bridge-owned transport at an exact
native mount site, not consumer-side DOM discovery.

### Agent Suite tracker data

`agent-suite.tracker-data` extends the existing native Agent Suite tracker-slice
registry. A consumer registers an agent ID, label, description, `getValue`
reader, and merge-safe `buildPatch` function. Mari Bridge resolves that slice at
the native lookup sites; Agent Suite continues to own loading, JSON editing,
Save/Reset, dirty-state protection, AI Edit, GameState refresh, and the native
manual PATCH request. Consumers must preserve unrelated GameState fields and
package namespaces in their patch builder and must not render a second editor.

## Dependency state

The current manifest schema has no package dependency field. Until Marinara
supports one, consumer packages should:

1. call the mandatory `_mari-bridge` SDK activation wrapper;
2. declare API version plus every required server/client capability;
3. perform no feature activation if the check fails;
4. surface a direct installation/health requirement in package status/logs;
5. stop and clean up if a required capability is revoked;
6. never fall back to old prompt, DOM, event, or fetch behavior.

No old-bridge fallback is permitted. Each migrated
consumer either holds a healthy SDK session for all declared requirements or
does not run.

The catalog may document the dependency, but it cannot currently enforce or
auto-install it through the package manifest.
