(() => {
  "use strict";
  // src/client/constants.js
  const PACKAGE_ID = "pwa-helper";
  const PACKAGE_NAME = "PWA Helper";
  const PACKAGE_VERSION = "1.0.0";
  const ELEMENT_TAG = "marinara-capability-pwa-helper";
  const RUNTIME_KEY = "__marinaraPwaHelperRuntime";
  const PUBLIC_API_KEY = "marinaraPwaHelper";

  const WAKE_LOCK_DATA_ATTR = "mariPwaHelperWakeLock";
  const WAKE_LOCK_ERROR_ATTR = "mariPwaHelperWakeLockError";
  const GENERATION_DATA_ATTR = "mariPwaHelperGeneration";
  const IOS_ICON_DATA_ATTR = "data-mari-pwa-helper-ios-icon";

  const SYNC_DELAY_MS = 80;
  const GENERATION_END_RESYNC_MS = 180;
  const POLL_INTERVAL_MS = 2500;

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
  function isVisibleElement(element) {
    if (!element || !(element instanceof Element)) return false;
    if (!element.getClientRects().length) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function buttonLabel(button) {
    return [
      button.getAttribute("title"),
      button.getAttribute("aria-label"),
      button.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function hasStopIcon(button) {
    const svg = button.querySelector("svg");
    if (!svg) return false;

    const className = svg.getAttribute("class") || "";
    if (/\b(lucide-)?(circle-stop|stop-circle)\b/i.test(className)) return true;

    return Boolean(svg.querySelector("circle") && svg.querySelector("rect"));
  }

  function isGenerationStopButton(button) {
    if (!(button instanceof HTMLButtonElement) || !isVisibleElement(button)) return false;

    const label = buttonLabel(button);
    if (/\bstop\s+generat(?:e|ing|ion)\b/i.test(label)) return true;

    const inChatInput = Boolean(button.closest(".mari-chat-input, .chat-input-container"));
    if (!inChatInput && !button.classList.contains("mari-chat-send-btn")) return false;

    return hasStopIcon(button);
  }

  function collectCandidateButtons() {
    const buttons = new Set();
    document
      .querySelectorAll(".mari-chat-input button, .chat-input-container button, button.mari-chat-send-btn")
      .forEach((button) => buttons.add(button));
    document
      .querySelectorAll("button[title*='Stop' i], button[aria-label*='Stop' i]")
      .forEach((button) => buttons.add(button));
    return Array.from(buttons);
  }

  function detectGenerationActive() {
    return collectCandidateButtons().some(isGenerationStopButton);
  }

  function createGenerationMonitor({ wakeLock, setGenerationStatus }) {
    const state = {
      active: false,
      lease: null,
      syncTimer: null,
      pollTimer: null,
      observer: null,
      cleanups: [],
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
        id: `${PACKAGE_ID}:native-generation`,
        source: PACKAGE_NAME,
        reason: "native-generation",
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

    function sync() {
      state.syncTimer = null;
      setActive(detectGenerationActive());
    }

    function scheduleSync(delay = SYNC_DELAY_MS) {
      if (state.syncTimer) return;
      state.syncTimer = window.setTimeout(sync, delay);
    }

    function onGenerationEndEvent() {
      if (!detectGenerationActive()) setActive(false);
      scheduleSync(GENERATION_END_RESYNC_MS);
    }

    function addListener(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      state.cleanups.push(() => target.removeEventListener(type, listener, options));
    }

    function observeBody() {
      if (!document.body || state.observer) return;
      state.observer = new MutationObserver(() => scheduleSync());
      state.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "title", "class", "disabled"],
      });
    }

    function start() {
      if (state.pollTimer) return;

      addListener(document, "visibilitychange", () => {
        void wakeLock.reconcile();
        if (document.visibilityState === "visible") scheduleSync();
      });
      addListener(window, "pageshow", () => scheduleSync());
      addListener(window, "focus", () => scheduleSync());
      addListener(document, "click", () => scheduleSync(), true);
      addListener(window, "marinara:generation-complete", onGenerationEndEvent);
      addListener(window, "marinara:generation-error", onGenerationEndEvent);

      state.pollTimer = window.setInterval(() => scheduleSync(), POLL_INTERVAL_MS);
      observeBody();
      scheduleSync();
    }

    function stop() {
      if (state.syncTimer) window.clearTimeout(state.syncTimer);
      if (state.pollTimer) window.clearInterval(state.pollTimer);
      state.syncTimer = null;
      state.pollTimer = null;
      state.cleanups.splice(0).forEach((cleanup) => cleanup());
      state.observer?.disconnect();
      state.observer = null;
      setActive(false);
      setGenerationStatus("");
    }

    return {
      start,
      stop,
      detectGenerationActive,
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

  function createRuntime() {
    const status = createStatusReporter();
    const wakeLock = createWakeLockController({
      setWakeLockStatus: status.setWakeLockStatus,
      warn,
    });
    const generationMonitor = createGenerationMonitor({
      wakeLock,
      setGenerationStatus: status.setGenerationStatus,
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

  function startPwaHelper() {
    defineCapabilityElement();

    if (window[RUNTIME_KEY]?.api) {
      installPublicApi(window[RUNTIME_KEY].api);
      return window[RUNTIME_KEY].api;
    }

    const runtime = createRuntime();
    window[RUNTIME_KEY] = runtime;
    installPublicApi(runtime.api);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runtime.start, { once: true });
    } else {
      runtime.start();
    }

    return runtime.api;
  }

  startPwaHelper();
})();
