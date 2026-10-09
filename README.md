# Marinara Capability Packages

This checkout contains capability package sources. The existing catalog repository
and GitHub Actions remain the distribution path; generated output is not edited here.

## Migration status — 2026-10-09

The old injected Mari Bridge and five feature packages were retired to
../archive/packages/2026-10-09-bridge-retirement/. The local archive also contains
the old SDK, smoke package, tracker codecs and bridge bootstrap CI workflow.
It is outside this Git checkout and is not published by its workflow.

Remaining packages:

- better-impersonate: browser-only package with integrated controls.
- pwa-helper: browser-only package covering generation and dry runs.
- presence: native-backed package; browser-only if persistence semantics allow it.
- world-map-background: native-backed package; browser-only if native APIs suffice.
- mari-bridge: planning placeholder for a minimal registry and shared utilities.

Better Impersonate 3.0.0 has been rewritten and verified against Engine 2.5.0.
The other folders retain temporary MIGRATION.md notes to delete after implementation
and verification; their old implementations are not build-ready and remain excluded
from publication. Better Impersonate has includeInMain: true. The maintained
testbench installs only Better Impersonate 3.0.0. GitHub Actions regenerates the catalog.

## Target architecture

Use native APIs, generation, storage and contribution surfaces. Do not restore
Engine patching or private-store integration. Each package bundles a minimal
shared registry bootstrap so registration is independent of load order.
Consumers preflight all required contracts at operation start, resolve providers
at call time and never cache implementations at initialization. Operation-scoped
ownership governs cancellation, replacement and cleanup.

Keep feature data with its native or package owner. Mari Bridge supplies service
registration and narrowly scoped utilities, not a replacement application.
