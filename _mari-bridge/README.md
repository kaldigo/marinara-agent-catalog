# _mari-bridge

`_mari-bridge` is the package-era shared layer for Marinara capability packages.
It is separate from `_shared`, which exists to support the legacy Al Dente
Factory extension lineage.

The bridge should hold small, generic compatibility primitives for things that
would ideally be upstream Marinara extension points. Package-specific behavior
belongs in the consuming package.

## Current Scope

- Slash command parsing and command ownership.
- Message range parsing.
- Summary entry change detection.
- Upstream gap tracking.

## Rules

- Keep helpers generic and package-neutral.
- Reference an upstream gap ID in comments when a helper exists only because
  Marinara does not yet expose a stable hook.
- Prefer pure functions where possible so packages can test behavior without a
  running Marinara server.
- Do not import from legacy `_shared`.

## First Consumer

`packages/presence` is the first intended consumer. Presence uses the bridge for
slash command capture, range parsing, and summary lifecycle reconciliation.
