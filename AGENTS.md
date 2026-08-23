# AGENTS.md

## Scope

These instructions apply to the `packages` branch checkout.

## Investigation and Fix Discipline

- Do not make small patch/hotfix edits until the behavior has been traced through the owning code path.
- For package bugs, trace at least: package entrypoint, bridge/shared helpers, package runtime state, relevant server routes, Marinara reference behavior, and cleanup/lifecycle triggers.
- For UI bugs, inspect the DOM/source-of-truth path that controls the UI, not only the rendered element being styled or moved. Confirm whether the behavior is owned by `_mari-bridge`, the package, upstream Marinara, or generated package output.
- For lockups, startup failures, loops, duplicate UI, stale chat state, or cross-package conflicts, check bridge singleton/version arbitration, registration idempotency, observers, timers, event listeners, and package install order before editing.
- Prefer a shared `_mari-bridge` fix when the bug is caused by composer discovery, active-chat resolution, UI slots, command matching, generation lifecycle, fetch wrappers, prompt contribution, or other reusable integration behavior.
- Package-local fixes are appropriate only for package-specific business logic,
  rendering details within a native slot, settings fields the native schema
  cannot represent, routes for operations no native/bridge host API can express,
  and genuinely package-owned state.
- Add or update focused automated checks for the traced failure mode whenever practical. Source-level assertions are acceptable for bundle contracts, but runtime/lifecycle defects should get a runtime-style check when feasible.
- After changing `_mari-bridge`, run the bridge checks and the checks for all known bridge consumers unless a consumer has unrelated uncommitted files or the user explicitly narrows the task.
- Before committing, review `git diff --stat`, `git diff --check`, `git diff --cached --name-only`, and `git status --short`. Stage only files relevant to the traced fix and never include `memory-core/` unless the user explicitly asks.
- In the handoff, state the traced cause, the shared/package boundary decision, and the checks that passed.

## Native-First Package Policy

Packages extend Marinara; they do not recreate it. Before adding package code,
trace the current Engine implementation and use this ownership order:

1. Use an existing native agent definition, settings editor, generation path,
   command, action, tracker surface, persistence field, or API unchanged.
2. If native behavior is almost sufficient, add the smallest Mari Bridge hook
   or native extension slot needed to expose that behavior to packages.
3. Add package-owned logic only for the feature-specific behavior or data that
   has no native owner.

Do not build package-local replacements for native connection/model selection,
prompt-template editing, agent execution, dry runs, Stop behavior, chat-agent
enablement, settings layouts, message persistence, GameState patching, or
generation lifecycle. Do not add a package route merely to wrap a native route.
Package-owned routes are exceptional and require a concrete operation that the
native API and bridge host services cannot express.

Normal agents should remain normal agents. Put their prompt, phase, result
settings, model override, context sources, tools, and enablement in
`agents.json`, and let Marinara render and run them. A package may add only the
missing result handler, context formatter, lifecycle hook, or small
package-specific control.

Native UI is the reference implementation, not just a color palette:

- extend the existing native agent card instead of creating a second settings
  page;
- use the native HUD, tracker panel, toolbar, popover, inline-edit, add-mode,
  remove-mode, and lock interaction patterns when adding a missing surface;
- mount package-specific content only through a verified Mari Bridge native
  slot;
- use native tokens and responsive behavior, including body-level/clamped
  popovers where the native component does;
- never use `alert()`, `prompt()`, or `confirm()` for normal editing workflows;
- do not add MutationObservers, repeated DOM scans, button lookup/click
  automation, or parallel React/application shells.

Prefer native storage (`message.extra`, chat metadata, GameState, agent
settings, character fields/stats) when it already owns the concept. Use a
package namespace only for genuinely package-specific state and preserve every
other namespace on writes. Prompt guidance such as a preferred list size is not
an automatic storage cap; enforce a limit in deterministic code only when the
product behavior explicitly requires data loss. Locks must be stored and
enforced by the state applier, not rendered as decorative UI only.

Functional verification is required for UI work. In addition to screenshots,
exercise edit/save, add, remove, lock/unlock, persistence after reload, agent
result application, failure/cleanup, and the next-generation data path as
applicable. A native-looking static mock is not sufficient.

## Mari Bridge Rules

- Package work must check `_mari-bridge` before adding local compatibility code for Marinara client DOM, composer integration, slash commands, generation lifecycle, fetch/generation wrappers, prompt contribution, summary tracking, or host-route workarounds.
- Missing reusable seams that should eventually be upstream Marinara package
  APIs belong in `mari-bridge`/`_mari-bridge`, not in individual packages. Do
  not patch a native workflow that packages can already use directly.
- Bridge helpers must be package-neutral and reusable. Do not add Presence-, Better Impersonate-, Group Sort Order-, or PWA Helper-specific behavior to the bridge.
- Package-specific business logic, prompt text, schemas, and genuinely custom
  state stay in the consuming package. Rendering must still follow native
  components and interaction behavior; package settings and routes exist only
  when no native owner is available.
- Prefer bridge-owned registration APIs over package-local DOM/event
  interception. Packages register the smallest contribution or handler; the
  bridge owns discovery, native mounting, matching, lifecycle, and cleanup.
- Add short inline comments on exported bridge APIs when the intended contract is not obvious. Do not rely on a bridge README for the contract.
- Keep bridge package-facing APIs static when possible. Existing routes and registration shapes should remain compatible; add new routes/helpers instead of changing current contracts.
- `_mari-bridge` browser singletons must be designed so the newest compatible bridge runtime wins when different installed packages carry different bridge copies.
- Do not bump every bridge-consuming package for internal bridge fixes or compatible additions. Bump consumers only when their own source/output changes, or when a bridge change requires a package-facing API or packaged-output contract update. If a required bump is skipped because a package has uncommitted files, call that out in the commit notes or handoff.
- Before committing or pushing, inspect `git status --short` from this folder and stage only the package or bridge source relevant to the task.

## Legacy Extension Ports

- Do not import `_mari-bridge` from legacy `*-extension` ports unless the task is explicitly migrating that behavior to package-era code.
- New package-era work should use `_mari-bridge` instead of `_shared`.
