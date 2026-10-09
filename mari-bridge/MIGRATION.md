# Mari Bridge replacement plan

Temporary migration note: delete this file once implementation and verification are complete. Move enduring contracts into API documentation and code before deleting it.

## Intent

Replace the retired version-bound, Engine-patching Mari Bridge with a small shared service registry and utility package. Keep catalog distribution. Do not restore the archived injector, Engine source patches, or private store/React integration.

## Registration and contracts

- Bundle the same minimal bootstrap protocol into each consumer/provider package. Whichever loads first creates the registry; every subsequent copy reuses that same registry in the same runtime.
- Registration must work without the Mari Bridge runtime package being installed or loaded. The runtime package supplies optional shared utility providers.
- Define provider and consumer contracts in the shared API layer. Keep the bootstrap protocol minimal and stable; version service contracts independently.
- Resolve providers at call time, never during package initialization. Do not retain provider functions, implementation objects, or stores as module-level constants. A stable API facade may be retained.
- Expose has/check for optional availability and require/preflight for all required services and contract versions.
- At the start of an operation, resolve and validate ALL dependencies before any side effects. Report missing/incompatible dependencies there, not at package load.
- A successful preflight returns an operation-scoped set of implementations. Do not resolve a different provider halfway through the same operation. Subsequent operations resolve fresh.
- Provider replacement affects new operations. Active operations keep their originating completion/cancellation handles. Define teardown so an unloading provider cancels or drains its active work explicitly.
- Give each registration an ownership token. Stale cleanup must never unregister a newer replacement. Define duplicate registration and replacement policy explicitly.
- Packages may provide actions for other packages through this registry. Event subscriptions need explicit ownership, unsubscribe, replacement and cleanup contracts; avoid readiness polling.
- Browser and server are separate runtimes: a browser singleton is not a server registry. Any cross-runtime communication must use an explicit supported native transport.
- Preflight prevents missing-dependency partial work; runtime failures still require cleanup or rollback where appropriate.

## Shared utilities and native boundary

Keep registry state limited to service/contract registrations, ownership and necessary operation/subscription metadata. Keep persistent feature state in native storage or the owning package.

Offer only narrowly scoped, reusable actions backed by verified native APIs. Investigate cancellation support for Better Impersonate; expose cancellation of a specific operation, not DOM Stop-button probing/clicking. Do not recreate native generation, connection selection, Stop behavior or persistence.

## Verification before publication

Exercise both load orders, consumer-only loading, missing/incompatible dependency preflight before side effects, duplicate registration, replacement, stale disposal, provider/consumer unload, subscription cleanup, operation cancellation during replacement and fresh provider resolution on the next call. Trace actual native APIs before promising utility behavior.

This folder is a planning placeholder (includeInMain: false, processing.kind: pending). Choose release version and compatibility after implementation; preserve package identity and account for previously installed old bridge versions rather than assuming a fresh install.
