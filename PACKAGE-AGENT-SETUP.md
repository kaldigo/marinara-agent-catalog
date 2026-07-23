# Package And Agent Source Setup

This repository's `main` branch is generated catalog output. Do not use the
shape of `main/custom-packages`, `main/artifacts`, or `main/catalog` to infer
how source work should be set up. Source work lives on the `packages` and
`agents` branches, and GitHub Actions rebuilds `main`.

## Branches

- `main` is the generated catalog Marinara consumes.
- `packages` contains capability package source folders.
- `agents` contains custom prompt-agent source folders.

The official Marinara catalog is not mirrored into this repository. Rebuild
workflows fetch `Pasta-Devs/Marinara-Agents` `main` directly and merge our
included package and agent sources on top.

## Packages Branch

Each publishable package source is a root folder in the `packages` branch. The
folder must contain `marinara-source.json`.

Minimum shape:

```text
presence/
  marinara-source.json
  package.json
  src/
```

Typical metadata:

```json
{
  "schemaVersion": 1,
  "type": "capability-package",
  "includeInMain": false,
  "processing": {
    "kind": "pending",
    "sharedRoots": ["_mari-bridge"]
  },
  "package": {
    "id": "presence",
    "name": "Presence",
    "description": "Character presence for Roleplay chats.",
    "kind": ["agent"],
    "permissions": ["chat-read", "chat-write", "routes", "storage", "ui"],
    "restartRequired": true
  }
}
```

`includeInMain: false` keeps work out of the generated catalog. Use it for
incomplete, exploratory, or locally tested packages. Set `includeInMain: true`
only when the workflow can build the package and the result should appear on
`main`.

Legacy extension ports use folders suffixed with `-extension` and display names
suffixed with ` (Extension)`. This reserves clean package and agent names for
real package-era work.

## Shared Package Roots

Underscore-prefixed root folders on the `packages` branch are shared source
roots, not publishable package folders. The catalog builder ignores them as
package units but leaves them available to package build commands as sibling
folders.

Current shared roots:

- `_shared` is the legacy Al Dente Factory layer used by extension ports.
- `_mari-bridge` is the package-era Marinara bridge for package-focused work.

If a package depends on a shared root, list it in
`processing.sharedRoots`. The builder validates those folders exist before
publishing, which makes missing `_mari-bridge` or `_shared` failures clear.

Do not import `_mari-bridge` from legacy extension ports unless the user asks
for a migration. New package-focused packages should prefer `_mari-bridge` over
`_shared`.

## Agents Branch

Each custom prompt-agent source is a root folder in the `agents` branch. The
folder must contain `marinara-source.json` and an agent definitions file,
usually `agents.json`.

Minimum shape:

```text
memory-planner/
  marinara-source.json
  agents.json
```

Typical metadata:

```json
{
  "schemaVersion": 1,
  "type": "custom-agents",
  "includeInMain": true,
  "processing": {
    "agentsFile": "agents.json"
  }
}
```

Custom agents are prompt definitions only. Do not put package runtime behavior,
client code, server routes, artifacts, privileged UI injection, or
`execution: "feature"` agents on the `agents` branch. Put those in `packages`.

## Workflow Rules

- Edit source in `packages` or `agents`; let Actions regenerate `main`.
- Do not hand-edit generated `catalog/*.json`, `custom-packages/*`, or
  `artifacts/*.zip` on `main`.
- Before committing or pushing `packages` or `agents`, inspect
  `git status --short` and stage only the package or agent currently being
  worked on.
- Do not commit in-progress local folders just because they are present in the
  checkout.
- When confused, read this file and the source branch README files before
  inspecting generated `main` output.
