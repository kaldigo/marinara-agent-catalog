(() => {
  "use strict";
  // bridge/composer-dom.js
  // Upstream gap MB-010: packages do not yet have stable client DOM lifecycle,
  // style injection, or text-control helpers for package-owned UI surfaces.

  function createDomScope() {
    const cleanups = [];
    const timers = new Set();

    function cleanup(fn) {
      if (typeof fn === "function") cleanups.push(fn);
      return fn;
    }

    function on(target, type, handler, options) {
      if (!target || typeof target.addEventListener !== "function") return () => {};
      target.addEventListener(type, handler, options);
      return cleanup(() => target.removeEventListener(type, handler, options));
    }

    function observe(target, handler, options) {
      if (!target || typeof MutationObserver !== "function") return null;
      const observer = new MutationObserver(handler);
      observer.observe(target, options);
      cleanup(() => observer.disconnect());
      return observer;
    }

    function timeout(handler, ms) {
      const id = window.setTimeout(() => {
        timers.delete(id);
        handler();
      }, ms);
      timers.add(id);
      return id;
    }

    function clearTimer(id) {
      if (!id) return;
      timers.delete(id);
      window.clearTimeout(id);
    }

    function destroy() {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      while (cleanups.length) {
        try {
          cleanups.pop()?.();
        } catch {}
      }
    }

    return { cleanup, on, observe, timeout, clearTimer, destroy };
  }

  // Injects or updates package-owned CSS with a stable style element ID.
  function injectStyle(id, cssText) {
    const existing = document.getElementById(id);
    if (existing) {
      existing.textContent = cssText;
      return existing;
    }
    const style = document.createElement("style");
    style.id = id;
    style.textContent = cssText;
    document.head.appendChild(style);
    return style;
  }

  // Checks whether a DOM element is currently visible in layout.
  function isVisibleElement(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Updates a text input/textarea through native setters so React-like listeners fire.
  function setTextControlValue(control, value) {
    if (!control) return;
    const proto = control instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Resolves Marinara's active chat ID from URL, DOM markers, local storage, or known stores.
  function getActiveChatIdFromClient() {
    const fromUrl = readChatIdFromLocation();
    if (fromUrl) return fromUrl;
    const selected = document.querySelector('[data-chat-id][class*="sidebar-accent"], [data-chat-id][aria-current="true"]');
    if (selected) return selected.getAttribute("data-chat-id") || "";
    const firstDataChat = document.querySelector("[data-chat-id]");
    if (firstDataChat) return firstDataChat.getAttribute("data-chat-id") || "";
    const fromStore = localStorage.getItem("marinara-active-chat-id");
    if (fromStore) return fromStore;
    const stores = [
      window.useChatStore?.getState?.(),
      window.__MARINARA_CHAT_STORE__?.getState?.(),
      window.__marinara?.chatStore?.getState?.(),
    ];
    for (const store of stores) {
      const id = store?.activeChatId || store?.currentChatId || store?.chatId;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
    return "";
  }

  // Watches active chat changes caused by routing, focus/visibility, DOM, or store updates.
  function watchActiveChatId(callback, options = {}) {
    if (typeof callback !== "function") throw new Error("watchActiveChatId requires a callback.");
    const scope = createDomScope();
    const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 2_000;
    const debounceMs = Number.isFinite(Number(options.debounceMs)) ? Number(options.debounceMs) : 150;
    let activeChatId = "";
    let timer = 0;

    function emitIfChanged() {
      timer = 0;
      const chatId = getActiveChatIdFromClient();
      if (chatId === activeChatId) return;
      activeChatId = chatId;
      callback(chatId);
    }

    function schedule(delayMs = debounceMs) {
      if (timer) scope.clearTimer(timer);
      timer = scope.timeout(emitIfChanged, delayMs);
    }

    scope.cleanup(subscribeHistoryForChatWatcher("pushState", schedule));
    scope.cleanup(subscribeHistoryForChatWatcher("replaceState", schedule));
    scope.on(window, "popstate", () => schedule(0));
    scope.on(window, "focus", () => schedule());
    scope.on(document, "visibilitychange", () => {
      if (!document.hidden) schedule();
    });
    if (document.body) {
      scope.observe(document.body, () => schedule(), {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-chat-id", "aria-current", "class"],
      });
    }
    if (intervalMs > 0) {
      const intervalId = window.setInterval(() => schedule(), intervalMs);
      scope.cleanup(() => window.clearInterval(intervalId));
    }
    if (options.emitInitial !== false) schedule(0);
    return () => scope.destroy();
  }

  function readChatIdFromLocation() {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get("chatId") || url.pathname.match(/\/chats?\/([^/?#]+)/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function subscribeHistoryForChatWatcher(method, schedule) {
    const state = getChatWatcherHistoryState();
    state.watchers[method].add(schedule);
    const original = history[method];
    if (original && !state.patched[method]) {
      state.original[method] = original;
      history[method] = function patchedHistoryMethod(...args) {
        const result = state.original[method].apply(this, args);
        for (const watcher of [...state.watchers[method]]) watcher();
        return result;
      };
      state.patched[method] = true;
    }
    return () => state.watchers[method].delete(schedule);
  }

  function getChatWatcherHistoryState() {
    const key = "__mariBridgeChatWatcherHistoryState";
    if (!window[key]) {
      window[key] = {
        original: {},
        patched: {},
        watchers: {
          pushState: new Set(),
          replaceState: new Set(),
        },
      };
    }
    return window[key];
  }

  // bridge/generation-stream.js
  function parseSsePayloads(text, final = false) {
    const parts = String(text || "").split(/\n\n/u);
    const rest = final ? "" : parts.pop() || "";
    return {
      rest,
      payloads: parts
        .map((frame) =>
          frame
            .split(/\r?\n/u)
            .map((line) => (line.startsWith("data:") ? line.slice(5).trimStart() : ""))
            .filter(Boolean)
            .join("\n"),
        )
        .filter(Boolean),
    };
  }

  function parseSseEventPayload(payload) {
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  async function apiRequest(path, options = {}) {
    const response = await fetch(path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message = typeof data === "object" && data?.error ? data.error : text || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  }

  async function streamJsonSse(path, body, handlers = {}, options = {}) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: JSON.stringify(body || {}),
      signal: options.signal,
    });

    if (!response.ok) {
      let text = "";
      try {
        text = await response.text();
      } catch {}
      throw new Error(text || `Streaming request failed (${response.status})`);
    }
    if (!response.body) throw new Error("Streaming request returned no response body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let carry = "";

    while (true) {
      const next = await reader.read();
      if (next.done) {
        const parsed = parseSsePayloads(carry, true);
        for (const payload of parsed.payloads) emitSsePayload(payload, handlers);
        handlers.onDone?.();
        return;
      }

      const decoded = decoder.decode(next.value, { stream: true });
      const parsed = parseSsePayloads(`${carry}${decoded}`, false);
      carry = parsed.rest;
      for (const payload of parsed.payloads) emitSsePayload(payload, handlers);
    }
  }

  function emitSsePayload(payload, handlers) {
    const event = parseSseEventPayload(payload);
    handlers.onPayload?.(payload, event);
    if (!event || !event.type) return;
    handlers.onEvent?.(event);
    if (event.type === "error") handlers.onErrorEvent?.(event);
    if (event.type === "done") handlers.onDoneEvent?.(event);
    if (event.type === "aborted") handlers.onAbortEvent?.(event);
  }

  // bridge/ui-slots.js
  // Upstream gap MB-010: packages do not yet have stable composer UI slots.

  const UI_SLOT_STATE_KEY = "__mariBridgeUiSlotState";

  const COMPOSER_SLOT_ABOVE_INPUT = "composer:above-input";
  const COMPOSER_SLOT_QUICK_ACTIONS = "composer:quick-actions";

  const KNOWN_COMPOSER_SLOTS = new Set([COMPOSER_SLOT_ABOVE_INPUT, COMPOSER_SLOT_QUICK_ACTIONS]);

  // Registers package-owned UI with a bridge-managed composer slot.
  function registerComposerSlotContribution(contribution) {
    const normalized = normalizeSlotContribution(contribution);
    const state = getUiSlotState();
    state.contributions.set(normalized.key, normalized);
    ensureComposerSlotBridge();
    scheduleComposerSlotRender();
    return () => {
      const current = state.contributions.get(normalized.key);
      if (current !== normalized) return;
      state.contributions.delete(normalized.key);
      unmountContribution(state, normalized.key);
      scheduleComposerSlotRender();
    };
  }

  // Starts DOM observation for composer slots. Registration calls this automatically.
  function ensureComposerSlotBridge(options = {}) {
    const state = getUiSlotState();
    if (state.started) return state;
    state.started = true;
    state.scope = createDomScope();
    state.renderDelayMs = Number.isFinite(Number(options.renderDelayMs)) ? Number(options.renderDelayMs) : 80;
    if (document.readyState === "loading") {
      state.scope.on(document, "DOMContentLoaded", () => startComposerSlotObservation(state), { once: true });
    } else {
      startComposerSlotObservation(state);
    }
    return state;
  }

  // Forces a bridge slot render pass after a package changes its own state.
  function scheduleComposerSlotRender(delayMs) {
    const state = getUiSlotState();
    if (state.renderTimer) state.scope?.clearTimer?.(state.renderTimer);
    const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : state.renderDelayMs;
    state.renderTimer = (state.scope || createDomScope()).timeout(() => {
      state.renderTimer = 0;
      renderComposerSlots(state);
    }, delay);
  }

  // Returns the active composer pieces that bridge slot renderers receive.
  function findActiveComposerContext() {
    const root = findActiveChatComposer();
    const textarea = root?.querySelector("textarea.mari-chat-input-textarea, textarea") || null;
    const sendButton = root?.querySelector("button.mari-chat-send-btn, button[title='Send'], button[aria-label='Send']") || null;
    return {
      root,
      textarea,
      sendButton,
      chatId: getActiveChatIdFromClient(),
    };
  }

  function getUiSlotState() {
    if (!window[UI_SLOT_STATE_KEY]) {
      window[UI_SLOT_STATE_KEY] = {
        started: false,
        scope: null,
        observer: null,
        renderTimer: 0,
        renderDelayMs: 80,
        activeRoot: null,
        contributions: new Map(),
        mounted: new Map(),
      };
    }
    return window[UI_SLOT_STATE_KEY];
  }

  function startComposerSlotObservation(state) {
    state.scope.on(window, "focus", () => scheduleComposerSlotRender(0));
    state.scope.on(window, "resize", () => scheduleComposerSlotRender());
    state.scope.on(window, "popstate", () => scheduleComposerSlotRender(0));
    state.scope.on(window, "mari-bridge:generation-state", () => scheduleComposerSlotRender());
    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    if (document.body) {
      state.observer = state.scope.observe(
        document.body,
        () => scheduleComposerSlotRender(),
        { childList: true, subtree: true },
      );
    }
    scheduleComposerSlotRender(0);
  }

  function renderComposerSlots(state) {
    const context = findActiveComposerContext();
    if (!context.root) {
      unmountAll(state);
      state.activeRoot = null;
      return;
    }
    if (state.activeRoot && state.activeRoot !== context.root) unmountAll(state);
    state.activeRoot = context.root;

    const slotHosts = ensureSlotHosts(context);
    const contributions = [...state.contributions.values()]
      .filter((entry) => KNOWN_COMPOSER_SLOTS.has(entry.slot))
      .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
    const visibleKeys = new Set();

    for (const contribution of contributions) {
      const slotHost = slotHosts[contribution.slot];
      if (!slotHost || contribution.shouldShow(context) === false) {
        unmountContribution(state, contribution.key);
        continue;
      }
      visibleKeys.add(contribution.key);
      mountOrUpdateContribution(state, contribution, slotHost, context);
    }

    for (const key of [...state.mounted.keys()]) {
      if (!visibleKeys.has(key)) unmountContribution(state, key);
    }
  }

  function ensureSlotHosts(context) {
    return {
      [COMPOSER_SLOT_ABOVE_INPUT]: ensureAboveInputHost(context.root),
      [COMPOSER_SLOT_QUICK_ACTIONS]: ensureQuickActionsHost(context.root, context.sendButton),
    };
  }

  function ensureAboveInputHost(root) {
    let host = root.querySelector(":scope > [data-mari-bridge-slot='composer:above-input']");
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("div");
      host.dataset.mariBridgeSlot = COMPOSER_SLOT_ABOVE_INPUT;
      host.className = "mari-bridge-slot mari-bridge-slot-above-input";
      root.insertBefore(host, root.firstChild);
    }
    return host;
  }

  function ensureQuickActionsHost(root, sendButton) {
    let host = root.querySelector(":scope [data-mari-bridge-slot='composer:quick-actions']");
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("span");
      host.dataset.mariBridgeSlot = COMPOSER_SLOT_QUICK_ACTIONS;
      host.className = "mari-bridge-slot mari-bridge-slot-quick-actions";
    }
    const targetParent = sendButton?.parentElement || root;
    if (host.parentElement !== targetParent) {
      targetParent.insertBefore(host, sendButton || null);
    } else if (sendButton && host.nextElementSibling !== sendButton) {
      targetParent.insertBefore(host, sendButton);
    }
    return host;
  }

  function mountOrUpdateContribution(state, contribution, slotHost, context) {
    let mounted = state.mounted.get(contribution.key);
    const needsRender = !mounted || mounted.slotHost !== slotHost;
    if (needsRender) {
      unmountContribution(state, contribution.key);
      const host = document.createElement("span");
      host.dataset.mariBridgeContribution = contribution.key;
      host.dataset.mariBridgePackageId = contribution.packageId;
      host.dataset.mariBridgeContributionId = contribution.id;
      host.className = "mari-bridge-slot-contribution";
      const rendered = contribution.render({ ...context, slot: contribution.slot, host, slotHost });
      const node = rendered instanceof Node ? rendered : host;
      if (node !== host) host.appendChild(node);
      slotHost.appendChild(host);
      mounted = { host, node, slotHost, cleanup: null };
      state.mounted.set(contribution.key, mounted);
    }
    const cleanup = contribution.update?.({ ...context, slot: contribution.slot, host: mounted.host, node: mounted.node, slotHost });
    if (typeof cleanup === "function") mounted.cleanup = cleanup;
  }

  function unmountContribution(state, key) {
    const mounted = state.mounted.get(key);
    if (!mounted) return;
    state.mounted.delete(key);
    try {
      mounted.cleanup?.();
    } catch {}
    mounted.host?.remove();
  }

  function unmountAll(state) {
    for (const key of [...state.mounted.keys()]) unmountContribution(state, key);
  }

  function normalizeSlotContribution(contribution) {
    const packageId = String(contribution?.packageId || "").trim();
    const id = String(contribution?.id || "").trim();
    const slot = String(contribution?.slot || "").trim();
    if (!packageId) throw new Error("Composer slot contribution requires packageId.");
    if (!id) throw new Error("Composer slot contribution requires id.");
    if (!KNOWN_COMPOSER_SLOTS.has(slot)) throw new Error(`Unknown composer slot: ${slot || "(missing)"}`);
    if (typeof contribution.render !== "function") throw new Error(`Composer slot contribution ${packageId}:${id} requires render().`);
    return {
      packageId,
      id,
      key: `${packageId}:${id}`,
      slot,
      priority: Number.isFinite(Number(contribution.priority)) ? Number(contribution.priority) : 100,
      shouldShow: typeof contribution.shouldShow === "function" ? contribution.shouldShow : () => true,
      render: contribution.render,
      update: typeof contribution.update === "function" ? contribution.update : null,
    };
  }

  function findActiveChatComposer() {
    const candidates = Array.from(
      document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input, .chat-input-container"),
    );
    return candidates.find((root) => root instanceof HTMLElement && root.querySelector("textarea") && isVisibleElement(root)) || null;
  }

  function patchHistoryMethod(method) {
    const original = history[method];
    if (!original || original.__mariBridgeUiSlotPatched) return;
    const patched = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      scheduleComposerSlotRender(0);
      return result;
    };
    patched.__mariBridgeUiSlotPatched = true;
    history[method] = patched;
  }

  // bridge/generation-lifecycle.js
  // Upstream gap MB-011: packages do not yet have stable generation lifecycle hooks.

  const GENERATION_STATE_KEY = "__mariBridgeGenerationState";
  const NATIVE_MAIN_SOURCE_ID = "marinara:native-main";

  const GENERATION_KIND_MAIN = "main";
  const GENERATION_KIND_AGENT = "agent";
  const GENERATION_STATE_EVENT = "mari-bridge:generation-state";
  const GENERATING_MAIN_EVENT = "mari-bridge:generating-main";
  const GENERATING_AGENT_EVENT = "mari-bridge:generating-agent";

  // Starts native generation tracking and bridge event emission.
  function ensureGenerationLifecycleBridge(options = {}) {
    const state = getGenerationState();
    state.nativeTracking = options.nativeTracking !== false;
    if (state.started) return state;
    state.started = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => startGenerationObservation(state), { once: true });
    } else {
      startGenerationObservation(state);
    }
    return state;
  }

  // Declares package-owned generation activity; callers must call end(), error(), or abort().
  function declarePackageGeneration(input = {}) {
    ensureGenerationLifecycleBridge();
    const state = getGenerationState();
    const entry = normalizeGenerationEntry(input);
    state.active.set(entry.key, entry);
    let lock = null;
    if (entry.lockComposer) {
      lock = createComposerGenerationLock({
        packageId: entry.packageId,
        chatId: entry.chatId,
        runId: entry.runId,
        reason: entry.reason,
        abort: () => controller.abort(),
      });
    }
    const controller = {
      runId: entry.runId,
      end: (detail = {}) => finishDeclaredGeneration(entry.key, "complete", detail, lock),
      error: (error) => finishDeclaredGeneration(entry.key, "error", { error: errorMessage(error) }, lock),
      abort: () => {
        try {
          entry.abort?.();
        } catch {}
        finishDeclaredGeneration(entry.key, "aborted", {}, lock);
      },
    };
    emitGenerationSnapshot(state, entry, true, "started");
    return controller;
  }

  // Streams /api/generate/dryRun with bridge generation events and optional composer locking.
  async function streamBridgeDryRunGeneration(input = {}) {
    const declaration = declarePackageGeneration({
      packageId: input.packageId,
      id: input.id || "dry-run",
      kind: input.kind || GENERATION_KIND_AGENT,
      chatId: input.chatId || input.body?.chatId || "",
      reason: input.reason || "dry-run",
      lockComposer: input.lockComposer === true,
      abort: input.abort,
    });
    try {
      const result = await streamJsonSse(input.path || "/api/generate/dryRun", input.body || {}, input.handlers || {}, {
        signal: input.signal,
        headers: input.headers,
      });
      declaration.end();
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") declaration.abort();
      else declaration.error(error);
      throw error;
    }
  }

  // Calls /api/generate/raw with bridge generation events and optional composer locking.
  async function callBridgeRawGeneration(input = {}) {
    const declaration = declarePackageGeneration({
      packageId: input.packageId,
      id: input.id || "raw",
      kind: input.kind || GENERATION_KIND_AGENT,
      chatId: input.chatId || input.body?.chatId || "",
      reason: input.reason || "raw",
      lockComposer: input.lockComposer === true,
      abort: input.abort,
    });
    try {
      const result = await apiRequest(input.path || "/generate/raw", {
        method: input.method || "POST",
        headers: input.headers,
        body: JSON.stringify(input.body || {}),
        signal: input.signal,
      });
      declaration.end();
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") declaration.abort();
      else declaration.error(error);
      throw error;
    }
  }

  // Temporarily disables the composer and turns the send button into a Stop control.
  function createComposerGenerationLock(input = {}) {
    const context = findActiveComposerContext();
    const textarea = context.textarea;
    const sendButton = context.sendButton;
    const original = {
      textareaDisabled: textarea?.disabled,
      sendDisabled: sendButton?.disabled,
      sendAriaDisabled: sendButton?.getAttribute("aria-disabled"),
      sendTitle: sendButton?.getAttribute("title"),
      sendAriaLabel: sendButton?.getAttribute("aria-label"),
    };
    const onStop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      input.abort?.();
    };

    if (textarea) textarea.disabled = true;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.removeAttribute("aria-disabled");
      sendButton.setAttribute("title", "Stop generating");
      sendButton.setAttribute("aria-label", "Stop generating");
      sendButton.classList.add("mari-bridge-generation-stop");
      sendButton.addEventListener("click", onStop, true);
    }

    return () => {
      if (textarea && original.textareaDisabled !== undefined) textarea.disabled = original.textareaDisabled;
      if (sendButton) {
        sendButton.disabled = original.sendDisabled ?? false;
        restoreAttribute(sendButton, "aria-disabled", original.sendAriaDisabled);
        restoreAttribute(sendButton, "title", original.sendTitle);
        restoreAttribute(sendButton, "aria-label", original.sendAriaLabel);
        sendButton.classList.remove("mari-bridge-generation-stop");
        sendButton.removeEventListener("click", onStop, true);
      }
    };
  }

  // Lets listeners query the current bridge generation snapshot.
  function getBridgeGenerationSnapshot() {
    const state = getGenerationState();
    return buildSnapshot(state);
  }

  function getGenerationState() {
    if (!window[GENERATION_STATE_KEY]) {
      window[GENERATION_STATE_KEY] = {
        started: false,
        nativeTracking: true,
        active: new Map(),
        nativeActive: false,
        observer: null,
        syncTimer: 0,
      };
    }
    return window[GENERATION_STATE_KEY];
  }

  function startGenerationObservation(state) {
    if (state.nativeTracking) {
      document.addEventListener("click", () => scheduleNativeGenerationSync(state), true);
      window.addEventListener("focus", () => scheduleNativeGenerationSync(state));
      window.addEventListener("pageshow", () => scheduleNativeGenerationSync(state));
      window.addEventListener("marinara:generation-complete", () => setNativeMainActive(state, false, "complete"));
      window.addEventListener("marinara:generation-error", () => setNativeMainActive(state, false, "error"));
      if (document.body) {
        state.observer = new MutationObserver(() => scheduleNativeGenerationSync(state));
        state.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-label", "title", "class", "disabled"],
        });
      }
      scheduleNativeGenerationSync(state, 0);
    }
  }

  function scheduleNativeGenerationSync(state, delay = 80) {
    if (state.syncTimer) window.clearTimeout(state.syncTimer);
    state.syncTimer = window.setTimeout(() => {
      state.syncTimer = 0;
      setNativeMainActive(state, detectNativeMainGenerationActive(), "detected");
    }, delay);
  }

  function setNativeMainActive(state, active, reason) {
    if (state.nativeActive === active) return;
    state.nativeActive = active;
    const entry = {
      key: NATIVE_MAIN_SOURCE_ID,
      packageId: "marinara",
      id: "native-main",
      kind: GENERATION_KIND_MAIN,
      chatId: "",
      runId: NATIVE_MAIN_SOURCE_ID,
      reason,
    };
    if (active) state.active.set(entry.key, entry);
    else state.active.delete(entry.key);
    emitGenerationSnapshot(state, entry, active, reason);
  }

  function detectNativeMainGenerationActive() {
    return collectCandidateButtons().some(isGenerationStopButton);
  }

  function collectCandidateButtons() {
    const buttons = new Set();
    document
      .querySelectorAll(".mari-chat-input button, .chat-input-container button, button.mari-chat-send-btn")
      .forEach((button) => buttons.add(button));
    document
      .querySelectorAll("button[title*='Stop' i], button[aria-label*='Stop' i]")
      .forEach((button) => buttons.add(button));
    return [...buttons];
  }

  function isGenerationStopButton(button) {
    if (!(button instanceof HTMLButtonElement) || !button.isConnected) return false;
    const label = [button.getAttribute("title"), button.getAttribute("aria-label"), button.textContent]
      .filter(Boolean)
      .join(" ");
    if (/\bstop\s+generat(?:e|ing|ion)\b/i.test(label)) return true;
    const inChatInput = Boolean(button.closest(".mari-chat-input, .chat-input-container"));
    if (!inChatInput && !button.classList.contains("mari-chat-send-btn")) return false;
    const svg = button.querySelector("svg");
    if (!svg) return false;
    const className = svg.getAttribute("class") || "";
    return /\b(lucide-)?(circle-stop|stop-circle)\b/i.test(className) || Boolean(svg.querySelector("circle") && svg.querySelector("rect"));
  }

  function finishDeclaredGeneration(key, status, detail, lock) {
    const state = getGenerationState();
    const entry = state.active.get(key);
    if (!entry) return;
    state.active.delete(key);
    try {
      lock?.();
    } catch {}
    emitGenerationSnapshot(state, entry, false, status, detail);
  }

  function emitGenerationSnapshot(state, entry, active, status, detail = {}) {
    const snapshot = buildSnapshot(state);
    const eventDetail = {
      active,
      status,
      source: entry,
      snapshot,
      ...detail,
    };
    window.dispatchEvent(new CustomEvent(GENERATION_STATE_EVENT, { detail: eventDetail }));
    window.dispatchEvent(
      new CustomEvent(entry.kind === GENERATION_KIND_MAIN ? GENERATING_MAIN_EVENT : GENERATING_AGENT_EVENT, {
        detail: eventDetail,
      }),
    );
  }

  function buildSnapshot(state) {
    const active = [...state.active.values()];
    return {
      active,
      mainActive: active.some((entry) => entry.kind === GENERATION_KIND_MAIN),
      agentActive: active.some((entry) => entry.kind === GENERATION_KIND_AGENT),
    };
  }

  function normalizeGenerationEntry(input) {
    const packageId = String(input.packageId || "").trim();
    const id = String(input.id || "").trim();
    if (!packageId) throw new Error("Generation declaration requires packageId.");
    if (!id) throw new Error("Generation declaration requires id.");
    const runId = String(input.runId || `${packageId}:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
    const kind = input.kind === GENERATION_KIND_MAIN ? GENERATION_KIND_MAIN : GENERATION_KIND_AGENT;
    return {
      key: `${packageId}:${id}:${runId}`,
      packageId,
      id,
      kind,
      chatId: typeof input.chatId === "string" ? input.chatId : "",
      runId,
      reason: typeof input.reason === "string" ? input.reason : "",
      lockComposer: input.lockComposer === true,
      abort: typeof input.abort === "function" ? input.abort : null,
    };
  }

  function restoreAttribute(element, name, value) {
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/client/constants.js
  const PACKAGE_ID = "pwa-helper";
  const PACKAGE_NAME = "PWA Helper";
  const PACKAGE_VERSION = "1.0.1";
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
