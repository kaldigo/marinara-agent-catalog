import { REQUEST_BACKOFF_MS, WAKE_HOLD_EVENT, WAKE_RELEASE_EVENT } from "./constants.js";
import { emit } from "./events.js";
import { normalizeId, toCleanString } from "./strings.js";

function wakeLockSupported() {
  return Boolean(navigator.wakeLock && typeof navigator.wakeLock.request === "function");
}

function setWakeStatus(status, error = "") {
  const root = document.documentElement;
  if (!root) return;

  if (status) root.dataset.alDenteWakeLock = status;
  else delete root.dataset.alDenteWakeLock;

  if (error) root.dataset.alDenteWakeLockError = String(error).slice(0, 160);
  else delete root.dataset.alDenteWakeLockError;

  // Legacy status hooks kept for the first PWA Helper build.
  if (status) root.dataset.mariPwaHelperWakeLock = status;
  else delete root.dataset.mariPwaHelperWakeLock;

  if (error) root.dataset.mariPwaHelperWakeLockError = String(error).slice(0, 160);
  else delete root.dataset.mariPwaHelperWakeLockError;
}

function removeWakeListeners(state) {
  const cleanups = Array.isArray(state.wakeListenerCleanups) ? state.wakeListenerCleanups.splice(0) : [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {}
  }
  state.wakeListenersInstalled = false;
}

export function createWakeLockController(state) {
  if (state.wakeListenersInstalled) removeWakeListeners(state);

  function wakeStatus() {
    const activeLeases = Array.from(state.wakeLeases.values()).map((lease) => ({
      id: lease.id,
      source: lease.source,
      reason: lease.reason,
      createdAt: lease.createdAt,
      updatedAt: lease.updatedAt,
    }));

    return {
      active: activeLeases.length > 0,
      supported: wakeLockSupported(),
      held: Boolean(state.wakeLock),
      status: document.documentElement?.dataset?.alDenteWakeLock || "",
      error: state.lastWakeLockError,
      activeLeases,
    };
  }

  async function releaseWakeLockIfIdle() {
    if (state.wakeLeases.size > 0) return;
    const lock = state.wakeLock;
    state.wakeLock = null;
    state.lastWakeLockError = "";
    setWakeStatus("", "");
    if (!lock) return;
    try {
      await lock.release();
    } catch {
      // Browsers can revoke wake locks independently on visibility changes.
    }
  }

  async function syncWakeLock() {
    if (state.wakeLeases.size <= 0) {
      await releaseWakeLockIfIdle();
      return;
    }

    if (state.wakeLock) {
      setWakeStatus("active", "");
      return;
    }

    if (document.visibilityState !== "visible") {
      setWakeStatus("pending-visible", "");
      return;
    }

    if (!wakeLockSupported()) {
      state.lastWakeLockError = "Screen Wake Lock API is unavailable.";
      setWakeStatus("unsupported", state.lastWakeLockError);
      return;
    }

    const now = Date.now();
    if (state.lastWakeLockRequestFailedAt && now - state.lastWakeLockRequestFailedAt < REQUEST_BACKOFF_MS) return;

    try {
      const lock = await navigator.wakeLock.request("screen");
      state.wakeLock = lock;
      state.lastWakeLockError = "";
      setWakeStatus("active", "");
      lock.addEventListener("release", () => {
        if (state.wakeLock === lock) state.wakeLock = null;
        if (state.wakeLeases.size > 0) void syncWakeLock();
        else setWakeStatus("", "");
      }, { once: true });
      emit("wake-lock:changed", wakeStatus());
    } catch (error) {
      state.lastWakeLockRequestFailedAt = Date.now();
      state.lastWakeLockError = error?.message || "Wake lock request failed.";
      setWakeStatus("error", state.lastWakeLockError);
      emit("wake-lock:changed", wakeStatus());
    }
  }

  function holdWakeLock(options = {}) {
    const source = toCleanString(options.source, "unknown");
    const reason = toCleanString(options.reason, "");
    const requestedId = normalizeId(options.id, "");
    const id = requestedId || `${normalizeId(source, "source")}:${++state.wakeLeaseSeq}`;
    const now = new Date().toISOString();
    const existingLease = state.wakeLeases.get(id);
    const leaseRecord = {
      id,
      source,
      reason,
      createdAt: existingLease?.createdAt || now,
      updatedAt: now,
    };

    state.wakeLeases.set(id, leaseRecord);
    void syncWakeLock();
    emit("wake-lock:changed", wakeStatus());

    let released = false;
    return Object.freeze({
      id,
      release: () => {
        if (released) return false;
        released = true;
        return releaseWakeLock(id);
      },
    });
  }

  function releaseWakeLock(id) {
    const leaseId = normalizeId(id, "");
    if (!leaseId || !state.wakeLeases.has(leaseId)) return false;
    state.wakeLeases.delete(leaseId);
    void syncWakeLock();
    emit("wake-lock:changed", wakeStatus());
    return true;
  }

  function onWakeHoldEvent(event) {
    const detail = event?.detail || {};
    const id = normalizeId(detail.id, "");
    if (!id) return;
    holdWakeLock({ ...detail, id });
  }

  function onWakeReleaseEvent(event) {
    releaseWakeLock(event?.detail?.id);
  }

  function installWakeListeners() {
    if (state.wakeListenersInstalled) return;
    const visibilityHandler = () => void syncWakeLock();
    const pageshowHandler = () => void syncWakeLock();
    const focusHandler = () => void syncWakeLock();

    document.addEventListener("visibilitychange", visibilityHandler);
    window.addEventListener("pageshow", pageshowHandler);
    window.addEventListener("focus", focusHandler);
    window.addEventListener(WAKE_HOLD_EVENT, onWakeHoldEvent);
    window.addEventListener(WAKE_RELEASE_EVENT, onWakeReleaseEvent);
    state.wakeListenerCleanups.push(() => document.removeEventListener("visibilitychange", visibilityHandler));
    state.wakeListenerCleanups.push(() => window.removeEventListener("pageshow", pageshowHandler));
    state.wakeListenerCleanups.push(() => window.removeEventListener("focus", focusHandler));
    state.wakeListenerCleanups.push(() => window.removeEventListener(WAKE_HOLD_EVENT, onWakeHoldEvent));
    state.wakeListenerCleanups.push(() => window.removeEventListener(WAKE_RELEASE_EVENT, onWakeReleaseEvent));
    state.wakeListenersInstalled = true;
  }

  installWakeListeners();
  void syncWakeLock();

  return Object.freeze({
    hold: holdWakeLock,
    release: releaseWakeLock,
    activeLeases: () => wakeStatus().activeLeases,
    status: wakeStatus,
  });
}
