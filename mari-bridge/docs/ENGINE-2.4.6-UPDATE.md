# Engine 2.4.6 Bridge and package update

Updated 2026-09-16. This is the implementation follow-up to
[the pre-update audit](ENGINE-2.4.6-AUDIT.md). Package releases are generated
from the `packages` branch by the catalog workflow; no artifacts were packaged
or published by hand.

## Supported build

The runtime and all ten prepared package manifests now target **Engine 2.4.6
only** (`>=2.4.6 <2.4.7`). Old Engine anchor alternatives were removed. Bridge
API remains 1.10; the consumer SDK remains 1.6.0. Removed mount capabilities are
no longer advertised, so an old consumer requiring them fails closed.
Explicit old-extension guidance and old-roster migration fallbacks were also
removed; current package schemas and native storage defaults remain supported.

| Reference | Refreshed commit | Verification |
| --- | --- | --- |
| Engine main | `cc783dd194bacd97379191b9d490939afbe6759e` | Independent production build, source transforms, executable native flows, live Windows harness |
| Engine staging | `990b960e62449b2ddf36f08686ea1da681034c75` | Source transform/syntax audit; its client was not separately built |
| Marinara Agents main | `a16819a2994070b53e0150122bacf6ed78c58334` | Native package, agent and spatial contracts traced |

References were fast-forwarded as requested and otherwise left unchanged. The
test server runs the independent main build in
`.codex-tmp/bridge-audit-engine-246`, not the older Engine folder that supplies
the existing Playwright dependency. The shared harness lease covers setup,
server/model lifetime, browser tests and cleanup. Model requests use the local
deterministic provider on port 9863.

| Package | Updated version |
| --- | --- |
| Mari Bridge | 1.0.42 |
| Better Impersonate | 2.3.11 |
| GM Notes | 1.2.1 |
| Group Sort Order | 1.3.2 |
| Presence | 1.4.10 |
| PWA Helper | 1.0.9 |
| Tracker Profile Details | 1.1.1 |
| Unified Tracker | 1.0.1 |
| World Map Background | 1.1.7 |
| Mari Bridge Smoke | 1.0.1 |

The unrelated local `memory-core` folder is excluded and untouched. Generated
catalog output and upstream contribution checkouts were not edited.

## Native ownership decisions

| Area | Result of tracing the current native owner |
| --- | --- |
| Own-agent settings | GM Notes, Presence, Unified Tracker and World Map Background now mount through native `chat-settings` contributions. Bridge's parallel `agent.settings` registry and patch were removed. |
| GM Notes toolbar | Uses the native `roleplay-tracker` toolbar slot. The old Bridge HUD mount was removed. A narrow visibility predicate allows this surface when Unified Tracker owns GM Notes output. |
| Ordered GM Notes panel | Retains the Bridge section contribution because native generic package slots do not expose the same ordered section/header/add/remove/lock contract. Uses native headers and controls. |
| Promoted tracker details | Reuses native compact/featured character and persona field editors, lock keys, removal and add modes. Discovery now follows semantic properties and native JSX structure rather than old minifier names. |
| Agent execution and state | Marinara still owns agent settings, scheduling, model connections, generation, retries, native result appliers and GameState storage. Bridge only extends missing result types, derived results and exact message/swipe application. |
| Prompt context | Retains per-snapshot context/history transforms and suppression of duplicate promoted fields. Native additive prompt context does not provide equivalent placement or exclusion. |
| Persona Stats augmentation | Tracker Profile Details extends another agent's prompt and result. Native package-scoped services cannot register that other agent's runtime service. |
| Agent Suite | Native JSON editor, validation UI, Save/Reset, dirty state and AI Edit remain native. Bridge supplies only the dynamic tracker-slice reader/patch registry. |
| Drafts and group turns | Native prompt assembly, dry-run provider, composer storage, Stop, participant generation and persistence remain in charge. Missing draft commands, Quick Reply input expansion and group handoff policy retain scoped hooks. |
| Presence | Native message visibility fields are the only attendance source. The pre-save hook and roster notification remain necessary; native Game/Conversation command APIs are different channels. |
| Background and PWA | Native background renderer/store and generation state remain owners. Bridge exposes subscriptions; packages own map-image selection, blur preference and browser wake-lock/icon behavior. |
| Bootstrap and dependency checks | Overlay redirection and fail-closed consumer negotiation remain necessary while private native hooks are required. These are explicitly version-bound integrations, not public Engine APIs. |

## Fixed causes and traced paths

1. **Native generation changed.** Updated cadence and streamed token anchors;
   preserved native Roleplay commands, chance filtering and spatial handling.
   The end-of-stream chance buffer now passes through the same handoff/spatial
   chain. Non-stream dry-run reasoning initialization preserves advanced-memory
   receipt validation.
2. **The storage API changed.** Both real result callbacks now use
   `getByChatAndMessage(chatId, messageId, swipeIndex)`. The previous removed
   `getByMessage` call failed only when a live result was applied. Retry and
   regeneration tests check the actual selected swipe.
3. **Startup ownership changed.** The overlay runs in the native supervisor's
   server process. First installation launches the native supervisor; updates
   close the app and use its exit-75 restart protocol. Windows retains its
   first-install launcher until the child exits. Repeated native admin restarts
   were exercised. Complete server/shared/client file fingerprints prevent
   stale same-version overlays from being reused.
4. **Native custom-element props have a lifecycle.** Renamed the GM Notes `view`
   getter that conflicted with React assigning a property. Same-chat props no
   longer reset edits/backfill or trigger Unified Tracker's refresh loop.
   Native chat cache bookkeeping does not trigger package refreshes; committed
   metadata changes still do. GM Notes cancels backfill only on a real chat change.
5. **History can exist without a tracker snapshot.** GM Notes backfill now reads
   empty tracker context and creates its first snapshot through native manual
   persistence. Cancellation keeps the completed-batch checkpoint.
6. **Draft lifecycle was missing from consumers.** Actual draft-controller
   activity now joins Bridge lifecycle snapshots. PWA leases cover draft
   generation and release on Stop/failure without clearing another chat's run.
7. **A saved blur did not refresh its renderer.** A versioned subscription at
   the native renderer updates same-image blur immediately. It does not write
   the user's global blur preference; unchanged replay does not loop.
8. **A preset switch never rendered.** Its native extension now receives React
   from the actual module import instead of assuming `globalThis.React` exists.
9. **Unified controls silently ignored changes.** Empty `data-*` markers are
   tested by attribute presence. Quest preset and main-prompt switches save;
   ordered writes and versioned reads protect rapid edits from stale responses.
   A delayed-response harness test verifies that an older read cannot overwrite
   a newer edit. Duplicate input/change saves were removed.
10. **Wake-lock cleanup had races.** Late requests after cancellation/destruction
    are released, stale sentinel events cannot clear a replacement lock, and
    focus/pageshow retry denied or dropped locks. These are package-local
    browser effects, not replacements for native generation control.

## Verification record

Package checks cover the SDK, Bridge and every current consumer: **11 passing
check commands**, including prepared manifest validation and focused runtime
tests. PWA now has executable cancellation/recovery tests in addition to build
validation.

The main and staging source audits each pass **15 target modules and 81 server
patch IDs**, with no transform failures or syntax errors. The complete main
build passes all **13 client patch groups**. `check-engine.mjs` executes **42
stream-chain cases** using functions extracted from the real compiled native
code, and checks both exact-snapshot callbacks against the current storage API.
`check-bootstrap.mjs` executes direct and native-supervised first installation,
forced update, app close and same-process entry redirection using the real
Engine supervisor.

| Harness script | Functional coverage |
| --- | --- |
| `verify-instance.mjs --live` | Native manifest schemas, installed file hashes, exact patched assets, ready Bridge and all installed consumers |
| `verify-unified-tracker-parallel.mjs` | Real streaming alongside delayed tracker, all six section results, no invented stats, field locks, namespace preservation, selected regeneration swipe, manual retry, cadence and source-depth prompt context |
| `verify-profile-results.mjs` | Standalone native Persona Stats/Character Tracker execution, four detail fields, stats and locks, blank/null model key handling, unrelated custom fields, hidden-character prompt exclusion, non-stream reasoning capture and one promoted context block in the next dry run |
| `verify-group-presence.mjs` | Hidden handoff markers, native Continue, regeneration anchor, selector fallback, persona turn without an assistant/model call, next-user consumption, roster changes, post-only stamping, scoped hide/unhide, actual prompt visibility and always-present restoration |
| `verify-group-ui.mjs` | Unique native composer mount, persona toggle save, selector refresh, participant persistence across reload and mobile layout |
| `verify-gm-notes.mjs` / `verify-gm-notes-backfill.mjs` | Result application and context, completed-turn boundary, cancellation/checkpoint/resume, protected manual/locked/future notes, unrelated namespaces and repeat-run idempotency |
| `verify-native-ui.mjs` | GM Notes add/edit/lock/unlock/remove/reload, compact and featured profile editing, real result application against UI-created locks, native removal/lock cleanup, add/rename/promotion, mobile layout and unique toolbar |
| `verify-package-flows.mjs` | Draft/continue/recall/reasoning/failure/Stop, native composer persistence, PWA draft lease, live native settings, backfill after metadata updates and without a snapshot, actual loaded map image/blur, no-image restoration and committed location travel |
| `verify-draft-native-controls.mjs` | Saved native Quick Reply with `{{input}}`, actual preset-owned versus normal prompt requests, native switch, active draft completion across chat changes without overwriting the other chat |
| `verify-native-agent-controls.mjs` | Unified controls and reload persistence, deliberately delayed older settings response; native Agent Suite read, invalid JSON, Reset, Save, AI Edit draft versus committed state, namespace preservation |
| `verify-pwa-runtime.mjs` | Actual icon generation in browser, shared lease API, hidden/visible/external release, failure/focus recovery and in-flight cancellation using a deterministic browser API double |

Machine-readable source/build evidence is in
[`engine-2.4.6-update-main.json`](engine-2.4.6-update-main.json),
[`engine-2.4.6-update-staging.json`](engine-2.4.6-update-staging.json), and
[`engine-2.4.6-update-built.json`](engine-2.4.6-update-built.json).
The [final harness index](engine-2.4.6-harness-verification.json) records outcomes
and artifact paths for all 11 package checks and 15 verification records. Browser suites run
sequentially with pacing under Engine's unchanged request limit; the longer
flow also checks that idle surfaces do not poll or loop.

## Limits

Windows local main 2.4.6 is the executed integration target. Docker was
unavailable; POSIX first-install `execve`, Docker restart behavior and a separate
staging client build were not executed. Staging source compatibility alone is
not client certification. Real model-provider quality, real iOS installation
and physical screen-wake policy are outside the deterministic harness evidence.
Advanced-memory validation is preserved and checked in the compiled transform;
the harness does not certify the full unrelated advanced-memory product.

Private native anchors remain fragile across Engine releases. The exact version
gate, complete input fingerprints, preflight checks and executable harness
checks are required before changing the supported Engine version again. These
tests provide concrete regression evidence, not a guarantee about every device,
model or future build.
