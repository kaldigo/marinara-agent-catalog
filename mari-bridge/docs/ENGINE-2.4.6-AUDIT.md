# Mari Bridge audit against Engine 2.4.6

This is the **pre-update** audit of Bridge 1.0.41. Implementation and current
verification are recorded in [ENGINE-2.4.6-UPDATE.md](ENGINE-2.4.6-UPDATE.md).

Audit date: 2026-09-16. Bridge source: **1.0.41**, API **1.10**, package checkout commit `688d8a79f973a2f162d59f6ba3c0973d4bad76f5`.

## Outcome

**Bridge 1.0.41 is incompatible with Engine 2.4.6.** This is more than an outdated version range: three server transforms fail against a full upstream build, and one client patch group fails. The existing version/preflight guards correctly prevent activation. Do not widen the supported versions before repairing and testing these integrations.

Several Bridge responsibilities overlap with native package APIs and should be reduced. However, there is no evidence that the whole bridge can be retired. Native APIs still do not expose its exact-snapshot result application, derived result expansion, native tracker detail-field contributions, arbitrary history transforms, group handoff, or shared client lifecycle contracts.

This initial audit snapshot only refreshed references and produced repeatable checks. The subsequent runtime changes and live verification are documented in the linked update report.

## Reference refresh and comparison boundaries

All three references were clean before updating and were fast-forwarded from their configured upstream remotes. They remain clean.

| Checkout | Previous commit | Audited commit |
| --- | --- | --- |
| Engine `main` | `266d3e1dfd441ec854fdf5a40305799baa04dd9c` (2.4.2) | `cc783dd194bacd97379191b9d490939afbe6759e` (2.4.6) |
| Engine `staging` | `7ece372db251a7d5cd0369a99e57ec59b81edff2` | `990b960e62449b2ddf36f08686ea1da681034c75` (2.4.6) |
| Marinara Agents `main` | `030ec37f3b59c812bc72ef60d6ad3cf29bfe376e` | `a16819a2994070b53e0150122bacf6ed78c58334` |

The saved Engine reference was older than Bridge's actual supported release. Therefore compatibility was compared separately against tag `v2.4.4`, commit `1a299369ac7025028c3ce1b80cc59f47b7b0691b`, as the passing control. Engine main changed 1,315 files from the old reference and 834 files from v2.4.4; this audit concentrates on Bridge's integration boundaries rather than unrelated product changes.

Staging currently adds portrait-crop and advanced-memory summary changes over main. Its server anchor audit has the same three failures. Its client bundle was not separately built; the portrait changes are another reason not to infer client compatibility from the shared version number.

## Confirmed compatibility failures

### 1. Both installation metadata and the preload exclude 2.4.6

- `marinara-source.json` permits `>=2.4.4 <2.4.5`.
- `bootstrap/runtime.mjs:22` supports exactly `2.4.4`.
- All eight published consumers also declare `>=2.4.4 <2.4.5`: Better Impersonate, GM Notes, Group Sort Order, Presence, PWA Helper, Tracker Profile Details, Unified Tracker, and World Map Background.

**Impact:** updating only Bridge's code or only its manifest cannot restore the complete catalog. Installed consumers also fail their SDK dependency gate when the injected runtime is absent/incompatible.

**Required update:** after verification, publish a compatible Bridge and update each tested consumer's source compatibility metadata through the normal catalog workflow. Keep package IDs stable. These metadata/output changes warrant consumer releases; unrelated Bridge-only internal fixes do not. Do not claim 2.4.5 or arbitrary future versions without testing them.

### 2. Regeneration/cadence patch no longer matches

Failed ID: `agent.skip-on-regenerate`.

Bridge expects `if (builtInAgentTypes.has(agent.type))` followed by a separate `continue`. Engine now has `if (builtInAgentTypes.has(agent.type) || agent.type === "illustrator") continue;` at `packages/server/src/routes/generate.routes.ts:3656`.

The Bridge insertion implements both `skipOnRegenerate` and `useGenericRunInterval`. Unified Tracker explicitly sets both in its agent definition. Neither setting has an equivalent implementation in the inspected native source.

**Required update:** preserve the new Illustrator exemption while integrating the two package-neutral scheduling options. Trace their interaction with the new manual-tracker filtering above the loop. Test fresh turns, regenerations, manual reruns, and cadence boundaries; merely matching the new text would not establish correct scheduling.

### 3. Stream handoff patch no longer matches the native filter chain

Failed ID: `turn.handoff-stream-push`.

Bridge expects spatial filtering directly from `text`. Engine now runs:

`text → Roleplay command filter → Game chance filter → spatial filter`

See `packages/server/src/routes/generate.routes.ts:6106`. The native flush path now pushes pending chance text through the spatial filter before draining it (`:7607`).

**Impact:** Group Sort Order handoff and Bridge's XML-like spatial compatibility filtering cannot safely attach through the old insertion. The existing flush transform still matches, but matching alone does not cover the newly added upstream pending-chunk path.

**Required update:** integrate handoff/spatial compatibility into both the normal push path and every relevant flush path while preserving native Roleplay command and Game chance filtering. Test split directives, adjacent directives, end-of-stream candidates, cancellation, rewritten responses, and chunked provider output. Test Roleplay and Game separately; Conversation/VN must retain their own behavior.

### 4. Non-streaming dry-run reasoning insertion no longer matches

Failed ID: `dry-run.nonstream-reasoning-state`.

Engine added advanced-memory receipt validation between `try {` and `provider.chatComplete(...)`, invalidating Bridge's contiguous anchor (`packages/server/src/routes/generate/dry-run-route.ts:2069`).

**Impact:** Bridge cannot inject the local reasoning accumulator/callback. Its later provider/result transforms still match, so bypassing preflight would leave a partially transformed function referencing missing variables. Production preflight correctly prevents that outcome.

**Required update:** anchor the state initialization at a stable scope without removing or bypassing native `validatePrepared`. Test streamed and non-streamed dry runs, reasoning on/off, advanced memory, guidance, impersonation continuation, preset-owned instructions, and cancellation.

### 5. Tracker detail-field client hook fails discovery

Failed group: `client.tracker-detail-fields`.

`src/server/client-overlay.js:21` requires both the outfit localization marker and literal minified `function Qi(`. The 2.4.6 `TrackerDataSidebar` bundle contains the marker but no such function. The patch also contains many exact old minified local names and signatures; replacing this one name is not a sufficient repair.

**Impact:** `tracker.detail-fields` is unavailable. Tracker Profile Details' client dependency gate must remain closed. Native built-in tracker UI remains the fallback; extra detail-field rendering is not verified.

**Required update:** rebase against the native CharacterTrackerCard, FeaturedCharacterFields, PersonaTrackerPanel, and TrackerSectionList ownership paths. Prefer structural discovery or a small stable native extension seam over a new list of fixed minifier names. Verify compact/featured cards, persona fields, hide/lock/edit/add/remove, reload, and result application.

## Additional source-traced risks

### Windows restart ownership conflicts with the new supervisor

Engine's `scripts/run-server.mjs` owns restarts and supplies `MARINARA_RESTART_SUPERVISOR`. Native `POST /api/admin/restart` requires that value to equal the running server's parent PID outside Docker (`packages/server/src/routes/admin.routes.ts:82`). It shuts down gracefully and exits with code 75 so the supervisor can relaunch it.

Bridge's Windows paths in `src/server/bootstrap-restart.js` and `src/server/server-overlay.js` instead start a detached replacement and exit the original process with code 0. The replacement inherits the old supervisor PID but is launched by the old server. The supervisor observes normal termination, so the detached replacement is outside the intended restart ownership model.

**Recommendation:** treat supervisor-aware first install, upgrade, overlay handoff, shutdown, and subsequent native restart as release-blocking verification. Integrate with native restart ownership rather than adding another independent restart manager. The mismatch is source-traced; an end-to-end Windows restart failure was not executed in this audit. POSIX `execve` preserves process identity and needs separate verification, not the same assumed failure.

### Overlay cache validity is weaker than the version-bound patch contract

`src/server/server-overlay.js:readReadyOverlay` accepts a cached server copy based on format, Engine root, Engine version, and Bridge version, plus presence of `index.js`. It does not fingerprint the Engine distribution. Native preflight runs first, but a changed same-version distribution can still pass anchors and reuse an old server copy.

Main and staging currently both identify as 2.4.6 while differing in source. This is a concrete case where version alone does not identify the build. Include a deterministic distribution/build fingerprint in server cache identity. Client cache identity hashes `index.html` and Bridge code; it normally changes with Vite asset hashes, but it does not directly hash every copied asset.

### Existing checks do not validate upstream compatibility

The Bridge and consumer suites pass while the 2.4.6 overlay fails. Most patch checks use synthetic fixtures. Keep those focused tests, but add an exact supported-release source/build audit to compatibility validation. Successful replacement counts also do not prove semantic correctness of the injected runtime.

## What should become native, and what still needs Bridge

Engine now advertises native capability API **1.18**, compared with **1.14** at v2.4.4. The tracker/lifecycle seams in 1.14 were **already available in Bridge's supported release**; they are newly visible relative to the stale 2.4.2 reference, not newly introduced by 2.4.6.

| Bridge area | Native owner and available surface | Audit decision |
| --- | --- | --- |
| Package-owned Roleplay HUD and tracker panels | Native `roleplay-tracker` / `tracker-panel` slots, `RoleplayHUD.tsx`, `TrackerDataSidebar.tsx` | Migrate simple own-package mounts to these surfaces. Native toolbar props include styling, rerun, busy state, and lock-mode callbacks. |
| Ordered tracker sections and shared tracker controls | Native slots mount package views before/after native sections; panel props contain chat/mode/detached, not Bridge's full header/edit/state contract | Partial overlap only. Retain a narrow seam for ordered sections, shared edit/add/remove controls, native section visibility, and built-in surface contributions. Do not recreate missing native controls inside each package. |
| Own-agent settings additions | Native `chat-settings` contribution and standard agent editor | Use these for own-agent controls where sufficient. Bridge can still be needed to attach controls to another native card, such as World Maps or Character Tracker. Standard prompt/model/connection/enablement settings remain native. |
| Additive package prompt text | `api.registerPromptContext`, audience IDs, persona ID, `placedAgentTypes`, and package-aware Agent-section placement | Prefer native for ordinary additive context. Bridge's exact history-position transforms, named-section suppression, and per-snapshot context do not have the same contract. Test preset/no-preset/dry-run paths before migrating consumers. |
| Agent context preparation and validation | `api.registerService("agent-runtime:<package-id>", { prepareContext, finalizeResult })` | Migrate same-package preparation/validation when semantics match. These are bounded two-second hooks with native cleanup and deferred publication. |
| Arbitrary result types, derived results, final state application | Native finalizer returns one `AgentResult`; the result-type allowlist and native appliers remain fixed | Keep the missing result/application seam. Unified Tracker expands one response into native child results and then merges package state; the native finalizer is not a drop-in replacement. GM Notes relies on exact message/swipe snapshot updates and patch emission. |
| Extending a different native agent | Native runtime-service registration is scoped to the package ID | Tracker Profile Details cannot register `agent-runtime:persona-stats` as its own native service. Its prompt/result augmentation still needs a neutral extension seam. |
| Agent Suite Tracker Data | Native editor, JSON save/reset, AI edit, dirty guard, refresh | Keep only the registry exposing additional tracker slices/post-save callback. Do not duplicate that editor. No equivalent public dynamic slice registry was found. |
| Chat/message/resource access | `api.runtime.persistence`, `resources`, scoped transactions and locks, optional `getGameState` | Replace Bridge host requests when native methods express the exact operation. `getGameState` is read-only and latest-state oriented; it is not a replacement for exact-snapshot writes or native manual patch semantics. |
| Model/embedding selection | Native `runtime.languageModels`, `getAgentConfig`, and new `resolveEmbeddings` (1.15) | Use native. Do not introduce Bridge-owned model or connection selection. Embedding callers needing current configuration should resolve it per operation. |
| Commands | Native slash commands, Conversation capability commands, Game Master verbs (1.16) | These are different command channels. Native GM verbs/Conversation tags do not replace Bridge's client composer command registry, persisted draft writing, or Quick Reply input macro. |
| Active chat, generation lifecycle, message preparation/persistence, chat changes | Native stores and storage own behavior, but no equivalent general consumer subscription contract was found | Retain narrow hooks at actual store/save boundaries. Presence and PWA Helper must not return to DOM observation or request interception. |
| Impersonation/drafts | Native impersonation settings, `/api/generate/dryRun`, provider logic, and Stop behavior | Keep only missing continuation/guidance/result/lifecycle seams. `/impersonate` generates through the ordinary flow and does not replace Better Impersonate's draft-only commands. Review Bridge's separate draft controller/state against native cancellation ownership during the update. |
| Group selector and persona handoff | Native group selection/generation, but no matching public delegation/handoff registry found | Retain delegation at the verified native call site. New Roleplay command filters are not a replacement for Group Sort Order policy or its handoff queue. |
| Background/spatial observation | Native Roleplay background store and query cache | Keep small binding/observation seams. Addressed native spatial events target World Maps and an owning Game Experience; they do not provide World Map Background's general successful-query subscription. |
| Consumer dependency negotiation/revocation | Native capability API checks and activation cleanup do not express Bridge patch dependencies | Retain SDK fail-closed checks and scoped cleanup while any injected hooks remain. Do not confuse Engine's API 1.18 with Bridge's API 1.10. |

Relevant native contracts: `packages/shared/src/types/capability-runtime.ts`, `packages/shared/src/schemas/capability-package.schema.ts`, and `packages/server/src/services/capability-packages/{capability-agent-runtime,capability-prompt-context,capability-module-runtime}.service.ts`. The current Memory Nag source demonstrates native runtime-service and prompt-context registration.

### Compatibility shims that are not yet safe to delete

- **Hidden character fields:** native agent context compacts hidden mood/appearance/outfit/thoughts, but `services/generation/committed-tracker-context.ts:formatCharacterLine` still formats those fields without consulting hidden flags. Bridge's main-prompt shim is not made redundant by the agent-only compactor.
- **Malformed empty custom-field key:** the native lock merge still spreads existing/new custom-field objects and iterates their keys without filtering the legacy `{"": null}` entry. The history/preservation/lock-merge compatibility path still needs its regression checks before removal.
- **Bridge macros and nested Outlet handling:** native source still lacks `active-agents`, `group_scenario_override`, and `group_mode`. The assembler still triggers its initial Outlet scan from the section text. Retain the extra macro/context plumbing and nested-field scan behavior until equivalent upstream behavior is verified.
- **XML-like spatial directives:** no equivalent normalization was established in this audit. Keep the shim pending targeted World Maps parser/stream tests, and integrate it correctly with the new native command/chance filters. Do not declare it obsolete merely because native spatial events exist.
- **Client-only package restart recovery:** Engine still starts server-entry packages through `runtimePackages`; the Bridge recovery loop is not superseded by the native change that keeps the previous client version available during restart-required updates. Re-test old-version/current-version serving and readiness transitions before altering recovery.

## Consumer impact and repair order

| Consumer | Main required work |
| --- | --- |
| Tracker Profile Details | Restore detail-field client patch; retain cross-agent prompt/result seam; test native locks/hiding and persistence. |
| Unified Tracker | Restore scheduling flags; preserve native child-result ordering and exact-snapshot merge; test history checkpoints and section controls. |
| Group Sort Order | Repair handoff push/flush integration; test selector fallback, persona handoff, cancellation, and native command filtering. |
| Better Impersonate | Repair dry-run scope insertion; test continuation, reasoning, draft persistence after unmount, native settings and Stop. |
| GM Notes | Evaluate native own-agent UI/context hooks first; preserve exact-snapshot updates, locked notes, Agent Suite edit/save, and rerun. |
| Presence | Verify prepare/persist/chat-change hooks with new message-edit/interrupt behavior and sidebar/settings integration. |
| World Map Background | Verify current native background/query bindings and World Maps package event/state behavior. |
| PWA Helper | Verify native generation lifecycle and wake-lock cleanup, including background/cancelled runs. |

Recommended sequence:

1. Freeze the audited main commit/build as the compatibility target and keep 2.4.4 as a control while backward support is intended.
2. Decide which simple own-package UI and context contributions can move to native APIs without losing behavior; reduce only the overlapping Bridge seams.
3. Repair the three server transforms and detail-field client hook, with focused regressions proving each failure and preserving the new native paths.
4. Make bootstrap/restart supervisor-aware and strengthen server cache identity; test first install, ordinary restart, Bridge upgrade, Engine upgrade, disabled/incompatible Bridge, and rollback/failure cleanup.
5. Re-run build audits and consumer checks, then acquire the shared harness lease for functional testing. Verify edit/save, add/remove, lock/unlock, reload, normal/retry result application, swipe/regeneration, next-turn prompt context, Stop/error cleanup, and cross-chat isolation. Include Windows and POSIX/Docker startup paths separately.
6. Only after those pass, update compatibility metadata and release versions for changed outputs, then let the normal GitHub Actions catalog workflow generate published artifacts. No generated catalog edits or manual ZIPs are needed.

## Verification performed and limits

| Check | Result |
| --- | --- |
| v2.4.4 server-transform control, TypeScript 5.9.3 emission | 15/15 target modules; 80 applied patch IDs; zero failed anchors or syntax errors |
| 2.4.6 main source audit | 13/15 modules; 77 applied / 3 failed patch IDs |
| 2.4.6 staging source audit | Same three server failures |
| Isolated exact-main `pnpm build`, Node 25.8.0 / pinned pnpm 10.34.5 | Passed shared/server/client builds; upstream emitted a circular-chunk warning |
| Actual built server preflight | Failed the same three anchors; all other transforms marked skipped, as intended on failure |
| Actual client overlay preparation | 13 patch groups applied; `client.tracker-detail-fields` failed; diagnostic overlay created only in a dedicated scratch directory |
| Bridge `npm run check` and SDK `npm run check` | Passed |
| All eight published consumers' `npm run check`, plus bridge-smoke | Passed |

The client audit deliberately calls overlay preparation for diagnostics without enabling the production version gate. No Engine server, model stub, browser, or shared test harness was started. Applied anchors and successful builds are not runtime/UI certification. Memory Core's pre-existing untracked work was excluded and untouched. No commits or pushes were made.

Evidence:

- [Passing 2.4.4 baseline](ENGINE-2.4.4-ANCHOR-BASELINE.json)
- [2.4.6 main server audit](ENGINE-2.4.6-ANCHOR-AUDIT.json)
- [2.4.6 staging server audit](ENGINE-2.4.6-STAGING-ANCHOR-AUDIT.json)
- [Full-build server and client diagnostics](ENGINE-2.4.6-BUILD-AUDIT.json)
- [Consumer check results](ENGINE-2.4.6-CONSUMER-CHECKS.json)

Repeat from the workspace root (audit tools return exit code 1 when drift is found):

```powershell
node packages/mari-bridge/scripts/audit-engine.mjs --engine=references/marinara-engine --typescript=.codex-tmp/bridge-audit-tooling/node_modules/typescript/lib/typescript.js --ref=HEAD --output=packages/mari-bridge/docs/ENGINE-2.4.6-ANCHOR-AUDIT.json
node packages/mari-bridge/scripts/audit-built-engine.mjs --engine=.codex-tmp/bridge-audit-engine-246 --data=.codex-tmp/bridge-audit-overlay-246 --output=packages/mari-bridge/docs/ENGINE-2.4.6-BUILD-AUDIT.json
```

The first tool reads the requested Git revision, emits only the 15 target modules in memory, and exercises the shipped transforms. Its compiler path is configurable; the disposable build also contains TypeScript 5.9.3. The second requires a completed Engine build and a dedicated audit data directory. Neither tool runs the Engine. The disposable checkout and diagnostic overlay remain under `.codex-tmp` for follow-up work.
