import { registerHooks } from "node:module";
import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fingerprintOverlayInputs } from "./overlay-fingerprint.js";

const SERVER_OVERLAY_FORMAT_VERSION = "3";
const SERVER_OVERLAY_DIRECTORY = "server";
const ENGINE_ROOT_ENV = "MARI_BRIDGE_ENGINE_ROOT";

function overlayPathForTarget(engineRoot, overlayRoot, segments) {
  const nativeServerDist = resolve(engineRoot, "packages", "server", "dist");
  const nativeSharedDist = resolve(engineRoot, "packages", "shared", "dist");
  const nativePath = resolve(engineRoot, ...segments);
  const serverRelative = relative(nativeServerDist, nativePath);
  if (serverRelative !== "" && !serverRelative.startsWith("..")) {
    return join(overlayRoot, serverRelative);
  }
  const sharedRelative = relative(nativeSharedDist, nativePath);
  if (sharedRelative !== "" && !sharedRelative.startsWith("..")) {
    return join(overlayRoot, "node_modules", "@marinara-engine", "shared", "dist", sharedRelative);
  }
  throw new Error(`Mari Bridge server overlay target is outside supported distributions: ${nativePath}`);
}

async function readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion, fingerprint) {
  const ready = JSON.parse(await readFile(join(target, ".mari-bridge-ready.json"), "utf8"));
  const resolvedEngineRoot = resolve(engineRoot);
  if (
    ready?.formatVersion !== SERVER_OVERLAY_FORMAT_VERSION
    || ready?.engineRoot !== resolvedEngineRoot
    || ready?.engineVersion !== engineVersion
    || ready?.bridgeVersion !== bridgeVersion
    || ready?.fingerprint !== fingerprint
  ) {
    throw new Error("Mari Bridge cached server overlay metadata is invalid");
  }
  await readFile(join(target, "index.js"));
  return Object.freeze({
    root: target,
    entry: join(target, "index.js"),
    engineRoot: resolvedEngineRoot,
    engineVersion,
    bridgeVersion,
    fingerprint,
  });
}

async function linkPackageDependency(source, target) {
  const resolvedSource = await realpath(source);
  const sourceStat = await stat(resolvedSource);
  if (!sourceStat.isDirectory()) return false;
  await symlink(resolvedSource, target, process.platform === "win32" ? "junction" : "dir");
  return true;
}

async function linkServerDependencies(serverPackageRoot, overlayRoot) {
  const nativeNodeModules = join(serverPackageRoot, "node_modules");
  const overlayNodeModules = join(overlayRoot, "node_modules");
  await mkdir(overlayNodeModules, { recursive: true });
  let entries;
  try {
    entries = await readdir(nativeNodeModules, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const source = join(nativeNodeModules, entry.name);
    if (!entry.name.startsWith("@")) {
      await linkPackageDependency(source, join(overlayNodeModules, entry.name));
      continue;
    }
    const targetScope = join(overlayNodeModules, entry.name);
    await mkdir(targetScope, { recursive: true });
    for (const scopedEntry of await readdir(source, { withFileTypes: true })) {
      if (entry.name === "@marinara-engine" && scopedEntry.name === "shared") continue;
      await linkPackageDependency(
        join(source, scopedEntry.name),
        join(targetScope, scopedEntry.name),
      );
    }
  }
}

export async function prepareServerOverlay({
  engineRoot,
  dataDir,
  engineVersion,
  bridgeVersion,
  patchTargets,
  patchModule,
  patchSources = [],
}) {
  const serverPackageRoot = resolve(engineRoot, "packages", "server");
  const nativeServerDist = join(serverPackageRoot, "dist");
  const nativeSharedRoot = resolve(engineRoot, "packages", "shared");
  const overlaysRoot = join(resolve(dataDir), "mari-bridge");
  const target = join(overlaysRoot, SERVER_OVERLAY_DIRECTORY);
  const fingerprint = await fingerprintOverlayInputs(
    [nativeServerDist, join(nativeSharedRoot, "dist")],
    [await readFile(join(nativeSharedRoot, "package.json")), JSON.stringify(patchTargets), String(patchModule), ...patchSources],
  );
  try {
    return await readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion, fingerprint);
  } catch {
    // Build below.
  }

  const sourceRecords = [];
  for (const [label, segments] of patchTargets) {
    const nativePath = resolve(engineRoot, ...segments);
    const source = await readFile(nativePath, "utf8");
    sourceRecords.push({ label, segments, nativePath, source });
  }
  await mkdir(overlaysRoot, { recursive: true });
  const temporary = join(overlaysRoot, `${SERVER_OVERLAY_DIRECTORY}-building-${process.pid}-${Date.now()}`);
  await rm(temporary, { recursive: true, force: true });
  await cp(nativeServerDist, temporary, { recursive: true, force: true });
  await linkServerDependencies(serverPackageRoot, temporary);
  const sharedOverlayRoot = join(temporary, "node_modules", "@marinara-engine", "shared");
  await mkdir(sharedOverlayRoot, { recursive: true });
  await cp(join(nativeSharedRoot, "dist"), join(sharedOverlayRoot, "dist"), { recursive: true, force: true });
  await cp(join(nativeSharedRoot, "package.json"), join(sharedOverlayRoot, "package.json"), { force: true });
  try {
    for (const record of sourceRecords) {
      const outputPath = overlayPathForTarget(engineRoot, temporary, record.segments);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, patchModule(pathToFileURL(record.nativePath).href, record.source));
    }
    await writeFile(
      join(temporary, ".mari-bridge-ready.json"),
      `${JSON.stringify({
        formatVersion: SERVER_OVERLAY_FORMAT_VERSION,
        bridgeVersion,
        engineRoot: resolve(engineRoot),
        engineVersion,
        fingerprint,
      }, null, 2)}\n`,
    );
    await rm(target, { recursive: true, force: true });
    try {
      await rename(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
      await readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion, fingerprint);
      await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion, fingerprint);
}


/** Redirect only the not-yet-loaded native entry to the verified on-disk copy.
 * Keep the native supervisor's child PID, signal delivery and exit-code protocol.
 * Dependencies resolve normally from the copied distribution; no source loader runs.
 */
export function redirectServerEntryToOverlay(overlay) {
  const nativeEntry = pathToFileURL(resolve(overlay.engineRoot, "packages", "server", "dist", "index.js")).href;
  const overlayEntry = pathToFileURL(overlay.entry).href;
  process.env[ENGINE_ROOT_ENV] = resolve(overlay.engineRoot);
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolution = nextResolve(specifier, context);
      return resolution.url === nativeEntry ? { ...resolution, url: overlayEntry } : resolution;
    },
  });
}
export const __test = Object.freeze({
  overlayPathForTarget,
  linkServerDependencies,
});
