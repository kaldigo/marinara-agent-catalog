export const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 5 });
export const MARI_BRIDGE_IMPLEMENTATION_VERSION = "1.0.23";
export const MARI_BRIDGE_SERVER_SYMBOL = Symbol.for("marinara.mari-bridge.v1");
export const MARI_BRIDGE_CLIENT_SYMBOL = Symbol.for("marinara.mari-bridge.client.v1");
export const MARI_BRIDGE_KERNEL_SYMBOL = Symbol.for("marinara.mari-bridge.kernel.v1");

export const BRIDGE_UNAVAILABLE_REASONS = Object.freeze([
  "missing",
  "disabled",
  "starting",
  "incompatible-api",
  "patch-failed",
  "capability-missing",
  "unhealthy",
]);

export class MariBridgeUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MariBridgeUnavailableError";
    this.code = "MARI_BRIDGE_UNAVAILABLE";
    this.reason = details.reason ?? "unhealthy";
    this.consumerId = details.consumerId ?? null;
    this.missingCapabilities = Object.freeze([...(details.missingCapabilities ?? [])]);
    this.failedPatches = Object.freeze([...(details.failedPatches ?? [])]);
  }
}

export function normalizeRequirements(input = {}) {
  const consumerId = String(input.consumerId ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(consumerId)) {
    throw new TypeError("Mari Bridge consumerId must be a lowercase package ID");
  }
  const major = Number(input.api?.major);
  const minMinor = Number(input.api?.minMinor ?? 0);
  if (!Number.isInteger(major) || major < 1 || !Number.isInteger(minMinor) || minMinor < 0) {
    throw new TypeError("Mari Bridge API requirement must contain a positive major and non-negative minMinor");
  }
  const require = [...new Set((input.require ?? []).map((value) => String(value).trim()).filter(Boolean))].sort();
  return Object.freeze({ consumerId, api: Object.freeze({ major, minMinor }), require: Object.freeze(require) });
}
