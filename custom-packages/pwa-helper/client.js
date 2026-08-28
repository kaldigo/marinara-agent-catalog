// bridge-sdk/contracts.js
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

// bridge-sdk/client.js
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

// src/client/constants.js
const PACKAGE_ID = "pwa-helper";
const PACKAGE_NAME = "PWA Helper";
const PACKAGE_VERSION = "1.0.8";
const ELEMENT_TAG = "marinara-capability-pwa-helper";
const RUNTIME_KEY = "__marinaraPwaHelperRuntime";
const PUBLIC_API_KEY = "marinaraPwaHelper";

const WAKE_LOCK_DATA_ATTR = "mariPwaHelperWakeLock";
const WAKE_LOCK_ERROR_ATTR = "mariPwaHelperWakeLockError";
const GENERATION_DATA_ATTR = "mariPwaHelperGeneration";
const IOS_ICON_DATA_ATTR = "data-mari-pwa-helper-ios-icon";

const IOS_ICON_SIZE = 180;
const IOS_ICON_PADDING = 18;
const IOS_ICON_GRADIENT = ["#4de5dd", "#eb8951", "#e15c8c"];
const IOS_ICON_LOGO_FILL = "#ffffff";
const IOS_ICON_SOURCE = "/icon-192.png";

// src/client/status.js
function createStatusReporter() {
  function setDatasetValue(key, value) {
    const root = document.documentElement;
    if (!root) return;
    if (value) root.dataset[key] = String(value);
    else delete root.dataset[key];
  }

  function setWakeLockStatus(status, error) {
    setDatasetValue(WAKE_LOCK_DATA_ATTR, status);
    setDatasetValue(WAKE_LOCK_ERROR_ATTR, error ? String(error).slice(0, 160) : "");
  }

  function setGenerationStatus(status) {
    setDatasetValue(GENERATION_DATA_ATTR, status);
  }

  function setIosIconStatus(status) {
    const root = document.documentElement;
    if (!root) return;
    if (status) root.setAttribute(IOS_ICON_DATA_ATTR, status);
    else root.removeAttribute(IOS_ICON_DATA_ATTR);
  }

  return {
    setWakeLockStatus,
    setGenerationStatus,
    setIosIconStatus,
  };
}

// src/client/wake-lock.js
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

// src/client/ios-icon.js
function ensureHeadLink(rel, selector = `link[rel="${rel}"]`) {
  let link = document.head?.querySelector(selector);
  if (!(link instanceof HTMLLinkElement)) {
    link = document.createElement("link");
    link.rel = rel;
    document.head?.appendChild(link);
  }
  return link;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

async function createIosTouchIconUrl() {
  const image = await loadImage(IOS_ICON_SOURCE);
  const canvas = document.createElement("canvas");
  canvas.width = IOS_ICON_SIZE;
  canvas.height = IOS_ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");

  const gradient = context.createLinearGradient(0, 0, IOS_ICON_SIZE, IOS_ICON_SIZE);
  gradient.addColorStop(0, IOS_ICON_GRADIENT[0]);
  gradient.addColorStop(0.52, IOS_ICON_GRADIENT[1]);
  gradient.addColorStop(1, IOS_ICON_GRADIENT[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, IOS_ICON_SIZE, IOS_ICON_SIZE);

  const iconSize = IOS_ICON_SIZE - IOS_ICON_PADDING * 2;
  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = IOS_ICON_SIZE;
  logoCanvas.height = IOS_ICON_SIZE;
  const logoContext = logoCanvas.getContext("2d");
  if (!logoContext) throw new Error("Canvas 2D context is unavailable.");

  logoContext.drawImage(image, IOS_ICON_PADDING, IOS_ICON_PADDING, iconSize, iconSize);
  logoContext.globalCompositeOperation = "source-in";
  logoContext.fillStyle = IOS_ICON_LOGO_FILL;
  logoContext.fillRect(IOS_ICON_PADDING, IOS_ICON_PADDING, iconSize, iconSize);
  context.drawImage(logoCanvas, 0, 0);

  return canvas.toDataURL("image/png");
}

function createIosIconInstaller({ setIosIconStatus, log, warn }) {
  async function install() {
    try {
      const url = await createIosTouchIconUrl();
      const link = ensureHeadLink("apple-touch-icon");
      link.href = url;
      link.sizes = `${IOS_ICON_SIZE}x${IOS_ICON_SIZE}`;
      link.type = "image/png";
      setIosIconStatus("active");
      log("installed iOS touch icon override");
    } catch (error) {
      setIosIconStatus("error");
      warn("failed to install iOS touch icon override", error);
    }
  }

  return { install };
}

// src/client/generation-monitor.js
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

// src/client/runtime.js
function log(...args) {
  let debugEnabled = false;
  try {
    debugEnabled = window.localStorage?.getItem("pwa-helper:debug") === "1";
  } catch {
    debugEnabled = false;
  }
  if (debugEnabled) {
    console.debug(`[${PACKAGE_NAME}]`, ...args);
  }
}

function warn(...args) {
  console.warn(`[${PACKAGE_NAME}]`, ...args);
}

function defineCapabilityElement() {
  if (customElements.get(ELEMENT_TAG)) return;

  class PwaHelperElement extends HTMLElement {
    connectedCallback() {
      this.hidden = true;
      this.setAttribute("aria-hidden", "true");
    }
  }

  customElements.define(ELEMENT_TAG, PwaHelperElement);
}

function installPublicApi(api) {
  try {
    Object.defineProperty(window, PUBLIC_API_KEY, {
      value: api,
      enumerable: false,
      configurable: true,
    });
  } catch {
    window[PUBLIC_API_KEY] = api;
  }

  window.dispatchEvent(new CustomEvent("marinara:pwa-helper-ready", { detail: api }));
}

function createRuntime(bridgeSession) {
  const status = createStatusReporter();
  const wakeLock = createWakeLockController({
    setWakeLockStatus: status.setWakeLockStatus,
    warn,
  });
  const generationMonitor = createGenerationMonitor({
    bridgeGeneration: bridgeSession.generation,
    wakeLock,
    setGenerationStatus: status.setGenerationStatus,
    warn,
  });
  const iosIcon = createIosIconInstaller({
    setIosIconStatus: status.setIosIconStatus,
    log,
    warn,
  });

  const api = Object.freeze({
    id: PACKAGE_ID,
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    wakeLock: Object.freeze({
      hold: wakeLock.hold,
      release: wakeLock.release,
      status: wakeLock.status,
    }),
    generation: Object.freeze({
      detectActive: generationMonitor.detectGenerationActive,
    }),
  });

  function start() {
    iosIcon.install();
    generationMonitor.start();
    void wakeLock.reconcile();
  }

  function destroy() {
    generationMonitor.stop();
    wakeLock.destroy();
    status.setIosIconStatus("");
    status.setWakeLockStatus("", "");
  }

  return { api, start, destroy };
}

function startPwaHelper(bridgeSession) {
  defineCapabilityElement();
  document.documentElement.dataset.mariBridgeConsumerPwa = "ready";

  if (window[RUNTIME_KEY]?.api) {
    installPublicApi(window[RUNTIME_KEY].api);
    return window[RUNTIME_KEY].api;
  }

  const runtime = createRuntime(bridgeSession);
  window[RUNTIME_KEY] = runtime;
  installPublicApi(runtime.api);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runtime.start, { once: true });
  } else {
    runtime.start();
  }

  return runtime.api;
}

function stopPwaHelper() {
  const runtime = window[RUNTIME_KEY];
  if (!runtime) return;
  runtime.destroy();
  delete window[RUNTIME_KEY];
  if (window[PUBLIC_API_KEY] === runtime.api) delete window[PUBLIC_API_KEY];
  delete document.documentElement.dataset.mariBridgeConsumerPwa;
}

const cleanupPwaHelperClient = await activateClientWithMariBridge(
  {
    consumerId: "pwa-helper",
    api: { major: 1, minMinor: 0 },
    require: ["client.bridge-first", "consumer.sessions", "generation.lifecycle", "runtime.health"],
  },
  async (bridgeSession) => {
    startPwaHelper(bridgeSession);
    return stopPwaHelper;
  },
);
