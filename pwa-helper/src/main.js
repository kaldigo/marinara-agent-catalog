(() => {
  "use strict";

  const DATA_ATTR = "mariPwaHelperWakeLock";
  const ERROR_ATTR = "mariPwaHelperWakeLockError";
  const SYNC_DELAY_MS = 80;
  const IOS_ICON_SIZE = 180;
  const IOS_ICON_PADDING = 18;
  const IOS_ICON_GRADIENT = ["#4de5dd", "#eb8951", "#e15c8c"];
  const IOS_ICON_LOGO_FILL = "#ffffff";
  const IOS_ICON_SOURCE = "/icon-192.png";

  const state = {
    generationActive: false,
    generationLease: null,
    syncTimer: null,
    bodyObserver: null,
    registration: null,
    appleTouchIconUrl: "",
    debug: false,
  };

  function log(...args) {
    if (state.debug) console.debug("[PWA Helper]", ...args);
  }

  function warn(...args) {
    console.warn("[PWA Helper]", ...args);
  }

  function setStatus(status, error) {
    const root = document.documentElement;
    if (!root) return;
    if (status) root.dataset[DATA_ATTR] = status;
    else delete root.dataset[DATA_ATTR];
    if (error) root.dataset[ERROR_ATTR] = String(error).slice(0, 160);
    else delete root.dataset[ERROR_ATTR];
  }

  function factory() {
    return window.alDenteFactory || null;
  }

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

  async function installIosTouchIcon() {
    try {
      const url = await createIosTouchIconUrl();
      state.appleTouchIconUrl = url;
      const link = ensureHeadLink("apple-touch-icon");
      link.href = url;
      link.sizes = `${IOS_ICON_SIZE}x${IOS_ICON_SIZE}`;
      link.type = "image/png";
      document.documentElement?.setAttribute?.("data-mari-pwa-helper-ios-icon", "active");
      log("installed iOS touch icon override");
    } catch (error) {
      document.documentElement?.setAttribute?.("data-mari-pwa-helper-ios-icon", "error");
      warn("failed to install iOS touch icon override", error);
    }
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!el.getClientRects().length) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function getLabel(button) {
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

    // Marinara's roleplay input currently renders the stop state as a Lucide
    // StopCircle icon without title/aria text on the button.
    return Boolean(svg.querySelector("circle") && svg.querySelector("rect"));
  }

  function isGenerationStopButton(button) {
    if (!(button instanceof HTMLButtonElement) || !isVisible(button)) return false;

    const label = getLabel(button);
    if (/\bstop\s+generat(?:e|ing|ion)\b/i.test(label)) return true;

    const inChatInput = Boolean(button.closest(".mari-chat-input, .chat-input-container"));
    if (!inChatInput && !button.classList.contains("mari-chat-send-btn")) return false;

    return hasStopIcon(button);
  }

  function collectCandidateButtons() {
    const buttons = new Set();
    document.querySelectorAll(".mari-chat-input button, .chat-input-container button, button.mari-chat-send-btn")
      .forEach((button) => buttons.add(button));
    document.querySelectorAll("button[title*='Stop' i], button[aria-label*='Stop' i]")
      .forEach((button) => buttons.add(button));
    return Array.from(buttons);
  }

  function detectGenerationActive() {
    return collectCandidateButtons().some(isGenerationStopButton);
  }

  function releaseGenerationLease() {
    if (!state.generationLease) return;
    try {
      state.generationLease.release();
    } finally {
      state.generationLease = null;
    }
  }

  function holdGenerationLease() {
    if (state.generationLease) return;
    const wakeLock = factory()?.wakeLock;
    if (!wakeLock || typeof wakeLock.hold !== "function") {
      setStatus("error", "alDenteFactory wake lock surface is unavailable.");
      warn("alDenteFactory wake lock surface is unavailable.");
      return;
    }
    state.generationLease = wakeLock.hold({
      id: "pwa-helper:native-generation",
      source: "PWA Helper",
      reason: "native-generation",
    });
  }

  function syncGenerationState() {
    state.syncTimer = null;
    const active = detectGenerationActive();
    if (active === state.generationActive) {
      if (active) holdGenerationLease();
      return;
    }

    state.generationActive = active;
    if (active) holdGenerationLease();
    else releaseGenerationLease();
  }

  function scheduleSync() {
    if (state.syncTimer) return;
    state.syncTimer = marinara.setTimeout(syncGenerationState, SYNC_DELAY_MS);
  }

  function observeBody() {
    if (!document.body || state.bodyObserver) return;
    state.bodyObserver = marinara.observe(document.body, scheduleSync, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "class", "disabled"],
    });
  }

  marinara.on(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync();
  });

  marinara.on(window, "pageshow", scheduleSync);
  marinara.on(window, "focus", scheduleSync);
  marinara.on(document, "click", scheduleSync);
  marinara.setInterval(scheduleSync, 2500);

  marinara.onCleanup(() => {
    if (state.syncTimer) clearTimeout(state.syncTimer);
    state.generationActive = false;
    releaseGenerationLease();
    state.registration?.unregister?.();
    state.registration = null;
    document.documentElement?.removeAttribute?.("data-mari-pwa-helper-ios-icon");
    setStatus("", "");
  });

  state.registration = factory()?.registerExtension?.({
    id: "pwa-helper",
    name: "PWA Helper",
    version: "0.1.0",
    capabilities: ["wake-lock"],
  }) || null;

  if (document.readyState === "loading") {
    marinara.on(document, "DOMContentLoaded", () => {
      installIosTouchIcon();
      observeBody();
      scheduleSync();
    });
  } else {
    installIosTouchIcon();
    observeBody();
    scheduleSync();
  }
})();
