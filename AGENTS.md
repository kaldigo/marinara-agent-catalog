# AGENTS.md

## Scope

These instructions apply to the `packages` branch checkout.

## Mari Bridge Rules

- Package work must check `_mari-bridge` before adding local compatibility code for Marinara client DOM, composer integration, slash commands, generation lifecycle, fetch/generation wrappers, prompt contribution, summary tracking, or host-route workarounds.
- Things that should eventually be upstream Marinara package APIs belong in `_mari-bridge`, not in individual packages.
- Bridge helpers must be package-neutral and reusable. Do not add Presence-, Impersonate Button-, Group Sort Order-, or PWA Helper-specific behavior to the bridge.
- Package-specific business logic, rendering details, prompt text, package settings, and package-owned API routes stay in the consuming package.
- Prefer bridge-owned registration APIs over package-local DOM/event interception. Packages should register contributions and handlers; the bridge should own discovery, mounting, matching, lifecycle, and cleanup.
- Add short inline comments on exported bridge APIs when the intended contract is not obvious. Do not rely on a bridge README for the contract.
- When committing changes to `_mari-bridge`, bump the version of every committed package source that uses `_mari-bridge` through `processing.sharedRoots`, unless that package has uncommitted files. If a package has uncommitted files, leave it alone and call that out in the commit notes or handoff.
- Before committing or pushing, inspect `git status --short` from this folder and stage only the package or bridge source relevant to the task.

## Legacy Extension Ports

- Do not import `_mari-bridge` from legacy `*-extension` ports unless the task is explicitly migrating that behavior to package-era code.
- New package-era work should use `_mari-bridge` instead of `_shared`.
