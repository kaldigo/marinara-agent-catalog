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
