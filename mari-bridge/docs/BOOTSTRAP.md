# Bootstrap and Deployment

## Why ordinary activation is too late

Marinara's server entrypoint statically imports `buildApp` before `main()` runs.
`app.ts` statically imports the route registry, and `buildApp()` registers all
core routes before calling `capabilityModuleRuntime.start(app)`.

Consequently, by the time `mari-bridge/server.mjs` can call
`module.registerHooks()`, the prompt/generation modules we need to transform
have already been loaded. Node module hooks do not retroactively change an
evaluated ESM module.

The normal `registerPromptContext` capability is useful but insufficient: it
collects additional prompt text; it does not provide named-section suppression,
message-stage transforms, or arbitrary depth control.

## Persistent locations

The official Docker image sets:

```text
DATA_DIR=/app/data
FILE_STORAGE_DIR=/app/data/storage
VOLUME /app/data
```

Installed capability packages live under
`DATA_DIR/capability-packages`. Runtime snapshots live under
`DATA_DIR/capability-runtime-snapshots` and are recreated, so the preload must
be copied to a stable `DATA_DIR/mari-bridge/bootstrap` path.

The runtime image's application and client build live below `/app` and are not
the persistent user-data contract. The application process drops to the `node`
user. Mari Bridge should assume `/app` is readable but not writable.

## Why writing an environment variable is not sufficient

`NODE_OPTIONS` and the `--import` flag are interpreted when Node starts. A
capability package can mutate its current `process.env`, or write Marinara's
`.env`, but that occurs after the current Node process has already imported the
target modules.

A child process also cannot permanently change the environment of Docker's
entrypoint parent. Therefore an install-only package cannot arrange future
cold starts merely by assigning `process.env.NODE_OPTIONS` during activation.

External Compose configuration remains the technically simplest preload:

```text
NODE_OPTIONS=--import=/app/data/mari-bridge/bootstrap/register.mjs
```

It is not the desired user experience and should be an optional advanced mode,
not the normal install path.

## Package-owned bootstrap

The proposed zero-configuration Docker/POSIX sequence is:

1. Install the package. `restartRequired: true` prevents unsafe live
   activation.
2. On the user's normal restart, Marinara starts without the loader and
   activates Mari Bridge late.
3. Mari Bridge writes/updates the stable loader, patch definitions, client
   overlay inputs, and a bootstrap guard below `DATA_DIR`.
4. It registers a one-shot callback for a safe point after Fastify has completed
   startup. The exact hook/timing must be proven with a regression fixture.
5. The callback invokes `await app.close()` before replacement. This is
   mandatory: Marinara's `onClose` stops capability runtimes and the sidecar,
   flushes file-backed storage, and releases the writer lease.
6. On POSIX Node 24, replace the current application child with
   `process.execve(process.execPath, args, env)`. Arguments preserve existing
   `process.execArgv` and application arguments while adding exactly one
   `--import=<stable register.mjs>`.
7. Set an inherited guard such as `MARI_BRIDGE_BOOTSTRAPPED=1` and include a
   loader-active symbol/probe. The second start must not bootstrap again.
8. The Docker entrypoint continues waiting on the same child PID. The new Node
   process registers hooks before importing Marinara.

Do not call `execve` directly from package activation. At that point the
database is open and buffered writes/writer-lease cleanup depend on
`app.close()`.

Because Docker's parent invocation still lacks `--import`, an install-only
solution may perform this quick internal bootstrap bounce on each cold
container start. An externally configured preload avoids the bounce but is not
required.

## Argument reconstruction

The implementation must test argument handling rather than concatenate a shell
command. Conceptually:

```js
const entry = process.argv[1];
const scriptArgs = process.argv.slice(2);
const inheritedExecArgs = removeExistingMariBridgeImport(process.execArgv);
const args = [
  process.execPath,
  ...inheritedExecArgs,
  `--import=${registerPath}`,
  entry,
  ...scriptArgs,
];
```

Use the direct process API; never invoke a shell. Validate that `entry` and the
stable loader path are absolute or safely resolved. Preserve inspector and
other legitimate Node flags.

## Local development

The same patch engine should be testable without Docker:

- Server production-build testing: launch Node directly with
  `node --import <bridge-register> packages/server/dist/index.js`.
- Client production-overlay testing: build Marinara, create the verified
  overlay under a temporary/test data directory, and run the patched static
  root.
- Source/Vite testing: provide a Mari Bridge Vite transform plugin using the
  same logical patch definitions where practical. Do not pretend a Node ESM
  loader can transform source files that Vite reads and compiles internally.
- Windows: `process.execve` is unavailable. The development launcher should
  start with `--import` directly. An automatic spawn-and-exit fallback can be
  explored separately, but it is not needed for repeatable Codex testing.

Local and Docker tests must exercise the same registry contracts and patch
fixtures even if their bootstrap mechanisms differ.

## Client overlay serving

The Node module loader transforms server modules, not JavaScript files merely
read and served by Fastify. Native React changes therefore need their own
overlay preparation:

1. Fingerprint the host client build.
2. Copy only required client artifacts, or the complete static build when
   unavoidable, into a versioned data-directory overlay.
3. Apply count-checked, version-specific client patches.
4. Verify entry HTML and every referenced asset before marking the overlay
   complete.
5. Let the early server patch select the overlay static root atomically.

Never serve an overlay while it is being constructed. Build into a temporary
directory under `DATA_DIR/mari-bridge/client`, verify it, then rename it into
place.

## Recovery

Provide a documented environment escape hatch such as
`MARI_BRIDGE_DISABLE=1`. The preload should check it before transformations.

If a bootstrap guard is present but the loader-active probe is absent, log the
inconsistent state and start native Marinara rather than looping. A maximum
bootstrap-attempt marker and last-failure record should be persisted for
diagnostics.
