// Shared runtime coordinator for bridge copies bundled by different packages.

export const MARI_BRIDGE_VERSION = "1.0.0";

const MARI_BRIDGE_RUNTIME_KEY = "__mariBridgeRuntime";
const DEFAULT_CAPABILITIES = [
  "runtime:newest-wins",
  "commands:register",
  "fetch:interceptors",
  "generation:lifecycle-events",
  "ui-slots:composer-above-input",
  "ui-slots:quick-actions-menu",
];

// Returns the page-global Mari bridge runtime shared by every bundled bridge copy.
export function getMariBridgeRuntime() {
  const root = globalThis;
  const runtime = root[MARI_BRIDGE_RUNTIME_KEY] || {
    version: "0.0.0",
    capabilities: new Set(),
    subsystems: new Map(),
    warnings: [],
  };
  if (!(runtime.capabilities instanceof Set)) runtime.capabilities = new Set(runtime.capabilities || []);
  if (!(runtime.subsystems instanceof Map)) runtime.subsystems = new Map();
  if (!Array.isArray(runtime.warnings)) runtime.warnings = [];
  if (compareBridgeVersions(MARI_BRIDGE_VERSION, runtime.version) > 0) runtime.version = MARI_BRIDGE_VERSION;
  for (const capability of DEFAULT_CAPABILITIES) runtime.capabilities.add(capability);
  root[MARI_BRIDGE_RUNTIME_KEY] = runtime;
  return runtime;
}

// Claims a singleton bridge subsystem; newer bridge versions replace older owners.
export function claimBridgeSubsystem(name, definition = {}) {
  const runtime = getMariBridgeRuntime();
  const subsystem = String(name || "").trim();
  if (!subsystem) throw new Error("Bridge subsystem claim requires a name.");

  const version = String(definition.version || MARI_BRIDGE_VERSION);
  const ownerId = String(definition.ownerId || `${subsystem}@${version}`);
  const current = runtime.subsystems.get(subsystem) || null;
  const comparison = current ? compareBridgeVersions(version, current.version) : 1;

  if (current && comparison < 0) {
    warnBridgeRuntime(`Ignoring older ${subsystem} bridge ${version}; ${current.version} is already active.`);
    return { active: false, current, runtime, token: null };
  }

  if (current && comparison === 0 && current.installed) {
    return { active: false, current, runtime, token: current.token || null };
  }

  if (current?.cleanup) {
    try {
      current.cleanup();
    } catch (error) {
      warnBridgeRuntime(`Bridge subsystem ${subsystem} cleanup failed: ${errorMessage(error)}`);
    }
  }

  const token = Symbol(`mari-bridge:${subsystem}:${version}`);
  const next = {
    name: subsystem,
    version,
    ownerId,
    token,
    installed: false,
    installedAt: Date.now(),
    cleanup: null,
  };
  runtime.subsystems.set(subsystem, next);

  if (typeof definition.install === "function") {
    const cleanup = definition.install({ runtime, previous: current, token });
    if (typeof cleanup === "function") next.cleanup = cleanup;
  }
  next.installed = true;
  return { active: true, current: next, runtime, token };
}

// Checks whether a callback still belongs to the active owner of a subsystem.
export function isBridgeSubsystemOwner(name, token) {
  if (!token) return false;
  return getMariBridgeRuntime().subsystems.get(name)?.token === token;
}

// Registers package-neutral bridge capabilities for feature detection.
export function registerBridgeCapabilities(capabilities) {
  const runtime = getMariBridgeRuntime();
  for (const capability of Array.isArray(capabilities) ? capabilities : [capabilities]) {
    const normalized = String(capability || "").trim();
    if (normalized) runtime.capabilities.add(normalized);
  }
  return runtime;
}

export function hasBridgeCapability(capability) {
  return getMariBridgeRuntime().capabilities.has(String(capability || "").trim());
}

export function compareBridgeVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

export function warnBridgeRuntime(message) {
  const runtime = getMariBridgeRuntime();
  runtime.warnings.push({ message, at: Date.now() });
  if (runtime.warnings.length > 25) runtime.warnings.splice(0, runtime.warnings.length - 25);
  globalThis.console?.warn?.(`[mari-bridge] ${message}`);
}

function parseVersion(value) {
  return String(value || "0")
    .split(/[.-]/u)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
