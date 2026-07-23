function createWakeLockController({ setWakeLockStatus, warn }) {
  const leases = new Map();
  let sentinel = null;
  let requestPromise = null;
  let nextLeaseId = 1;

  function wakeLockSupported() {
    return Boolean(navigator?.wakeLock && typeof navigator.wakeLock.request === "function");
  }

  function shouldHoldWakeLock() {
    return leases.size > 0 && document.visibilityState !== "hidden";
  }

  function activeLeases() {
    return Array.from(leases.values()).map((lease) => ({
      id: lease.id,
      source: lease.source,
      reason: lease.reason,
      acquiredAt: lease.acquiredAt,
    }));
  }

  function status() {
    return {
      supported: wakeLockSupported(),
      active: Boolean(sentinel),
      pending: Boolean(requestPromise),
      leaseCount: leases.size,
      activeLeases: activeLeases(),
      visibilityState: document.visibilityState,
    };
  }

  function publishStatus() {
    if (!leases.size) {
      setWakeLockStatus("idle", "");
      return;
    }
    if (!wakeLockSupported()) {
      setWakeLockStatus("unsupported", "Screen Wake Lock API is unavailable in this browser.");
      return;
    }
    if (document.visibilityState === "hidden") {
      setWakeLockStatus("waiting-for-visible", "");
      return;
    }
    if (sentinel) {
      setWakeLockStatus("active", "");
      return;
    }
    if (requestPromise) {
      setWakeLockStatus("requesting", "");
      return;
    }
    setWakeLockStatus("released", "");
  }

  function onSentinelReleased() {
    sentinel = null;
    publishStatus();
    if (shouldHoldWakeLock()) {
      window.setTimeout(() => {
        void reconcile();
      }, 250);
    }
  }

  async function requestScreenWakeLock() {
    if (!shouldHoldWakeLock()) {
      publishStatus();
      return null;
    }
    if (!wakeLockSupported()) {
      publishStatus();
      return null;
    }
    if (sentinel) {
      publishStatus();
      return sentinel;
    }
    if (requestPromise) return requestPromise;

    publishStatus();
    requestPromise = navigator.wakeLock.request("screen")
      .then((nextSentinel) => {
        sentinel = nextSentinel;
        sentinel.addEventListener("release", onSentinelReleased, { once: true });
        publishStatus();
        return sentinel;
      })
      .catch((error) => {
        sentinel = null;
        setWakeLockStatus("error", error instanceof Error ? error.message : String(error));
        warn("screen wake lock request failed", error);
        return null;
      })
      .finally(() => {
        requestPromise = null;
        publishStatus();
      });

    return requestPromise;
  }

  function releaseScreenWakeLock() {
    const current = sentinel;
    sentinel = null;
    if (current && !current.released) {
      void current.release().catch((error) => warn("screen wake lock release failed", error));
    }
    publishStatus();
  }

  function normalizeLease(input) {
    const candidate = input && typeof input === "object" ? input : {};
    const id = typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : `${PACKAGE_ID}:lease:${nextLeaseId++}`;
    return {
      id,
      source: typeof candidate.source === "string" && candidate.source.trim() ? candidate.source.trim() : PACKAGE_NAME,
      reason: typeof candidate.reason === "string" && candidate.reason.trim() ? candidate.reason.trim() : "unspecified",
      acquiredAt: new Date().toISOString(),
    };
  }

  function hold(input = {}) {
    const lease = normalizeLease(input);
    leases.set(lease.id, lease);
    void reconcile();
    return Object.freeze({
      id: lease.id,
      release: () => release(lease.id),
    });
  }

  function release(idOrLease) {
    const id = typeof idOrLease === "string" ? idOrLease : idOrLease?.id;
    if (!id || !leases.delete(id)) return false;
    void reconcile();
    return true;
  }

  async function reconcile() {
    if (shouldHoldWakeLock()) {
      await requestScreenWakeLock();
      return;
    }
    if (sentinel) releaseScreenWakeLock();
    else publishStatus();
  }

  function destroy() {
    leases.clear();
    releaseScreenWakeLock();
    publishStatus();
  }

  return {
    hold,
    release,
    reconcile,
    status,
    destroy,
  };
}
