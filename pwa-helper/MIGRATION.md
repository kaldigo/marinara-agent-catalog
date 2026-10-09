# Migration: PWA Helper

Temporary migration note: delete this file once the work and verification below are complete.

Convert to a browser-only capability package distributed through the existing catalog. Preserve useful PWA/mobile behavior and keep-awake support; explicitly cover native dry runs as well as normal generation.

Remove dependencies on the archived bridge, its generation monitor contract and injected Engine hooks. Trace native generation and dry-run start/completion/abort/failure signals before selecting integration points. Do not replace them with DOM scans or polling. If those signals are unavailable, record the limitation before changing product behavior.

Use the new bundled registration bootstrap and shared API contracts where needed. Resolve services and preflight every required dependency at operation start before side effects; never capture provider implementations at initialization. Own wake-lock release, visibility changes and unload cleanup.

Verify ordinary generation, dry runs, Stop, errors, completion, visibility changes, reload/unload and provider replacement. Re-enable publication only after migration checks pass. Existing source is historical implementation awaiting migration, not a working bridge-free release.
