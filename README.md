# Marinara Capability Packages

This branch contains the editable sources for custom Marinara capability
packages. Each publishable root folder has a `marinara-source.json`; the catalog
workflow builds those sources and generates the public `main` branch output.
Generated catalog artifacts are not edited here.

## Architecture policy

Packages are native-first:

- use Marinara's normal agent definitions, settings editor, model selection,
  generation paths, persistence, and UI wherever they already exist;
- use Mari Bridge only for a missing hook or native extension point;
- keep package code limited to feature-specific behavior and state;
- never replace an existing native workflow with a parallel package-owned
  settings page, request pipeline, connection resolver, or application shell.

When a feature needs new UI, Mari Bridge patches the smallest verified native
mount. The contribution must follow the corresponding native component's
layout and behavior, including inline editing, add/remove modes, locking,
responsive sizing, and lifecycle cleanup. Visual resemblance alone is not
enough.

## Shared foundation

- `mari-bridge/` is the installed, version-bound runtime that patches missing
  Engine seams and owns shared registries.
- `_mari-bridge/` is the thin SDK bundled into consumers. It performs health,
  version, capability, session, and cleanup handling; it is not a second
  patcher.
- Consumers fail closed when their required Mari Bridge capabilities are not
  healthy. They do not fall back to DOM observers or legacy interception.

Legacy extension code is reference/migration material only. New work belongs in
package-era sources and follows `AGENTS.md`.

