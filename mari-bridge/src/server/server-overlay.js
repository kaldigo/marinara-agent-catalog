import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SERVER_OVERLAY_FORMAT_VERSION = "2";
const SERVER_OVERLAY_DIRECTORY = "server";
const SERVER_OVERLAY_VERSION_ENV = "MARI_BRIDGE_SERVER_OVERLAY_VERSION";
const SERVER_OVERLAY_ENTRY_ENV = "MARI_BRIDGE_SERVER_OVERLAY_ENTRY";
const SERVER_OVERLAY_HANDOFF_DEPTH_ENV = "MARI_BRIDGE_SERVER_HANDOFF_DEPTH";
const ENGINE_ROOT_ENV = "MARI_BRIDGE_ENGINE_ROOT";

function withoutMariBridgeImports(value) {
  const tokens = String(value ?? "").trim().split(/\s+/u).filter(Boolean);
  const retained = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--import" && tokens[index + 1]?.toLowerCase().includes("mari-bridge")) {
      index += 1;
      continue;
    }
    if (token.startsWith("--import=") && token.toLowerCase().includes("mari-bridge")) continue;
    retained.push(token);
  }
  return retained.join(" ");
}

function withoutMariBridgeExecArgs(values) {
  const retained = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--import" && values[index + 1]?.toLowerCase().includes("mari-bridge")) {
      index += 1;
      continue;
    }
    if (value.startsWith("--import=") && value.toLowerCase().includes("mari-bridge")) continue;
    retained.push(value);
  }
  return retained;
}

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

async function readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion) {
  const ready = JSON.parse(await readFile(join(target, ".mari-bridge-ready.json"), "utf8"));
  const resolvedEngineRoot = resolve(engineRoot);
  if (
    ready?.formatVersion !== SERVER_OVERLAY_FORMAT_VERSION
    || ready?.engineRoot !== resolvedEngineRoot
    || ready?.engineVersion !== engineVersion
    || ready?.bridgeVersion !== bridgeVersion
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
}) {
  const serverPackageRoot = resolve(engineRoot, "packages", "server");
  const nativeServerDist = join(serverPackageRoot, "dist");
  const nativeSharedRoot = resolve(engineRoot, "packages", "shared");
  const overlaysRoot = join(resolve(dataDir), "mari-bridge");
  const target = join(overlaysRoot, SERVER_OVERLAY_DIRECTORY);
  try {
    return await readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion);
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
      }, null, 2)}\n`,
    );
    await rm(target, { recursive: true, force: true });
    try {
      await rename(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
      await readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion);
      await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return readReadyOverlay(target, engineRoot, engineVersion, bridgeVersion);
}

export function isServerOverlayEntry(entry, overlay) {
  return Boolean(entry && overlay?.entry && resolve(entry) === resolve(overlay.entry));
}

export function serverOverlayProcessState(overlay, environment = process.env) {
  const rawDepth = Number.parseInt(environment[SERVER_OVERLAY_HANDOFF_DEPTH_ENV] ?? "0", 10);
  const depth = Number.isSafeInteger(rawDepth) && rawDepth >= 0 ? rawDepth : 0;
  const active = environment[SERVER_OVERLAY_VERSION_ENV] === overlay?.bridgeVersion
    && isServerOverlayEntry(environment[SERVER_OVERLAY_ENTRY_ENV], overlay);
  return Object.freeze({ active, depth });
}

export async function handoffToServerOverlay({ overlay, bootstrapUrl }) {
  const state = serverOverlayProcessState(overlay);
  if (state.active) return false;
  if (state.depth >= 1) {
    throw new Error(
      `Mari Bridge refused a recursive server-overlay handoff at depth ${state.depth}`,
    );
  }
  const inheritedExecArgs = withoutMariBridgeExecArgs(process.execArgv);
  const args = [
    ...inheritedExecArgs,
    `--import=${bootstrapUrl.href}`,
    overlay.entry,
    ...process.argv.slice(2),
  ];
  const environment = Object.fromEntries(Object.entries({
    ...process.env,
    MARI_BRIDGE_SERVER_OVERLAY_VERSION: overlay.bridgeVersion,
    MARI_BRIDGE_SERVER_OVERLAY_ENTRY: resolve(overlay.entry),
    MARI_BRIDGE_SERVER_HANDOFF_DEPTH: String(state.depth + 1),
    [ENGINE_ROOT_ENV]: resolve(overlay.engineRoot),
    NODE_OPTIONS: withoutMariBridgeImports(process.env.NODE_OPTIONS),
  }).filter((entry) => typeof entry[1] === "string"));
  if (process.platform === "win32") {
    const child = spawn(process.execPath, args, {
      detached: true,
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    await new Promise((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", reject);
    });
    child.unref();
    process.exit(0);
  }
  if (typeof process.execve !== "function") {
    throw new Error("Mari Bridge cannot hand off to the patched server overlay on this Node runtime");
  }
  process.execve(process.execPath, [process.execPath, ...args], environment);
  return true;
}

export const __test = Object.freeze({
  overlayPathForTarget,
  linkServerDependencies,
  serverOverlayProcessState,
  withoutMariBridgeExecArgs,
  withoutMariBridgeImports,
});
