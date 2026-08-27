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
`DATA_DIR/capability-runtime-snapshots` and are recreated, so the preload and
its implementation modules are copied to stable `DATA_DIR/mari-bridge` paths.

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

The implemented zero-configuration sequence is:

1. Install the package. `restartRequired: true` prevents unsafe live
   activation.
2. If Marinara starts without the stable preload, the installer materializes
   `register.mjs` plus its runtime modules under `DATA_DIR/mari-bridge` and
   schedules one guarded restart after Fastify reaches `onReady`.
3. The restart first calls `await app.close()`, which stops capability
   runtimes, flushes file-backed storage, and releases the writer lease. POSIX
   uses `process.execve`; Windows development uses one hidden replacement
   process and exits the original process.
4. The stable `register.mjs` dispatcher checks `isMainThread` before importing
   the implementation. Worker threads inherit `NODE_OPTIONS`, but they do not
   prepare patches, copy the server, or perform a handoff.
5. The main-thread runtime verifies the exact Engine version and every patch
   anchor, copies the complete server distribution plus the shared
   distribution into `DATA_DIR/mari-bridge/server`, links its normal runtime
   dependencies back to the native installation, and applies the verified
   transforms only to that writable copy.
6. A ready marker records the server-overlay format, Mari Bridge version, and
   Engine version. A matching pair reuses the verified copy; a Bridge version
   change rebuilds it; an Engine version mismatch fails closed without trying
   to reinterpret the old copy.
7. The native process performs one direct handoff to the copied server entry.
   Environment markers identify that exact entry/version and a depth guard
   refuses recursive handoff. The handoff also carries the original Engine root
   explicitly, so the replacement does not infer it from the data-directory
   layout. The replacement imports the already-installed Bridge runtime and
   runs the patched environment without depending on capability-package
   activation order.

Do not call `execve` directly from package activation. At that point the
database is open and buffered writes/writer-lease cleanup depend on
`app.close()`.

After the stable preload is part of the normal launch environment, cold starts
skip the installer bounce. They may still perform the single native-to-overlay
handoff; the handoff launcher exits and only the overlay server remains.

## Argument reconstruction and process ownership

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
other legitimate Node flags. Remove the inherited Mari Bridge import from
`NODE_OPTIONS` before starting the replacement and add one explicit import to
the argument vector. Tests must assert that the launcher exits, one overlay
process owns the server port, and no generic pre-handoff server retains the
writer lease.

## Local development

The same patch engine should be testable without Docker:

- Server production-build testing: launch Node directly with
  `node --import <bridge-register> packages/server/dist/index.js`, verify the
  handoff target, then count the port-owning process rather than matching only
  the original command line.
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
inconsistent state and start native Marinara rather than looping. The
installer bounce and server-overlay handoff have separate attempt/depth guards;
neither may retry recursively.
