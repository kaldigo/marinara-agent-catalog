# Investigation Record

This record captures the upstream behavior inspected before creating the
package notes. Reference checkouts are read-only and remain the source of truth.

## Package installation and activation

Relevant Engine sources:

- `packages/server/src/services/capability-packages/package-manager.service.ts`
- `packages/server/src/services/capability-packages/capability-module-runtime.service.ts`
- `packages/server/src/services/capability-packages/capability-prompt-context.service.ts`
- `packages/server/src/services/capability-packages/capability-route-registration.service.ts`

Findings:

- Installed packages are rooted at `DATA_DIR/capability-packages`.
- Server entrypoints are copied into verified runtime snapshots under
  `DATA_DIR/capability-runtime-snapshots` before import.
- The activation context provides the Fastify app, resolved `dataDir`, installed
  package metadata, runtime host, service registration, prompt-context
  registration, privileged routes, persistence, resources, language models,
  and other capability APIs.
- Server package code executes in the Marinara Node process. It is trusted code,
  not an isolation boundary.
- `restartRequired: true` packages are installed with restart-required status
  rather than activated immediately. They activate during the next startup.
- Route permissions require restart semantics.
- Public `registerPromptContext` is permission-gated and additive. Its result is
  collected as prompt contribution text; it is not a general assembly hook.
- Packages can register a host service, but the activation runtime host does
  not expose the Engine's private service-registry getter to other packages.
  Cross-package bridge discovery therefore needs a shared global registry (or a
  future public host lookup API), not an import of private Engine internals.

## Startup and shutdown ordering

Relevant Engine sources:

- `packages/server/src/index.ts`
- `packages/server/src/app.ts`
- `packages/server/src/db/file-backed-store.ts`
- `packages/server/src/routes/updates.routes.ts`

Observed order:

1. `index.ts` statically imports `buildApp` and its dependency graph.
2. `buildApp()` creates Fastify and opens/decorates the database.
3. An `onClose` hook is registered to stop runtimes/sidecars and call
   `closeDB()`.
4. Core routes are registered.
5. `capabilityModuleRuntime.start(app)` activates trusted downloaded packages.
6. Remaining services/static client setup complete.
7. `index.ts` starts the environment watcher and calls `app.listen()`.

Prompt route modules are therefore imported and their closures created before
ordinary package activation.

Marinara's file-backed store owns a writer lease and buffered/debounced writes.
The update route explicitly documents that a bare process exit can lose writes;
it calls `app.close()` to flush storage and release the writer lease. Any
self-bootstrap must follow the same graceful path before process replacement.

## Docker runtime

Relevant Engine sources:

- `Dockerfile`
- `scripts/docker-entrypoint.mjs`
- `docker-compose.yml`

Findings:

- The official production image currently uses Node 24.
- `/app/data` is the declared persistent volume and `DATA_DIR`.
- Application and built client files live under `/app` in the image.
- The entrypoint starts as root, repairs data-directory ownership, drops to the
  configured runtime user (normally `node`), and spawns the Marinara command as
  a child with inherited stdio/environment.
- The parent forwards termination signals and exits with the child result.
- A POSIX `execve` inside the Marinara child preserves the parent/child PID
  relationship while replacing the child image.
- Runtime package code should not rely on writing `/app`; such edits would also
  be lost when the container image is replaced.

## Prompt assembly limitations

Relevant sources include:

- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/routes/generate/raw-route.ts`
- `packages/server/src/routes/generate/dry-run-route.ts`
- `packages/server/src/services/prompt/*`
- Roleplay/Game generation helpers referenced from those routes.

Findings:

- Prompt behavior is spread across distinct Roleplay, Conversation, Visual
  Novel, Game, raw, dry-run, and agent workflows.
- Existing capability context is appended through defined host collection
  points.
- There is no public package contract for named-section suppression.
- There is no public package contract for mutation/filtering of stored history
  before prompt processing.
- There is no public arbitrary-depth/anchor contribution contract.
- A bridge cannot assume a patch in one Roleplay path automatically covers Game
  Mode or agent calls.

The initial server patch inventory must trace concrete call sites for each
supported workflow and add tests per path. Do not begin with a global final
string regex.

## Client capability surfaces

Relevant Engine sources:

- `packages/client/src/components/capabilities/CapabilityElement.tsx`
- `packages/client/src/hooks/use-capability-packages.ts`
- `packages/client/src/components/chat/ChatRoleplaySurface.tsx`
- `packages/client/src/components/chat/ConversationView.tsx`
- `packages/client/src/components/chat/ChatSettingsDrawer.tsx`
- `packages/client/src/components/chat/ChatMessage.tsx`
- `packages/client/src/components/chat/ConversationMessageActions.tsx`

Findings:

- Marinara already loads package client entrypoints and renders
  `CapabilityElement` for supported contribution surfaces.
- Conversation toolbar and surface contributions have generic discovery paths.
- Chat settings contain some capability mounts, but discovery/mounting is tied
  to particular package kinds or IDs rather than a fully generic package slot.
- The Roleplay and Conversation message action bars have no generic
  package-owned action slot.
- The existing `_mari-bridge` simulates missing chat-settings/message-action
  surfaces using DOM helpers and observers. The redesign's purpose is to patch
  native React mounts and retire those observers for migrated consumers.

## Existing `_mari-bridge`

The shared root currently includes:

- runtime ownership/capability metadata;
- slash-command capture;
- summary tracking;
- prompt contribution through request overrides;
- DOM/composer helpers;
- fetch interception and generation lifecycle helpers;
- stream helpers;
- simulated UI/capability slots including chat settings and message actions.

`../_mari-bridge/UPSTREAM-GAPS.md` records missing upstream package APIs. In
particular, MB-003, MB-005, MB-009, MB-010, and MB-011 overlap directly with
this redesign.

The shared root has concurrent uncommitted work. This new package was created
without altering it.

## Manifest/dependency constraints

Relevant source:

- `references/marinara-agents/schemas/package-manifest.schema.json`

The current package manifest supports Engine range, entrypoints, permissions,
restart requirement, capability API/build metadata, and contribution metadata
in the Engine's extended types. It does not expose a package dependency list.
Other packages cannot currently declare an installable `mari-bridge`
dependency that the catalog automatically resolves.

## External runtime facts used by the design

- Node module customization hooks can be registered before application code by
  preloading a module with `--import`.
- Static ESM dependencies execute before code in their importer, so registering
  a hook inside a late-loaded capability cannot affect already imported
  modules.
- Node 24 exposes POSIX `process.execve`; it is unavailable on Windows and
  replaces the current process without running application cleanup itself.

Implementation should pin behavior to the Engine's supported Node range and
include runtime feature detection rather than assuming these APIs forever.

Primary runtime references:

- <https://nodejs.org/api/module.html#customization-hooks>
- <https://nodejs.org/download/release/latest-v24.x/docs/api/process.html#processexecvefile-args-env>
