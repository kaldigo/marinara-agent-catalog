function snapshotHasActiveGeneration(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (snapshot.mainActive || snapshot.agentActive) return true;
  return Array.isArray(snapshot.active) && snapshot.active.length > 0;
}

function createGenerationMonitor({ bridgeGeneration, wakeLock, setGenerationStatus, warn }) {
  const state = {
    active: false,
    lease: null,
    cleanups: [],
    started: false,
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
    reconcileFromSnapshot(bridgeGeneration.getSnapshot());
  }

  function addListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    state.cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  function start() {
    if (state.started) return;
    state.started = true;

    try {
      const unsubscribe = bridgeGeneration.subscribe(reconcileFromSnapshot);
      state.cleanups.push(unsubscribe);
    } catch (error) {
      setGenerationStatus("bridge-error");
      warn("generation lifecycle bridge could not start", error);
      return;
    }

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
    state.started = false;
  }

  return {
    start,
    stop,
    detectGenerationActive: () => state.active,
  };
}
