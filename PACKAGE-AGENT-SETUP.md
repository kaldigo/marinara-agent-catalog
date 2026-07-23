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

Source folders are allowed to have whatever internal layout they need, but the
workflow needs a clear processing contract telling it how to turn that source
folder into the installable package layout Marinara expects.

Minimum source shape:

```text
presence/
  marinara-source.json
  package.json
  src/
  scripts/
```

Typical metadata:

```json
{
  "schemaVersion": 1,
  "type": "capability-package",
  "includeInMain": false,
  "processing": {
    "kind": "package-build",
    "buildCommand": ["npm", "run", "build"],
    "outputDir": "dist/package",
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

### Package Processing Kinds

`processing.kind` tells the main catalog workflow how to prepare the source
folder:

- `pending` means the package is not publishable yet. Use it only with
  `includeInMain: false`.
- `legacy-extension` builds one of the old extension ports and wraps the built
  legacy browser script into a capability package client entrypoint.
- `package-build` runs `processing.buildCommand` and copies a prepared package
  output directory into `main/custom-packages/<package.id>`.

For `package-build`, `processing.outputDir` defaults to `dist/package`. It must
be a relative path inside the source folder. The output directory is the
installable package payload before zipping, not an arbitrary build cache.

The workflow then calculates file hashes and byte sizes, writes them into the
prepared `manifest.json`, builds `artifacts/<id>-<version>.zip`, and merges the
entry into the compatible catalog lanes on `main`.

### Prepared Package Output

A `package-build` source must emit this installable layout:

```text
dist/package/
  manifest.json
  client.js       # optional, if manifest.entrypoints.client is set
  server.mjs      # optional, if manifest.entrypoints.server is set
  agents.json     # optional, if manifest.entrypoints.agents is set
  knowledge.json  # optional, if manifest.entrypoints.knowledge is set
  README.md       # optional but recommended
```

The actual filenames can differ, but every path declared in
`manifest.entrypoints` must exist inside the prepared package output directory.
Entrypoint paths are package-relative and must not point outside the package.

Use conventional output names unless there is a good reason not to:

- `client.js` for browser-side UI/runtime code loaded by Marinara.
- `server.mjs` for server-side ESM package runtime loaded by Marinara.
- `agents.json` for package-owned agent definitions.
- `knowledge.json` for package-owned knowledge payloads if needed.

The prepared `manifest.json` is the package install contract. It must include:

- `schemaVersion`
- `id`
- `name`
- `version`
- `description`
- `engine.min` and `engine.maxExclusive`
- `kind`
- `entrypoints`
- `permissions`
- `restartRequired`

The builder overwrites `manifest.files` with the complete hashed file list from
the prepared output. Do not hand-compute `sha256` or `bytes` in source. If a
source-side manifest includes placeholder `files`, they are ignored during the
generated catalog build.

For schema details, use the upstream source of truth:
`/references/marinara-agents/schemas/package-manifest.schema.json`.

### Entrypoint Rules

Declare only entrypoints the package actually emits:

```json
"entrypoints": {
  "server": "server.mjs",
  "client": "client.js",
  "agents": "agents.json"
}
```

Client-only UI packages can declare only `client`. Server-only packages can
declare only `server`. Packages that expose installable Marinara agents should
declare `agents` and include `agent-runtime` in permissions when the agents need
runtime execution.

Set permissions to the smallest set needed by the emitted entrypoints:

- `ui` for browser UI/runtime behavior.
- `routes` for server routes.
- `storage` for package-owned persisted state.
- `chat-read` / `chat-write` for chat access or mutation.
- `prompt-context` for prompt construction or injection.
- `agent-runtime` for package-owned agents.
- `network` for outbound network access.

Set `restartRequired: true` when server runtime, routes, startup registration,
or installed package shape changes require Marinara to restart before the
package can be safely loaded.

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
