const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 9 });
const MARI_BRIDGE_SERVER_SYMBOL = Symbol.for("marinara.mari-bridge.v1");
const MARI_BRIDGE_CLIENT_SYMBOL = Symbol.for("marinara.mari-bridge.client.v1");

class MariBridgeUnavailableError extends Error {
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

function normalizeBridgeRequirements(input = {}) {
  const consumerId = String(input.consumerId ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(consumerId)) {
    throw new TypeError("Mari Bridge consumerId must be a lowercase package ID");
  }
  const major = Number(input.api?.major);
  const minMinor = Number(input.api?.minMinor ?? 0);
  if (!Number.isInteger(major) || major < 1 || !Number.isInteger(minMinor) || minMinor < 0) {
    throw new TypeError("Mari Bridge API requirement must contain a positive major and non-negative minMinor");
  }
  return Object.freeze({
    consumerId,
    api: Object.freeze({ major, minMinor }),
    require: Object.freeze([...new Set((input.require ?? []).map(String).map((value) => value.trim()).filter(Boolean))].sort()),
  });
}

function missingBridgeError(consumerId, surface) {
  return new MariBridgeUnavailableError(
    `Mari Bridge ${surface} runtime is not installed or did not start before ${consumerId}`,
    { reason: "missing", consumerId },
  );
}



function readyClientRuntime() {
  const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
  return runtime?.status === "ready" && typeof runtime.registerConsumer === "function" ? runtime : null;
}

async function activateClientWithMariBridge(input, activateConsumer) {
  if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
  const requirements = normalizeBridgeRequirements(input);
  const runtime = readyClientRuntime();
  if (!runtime) {
    throw missingBridgeError(requirements.consumerId, "client");
  }
  const session = runtime.registerConsumer(requirements);
  try {
    const cleanup = await activateConsumer(session);
    if (typeof cleanup === "function") session.addCleanup(cleanup);
    const marker = `data-mari-bridge-consumer-${requirements.consumerId}`;
    globalThis.document?.documentElement?.setAttribute(marker, "ready");
    return async () => {
      globalThis.document?.documentElement?.removeAttribute(marker);
      await session.close(`${requirements.consumerId} client deactivated`);
    };
  } catch (error) {
    await session.close(`${requirements.consumerId} client activation failed`);
    throw error;
  }
}



const CAPABILITY_TAG = "marinara-capability-tracker-profile-details";
if (!customElements.get(CAPABILITY_TAG)) {
  customElements.define(CAPABILITY_TAG, class TrackerProfileDetailsCapability extends HTMLElement {});
}

const cleanupTrackerProfileDetails = await activateClientWithMariBridge(
  {
    consumerId: "tracker-profile-details",
    api: { major: 1, minMinor: 9 },
    require: ["client.bridge-first", "consumer.sessions", "runtime.health", "tracker.detail-fields"],
  },
  async (bridgeSession) => {
    const disposeCharacterFields = bridgeSession.tracker.registerDetailFields({
      id: "character-scene-details",
      target: "character",
      fields: [
        { name: "Location", icon: "location" },
        { name: "Movement", icon: "movement" },
        { name: "Activity", icon: "activity" },
      ],
    });
    const disposePersonaFields = bridgeSession.tracker.registerDetailFields({
      id: "persona-scene-details",
      target: "persona",
      fields: [
        { name: "Outfit", icon: "shirt" },
        { name: "Location", icon: "location" },
        { name: "Movement", icon: "movement" },
        { name: "Activity", icon: "activity" },
      ],
    });
    return () => {
      disposePersonaFields();
      disposeCharacterFields();
    };
  },
);

void cleanupTrackerProfileDetails;

