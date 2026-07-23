import {
  ensureGenerationLifecycleBridge,
  GENERATING_AGENT_EVENT,
  GENERATING_MAIN_EVENT,
  GENERATION_STATE_EVENT,
  getBridgeGenerationSnapshot,
} from "../../../_mari-bridge/src/generation-lifecycle.js";

function snapshotHasActiveGeneration(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.mainActive || snapshot.agentActive) return true;
  return Array.isArray(snapshot.active) && snapshot.active.length > 0;
}

function eventSnapshot(detail) {
  if (detail?.snapshot && typeof detail.snapshot === "object") return detail.snapshot;
  try {
    return getBridgeGenerationSnapshot();
  } catch {
    return null;
  }
}

function createGenerationMonitor({ wakeLock, setGenerationStatus, warn }) {
  const state = {
    active: false,
    lease: null,
    cleanups: [],
    bridgeStarted: false,
  };

  function releaseGenerationLease() {
    if (!state.lease) return;
    try {
      state.lease.release();
    } finally {
      state.lease = null;
    }
  }

  function holdGenerationLease() {
    if (state.lease) return;
    state.lease = wakeLock.hold({
      id: `${PACKAGE_ID}:bridge-generation`,
      source: PACKAGE_NAME,
      reason: "bridge-generation",
    });
  }

  function setActive(active) {
    if (active === state.active) {
      if (active) holdGenerationLease();
      return;
    }

    state.active = active;
    setGenerationStatus(active ? "active" : "idle");
    if (active) holdGenerationLease();
    else releaseGenerationLease();
  }

  function reconcileFromSnapshot(snapshot) {
    setActive(snapshotHasActiveGeneration(snapshot));
  }

  function reconcileCurrentSnapshot() {
    reconcileFromSnapshot(getBridgeGenerationSnapshot());
  }

  function onGenerationEvent(event) {
    reconcileFromSnapshot(eventSnapshot(event.detail));
  }

  function addListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    state.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  function start() {
    if (state.bridgeStarted) return;
    state.bridgeStarted = true;

    try {
      ensureGenerationLifecycleBridge();
    } catch (error) {
      setGenerationStatus("bridge-error");
      warn("generation lifecycle bridge could not start", error);
      return;
    }

    addListener(window, GENERATION_STATE_EVENT, onGenerationEvent);
    addListener(window, GENERATING_MAIN_EVENT, onGenerationEvent);
    addListener(window, GENERATING_AGENT_EVENT, onGenerationEvent);
    addListener(document, "visibilitychange", () => {
      void wakeLock.reconcile();
      reconcileCurrentSnapshot();
    });
    addListener(window, "pageshow", reconcileCurrentSnapshot);
    addListener(window, "focus", reconcileCurrentSnapshot);

    reconcileCurrentSnapshot();
  }

  function stop() {
    state.cleanups.splice(0).forEach((cleanup) => cleanup());
    setActive(false);
    setGenerationStatus("");
    state.bridgeStarted = false;
  }

  return {
    start,
    stop,
    detectGenerationActive: () => state.active,
  };
}
