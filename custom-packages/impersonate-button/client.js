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
    const shell = findActiveInputShell(root);
    const scope = shell || root;
    const textarea = scope?.querySelector("textarea.mari-chat-input-textarea, textarea") || null;
    const sendButton = findComposerSendButton(scope);
    return {
      root,
      shell,
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
      [COMPOSER_SLOT_QUICK_ACTIONS]: ensureQuickActionsHost(context),
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

  function ensureQuickActionsHost(context) {
    const menu = findOpenQuickActionsMenu(context);
    if (!menu) return null;
    let host = menu.querySelector(":scope > [data-mari-bridge-slot='composer:quick-actions']");
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("span");
      host.dataset.mariBridgeSlot = COMPOSER_SLOT_QUICK_ACTIONS;
      host.className = "mari-bridge-slot mari-bridge-slot-quick-actions";
    }
    if (host.parentElement !== menu) menu.appendChild(host);
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
    const shells = Array.from(document.querySelectorAll(".marinara-chat-input-shell, .mari-chat-input-box"));
    const activeShell = shells.find((shell) => shell instanceof HTMLElement && shell.querySelector("textarea") && isVisibleElement(shell));
    if (activeShell instanceof HTMLElement) {
      return (
        activeShell.closest(".mari-chat-input.chat-input-container, .mari-chat-input, .chat-input-container") ||
        activeShell
      );
    }
    const candidates = Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input, .chat-input-container"));
    return candidates.find((root) => root instanceof HTMLElement && root.querySelector("textarea") && isVisibleElement(root)) || null;
  }

  function findActiveInputShell(root) {
    if (!root) return null;
    if (root.matches?.(".marinara-chat-input-shell, .mari-chat-input-box")) return root;
    return (
      Array.from(root.querySelectorAll(".marinara-chat-input-shell, .mari-chat-input-box")).find((shell) =>
        shell.querySelector("textarea"),
      ) ||
      root.querySelector("textarea")?.closest(".marinara-chat-input-shell, .mari-chat-input-box") ||
      null
    );
  }

  function findComposerSendButton(scope) {
    if (!scope) return null;
    return (
      scope.querySelector("button.mari-chat-send-btn") ||
      Array.from(scope.querySelectorAll("button[aria-label], button[title]")).find((button) => {
        const text = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
        return /\b(send|stop|retry|continue)\b/i.test(text);
      }) ||
      Array.from(scope.querySelectorAll("button")).reverse().find((button) => button instanceof HTMLButtonElement) ||
      null
    );
  }

  function findOpenQuickActionsMenu(context) {
    const shell = context.shell || context.root;
    const menus = Array.from(document.querySelectorAll('[role="menu"][aria-label="Quick replies"]'));
    return (
      menus.find((menu) => {
        if (!(menu instanceof HTMLElement) || !isVisibleElement(menu)) return false;
        const triggerRoot = menu.closest(".relative, .hidden, .sm\\:block") || menu.parentElement;
        return Boolean(triggerRoot && shell?.contains(triggerRoot));
      }) || null
    );
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

  // bridge/fetch-intercept.js
  // Upstream gap MB-011: packages do not yet have a first-class client-side
  // generate request observation/mutation hook.

  const FETCH_INTERCEPT_STATE_KEY = "__mariBridgeFetchInterceptState";

  function getApiPath(input) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      return new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/u, "") || "/";
    } catch {
      return "";
    }
  }

  function classifyApiRequest(input) {
    const pathname = getApiPath(input);
    if (pathname === "/api/generate") return { kind: "generate", route: "generate", pathname };
    if (pathname === "/api/generate/dryRun") return { kind: "generate", route: "generate:dry-run", pathname };
    if (pathname === "/api/generate/raw") return { kind: "generate", route: "generate:raw", pathname };
    const messageMatch = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/u);
    if (messageMatch) {
      return { kind: "message:create", route: "message:create", chatId: decodeURIComponent(messageMatch[1]), pathname };
    }
    return { kind: "other", route: "other", pathname };
  }

  function parseJsonFetchBody(init) {
    if (typeof init?.body !== "string") return null;
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }

  function cloneFetchInitWithJsonBody(input, init, body) {
    const nextInit = { ...(init || {}) };
    nextInit.method = String(nextInit.method || (typeof input !== "string" ? input?.method : "") || "POST");
    nextInit.body = JSON.stringify(body);
    const headers = new Headers(nextInit.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    nextInit.headers = headers;
    return nextInit;
  }

  function installFetchInterceptor(definition = {}) {
    const id = typeof definition.id === "string" && definition.id.trim() ? definition.id.trim() : "";
    if (!id) throw new Error("installFetchInterceptor requires an id.");
    if (typeof definition.handler !== "function") throw new Error(`Fetch interceptor "${id}" requires a handler.`);

    const state = fetchInterceptState();
    state.interceptors.set(id, {
      id,
      priority: Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : 100,
      match: typeof definition.match === "function" ? definition.match : null,
      route: typeof definition.route === "string" ? definition.route : "",
      handler: definition.handler,
    });
    installFetchPatch(state);

    return () => {
      const current = state.interceptors.get(id);
      if (current?.handler === definition.handler) state.interceptors.delete(id);
    };
  }

  function fetchInterceptState() {
    if (!window[FETCH_INTERCEPT_STATE_KEY]) {
      window[FETCH_INTERCEPT_STATE_KEY] = {
        originalFetch: null,
        patchedFetch: null,
        interceptors: new Map(),
      };
    }
    return window[FETCH_INTERCEPT_STATE_KEY];
  }

  function installFetchPatch(state) {
    if (state.patchedFetch && window.fetch === state.patchedFetch) return;
    if (typeof state.originalFetch !== "function") state.originalFetch = window.fetch.bind(window);
    state.patchedFetch = (input, init = {}) => runFetchPipeline(state, input, init);
    window.fetch = state.patchedFetch;
  }

  async function runFetchPipeline(state, input, init = {}) {
    const stack = Array.from(state.interceptors.values())
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .filter((entry) => fetchInterceptorMatches(entry, input, init));
    const baseFetch = state.originalFetch || window.fetch.bind(window);

    const dispatch = async (index, currentInput, currentInit) => {
      const entry = stack[index];
      if (!entry) return baseFetch(currentInput, currentInit);
      let nextCalled = false;
      const context = buildFetchContext(currentInput, currentInit, baseFetch);
      const next = async (nextInput = currentInput, nextInit = currentInit) => {
        if (nextCalled) throw new Error(`Fetch interceptor "${entry.id}" called next() more than once.`);
        nextCalled = true;
        return dispatch(index + 1, nextInput, nextInit);
      };
      return entry.handler(context, next);
    };

    return dispatch(0, input, init);
  }

  function fetchInterceptorMatches(entry, input, init) {
    const context = buildFetchContext(input, init, window.fetch);
    if (entry.match) return entry.match(context) === true;
    if (entry.route) return entry.route === context.route.route || entry.route === context.route.kind;
    return true;
  }

  function buildFetchContext(input, init, fetchOriginal) {
    return {
      input,
      init,
      method: String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase(),
      route: classifyApiRequest(input),
      body: parseJsonFetchBody(init),
      cloneInitWithJsonBody: (body) => cloneFetchInitWithJsonBody(input, init, body),
      fetchOriginal,
    };
  }

  // src/client/constants.js
  const PACKAGE_ID = "impersonate-button";
  const PACKAGE_NAME = "Impersonate Button";
  const PACKAGE_VERSION = "1.0.0";
  const RUNTIME_KEY = "__marinaraImpersonateButtonPackageRuntime";
  const PUBLIC_API_KEY = "__marinaraImpersonateButton";
  const STYLE_ID = "marinara-impersonate-button-style";
  const ROOT_CLASS = "mari-ib-root";
  const BUTTON_CLASS = "mari-ib-button";
  const STORAGE_PREFIX = "mari-ib-guidance:";
  const TRIM_ONLY_PROMPT_RE = /^\{\{\s*trim\s*\}\}$/iu;

  // src/client/styles.js
  const CLIENT_CSS = `
  .mari-ib-root {
    display: inline-flex;
    gap: 0.125rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-user-drag: none;
    -webkit-tap-highlight-color: transparent;
  }

  .mari-bridge-slot-quick-actions,
  .mari-bridge-slot-quick-actions .mari-bridge-slot-contribution {
    display: contents;
  }

  .mari-bridge-slot-quick-actions .mari-ib-root {
    flex-direction: column;
    gap: 0.375rem;
  }

  .mari-ib-root,
  .mari-ib-root * {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-user-drag: none;
    -webkit-tap-highlight-color: transparent;
  }

  .mari-ib-button {
    display: flex;
    height: 2.25rem;
    width: 2.25rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: color-mix(in srgb, currentColor 75%, transparent);
    cursor: pointer;
    touch-action: manipulation;
    transition: all 160ms ease;
  }

  .mari-bridge-slot-quick-actions .mari-ib-button {
    position: relative;
    height: 2.75rem;
    width: 2.75rem;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: 999px;
    background: var(--card);
    color: color-mix(in srgb, currentColor 55%, transparent);
    box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.24), 0 8px 10px -6px rgb(0 0 0 / 0.22);
    outline: none;
    transition-property: color, background-color, border-color, transform;
  }

  @media (min-width: 640px) {
    .mari-ib-button {
      height: 2rem;
      width: 2rem;
    }

    .mari-bridge-slot-quick-actions .mari-ib-button {
      height: 2.5rem;
      width: 2.5rem;
    }
  }

  .mari-ib-button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 10%, transparent);
    color: currentColor;
  }

  .mari-bridge-slot-quick-actions .mari-ib-button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 10%, var(--card));
    color: color-mix(in srgb, currentColor 80%, transparent);
  }

  .mari-ib-button:active:not(:disabled) {
    transform: scale(0.9);
  }

  .mari-bridge-slot-quick-actions .mari-ib-button:active:not(:disabled) {
    transform: scale(0.95);
  }

  .mari-ib-button:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 20%, transparent);
  }

  .mari-ib-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    color: color-mix(in srgb, currentColor 25%, transparent);
  }

  .mari-bridge-slot-quick-actions .mari-ib-button:disabled {
    border-color: color-mix(in srgb, currentColor 10%, transparent);
    background: color-mix(in srgb, var(--card) 75%, transparent);
    opacity: 0.45;
  }

  .mari-ib-icon-shell {
    display: flex;
    height: 2rem;
    width: 2rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
  }

  .mari-bridge-slot-quick-actions .mari-ib-icon-shell {
    background: color-mix(in srgb, currentColor 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 15%, transparent);
    transition: background-color 160ms ease, box-shadow 160ms ease;
  }

  .mari-bridge-slot-quick-actions .mari-ib-button:hover:not(:disabled) .mari-ib-icon-shell {
    background: transparent;
    box-shadow: inset 0 0 0 1px transparent;
  }

  .mari-ib-button svg {
    width: 1rem;
    height: 1rem;
    pointer-events: none;
  }

  .mari-bridge-generation-stop {
    position: relative;
  }

  .mari-bridge-generation-stop > svg {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    pointer-events: none;
    opacity: 0;
  }

  .mari-bridge-generation-stop::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 1rem;
    height: 1rem;
    transform: translate(-50%, -50%);
    background: currentColor;
    pointer-events: none;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  .mari-ib-toast {
    position: fixed;
    left: 50%;
    bottom: 86px;
    z-index: 99999;
    max-width: min(90vw, 640px);
    transform: translateX(-50%);
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    padding: 8px 12px;
    text-align: center;
    font: 700 12px/1.2 system-ui, Segoe UI, Roboto, Helvetica, Arial;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    transition: opacity 220ms ease;
  }

  .mari-ib-toast-ok {
    background: linear-gradient(135deg, #10b981, #14b8a6);
  }

  .mari-ib-toast-out {
    opacity: 0;
  }
  `;

  // src/client/icons.js
  const ICONS = {
    impersonate: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <polyline points="16 11 18 13 22 9"></polyline>
      </svg>
    `,
    continue: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 12h11"></path>
        <path d="m12 8 4 4-4 4"></path>
        <path d="M19 5v14"></path>
      </svg>
    `,
    restore: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7"></path>
        <path d="M3 4v6h6"></path>
      </svg>
    `,
    innerState: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5a3 3 0 0 0-5.1-2.1A3 3 0 0 0 4 6a3 3 0 0 0 .8 2A3 3 0 0 0 4 14a3 3 0 0 0 2.9 3.1A3 3 0 0 0 12 19"></path>
        <path d="M12 5a3 3 0 0 1 5.1-2.1A3 3 0 0 1 20 6a3 3 0 0 1-.8 2A3 3 0 0 1 20 14a3 3 0 0 1-2.9 3.1A3 3 0 0 1 12 19"></path>
        <path d="M12 5v14"></path>
      </svg>
    `,
    postOnly: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <path d="M14 2v6h6"></path>
        <path d="M8 13h8"></path>
        <path d="M8 17h5"></path>
      </svg>
    `,
    guided: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m15 4 5 5"></path>
        <path d="M14.5 9.5 4 20"></path>
        <path d="M19 13v6"></path>
        <path d="M22 16h-6"></path>
        <path d="M5 3v4"></path>
        <path d="M7 5H3"></path>
      </svg>
    `,
  };

  // src/client/api.js
  function readImpersonateSettings() {
    const fallback = {
      impersonatePromptTemplate: "",
      impersonatePresetId: null,
      impersonateConnectionId: null,
      impersonateBlockAgents: false,
    };

    try {
      const raw = localStorage.getItem("marinara-engine-ui");
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const state = parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
      return {
        impersonatePromptTemplate: typeof state.impersonatePromptTemplate === "string" ? state.impersonatePromptTemplate : "",
        impersonatePresetId:
          typeof state.impersonatePresetId === "string" && state.impersonatePresetId.trim()
            ? state.impersonatePresetId.trim()
            : null,
        impersonateConnectionId:
          typeof state.impersonateConnectionId === "string" && state.impersonateConnectionId.trim()
            ? state.impersonateConnectionId.trim()
            : null,
        impersonateBlockAgents: state.impersonateBlockAgents === true,
      };
    } catch {
      return fallback;
    }
  }

  async function readChat(chatId) {
    if (!chatId) return null;
    try {
      return await apiRequest(`/chats/${encodeURIComponent(chatId)}`);
    } catch {
      return null;
    }
  }

  async function readPersonaName(chatId) {
    const chat = await readChat(chatId);
    const personaId = typeof chat?.personaId === "string" && chat.personaId.trim() ? chat.personaId.trim() : "";
    if (personaId) {
      try {
        const persona = await apiRequest(`/characters/personas/${encodeURIComponent(personaId)}`);
        if (typeof persona?.name === "string" && persona.name.trim()) return persona.name.trim();
      } catch {}
    }

    try {
      const persona = await apiRequest("/characters/personas/active");
      if (typeof persona?.name === "string" && persona.name.trim()) return persona.name.trim();
    } catch {}

    return "";
  }

  async function readChatImpersonatePrompt(chatId) {
    const chat = await readChat(chatId);
    const metadata = readChatMetadata(chat);
    return typeof metadata.impersonatePrompt === "string" ? metadata.impersonatePrompt.trim() : "";
  }

  function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function readChatMetadata(chat) {
    try {
      return typeof chat?.metadata === "string" ? JSON.parse(chat.metadata || "{}") : chat?.metadata || {};
    } catch {
      return {};
    }
  }

  function readChatCharacterIds(chat) {
    return parseJsonArray(chat?.characterIds)
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim());
  }

  async function readPrimaryCharacterName(chat) {
    const characterId = readChatCharacterIds(chat)[0];
    if (!characterId) return "";
    try {
      const character = await apiRequest(`/characters/${encodeURIComponent(characterId)}`);
      const data = typeof character?.data === "string" ? JSON.parse(character.data || "{}") : character?.data;
      return typeof data?.name === "string" ? data.name.trim() : "";
    } catch {
      return "";
    }
  }

  async function readRegexScripts() {
    try {
      const scripts = await apiRequest("/regex-scripts");
      return Array.isArray(scripts) ? scripts : [];
    } catch {
      return [];
    }
  }

  // src/client/prompts.js
  function savedGuidanceKey(chatId) {
    return STORAGE_PREFIX + chatId;
  }

  function saveGuidance(chatId, text) {
    const value = String(text || "").trim();
    if (!chatId || !value) return;
    try {
      localStorage.setItem(savedGuidanceKey(chatId), text);
    } catch {}
  }

  function loadGuidance(chatId) {
    if (!chatId) return "";
    try {
      return localStorage.getItem(savedGuidanceKey(chatId)) || "";
    } catch {
      return "";
    }
  }

  function normalizeImpersonatePromptTemplate(value) {
    const template = String(value || "").trim();
    return {
      template,
      trimOnly: TRIM_ONLY_PROMPT_RE.test(template),
    };
  }

  function buildModeGenerationGuide(mode, originalInput) {
    const input = String(originalInput || "").trim();
    if (!input) return "";
    if (mode === "inner_state") {
      return [
        "Private inner state for {{user}}:",
        input,
        "",
        "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
        "Let this ground the response in {{user}}'s feelings rather than force an outcome.",
      ].join("\n");
    }
    if (mode !== "continue") {
      return [
        "Guidance for {{user}}'s next in-character response:",
        input,
        "",
        "Use this as a suggestion for the generated response, not as dialogue or chat history.",
        "Do not quote or rush to fulfill the suggestion; let it guide you naturally.",
      ].join("\n");
    }
    return [
      "Continue the current in-character draft.",
      "The draft so far is:",
      input,
      "",
      "Treat the draft as text to continue, not as dialogue or chat history to answer.",
      "Return only the continuation text.",
      "Do not restart the draft.",
      "Do not repeat any part of the draft.",
      "Do not explain.",
    ].join("\n");
  }

  function buildInnerStateTemplate(baseTemplate) {
    const base = String(baseTemplate || "").trim();
    const innerStateBlock = [
      "Private inner state for {{user}}:",
      "{{impersonate_direction}}",
      "",
      "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
      "Let this ground the response in {{user}}'s feelings rather than force an outcome.",
    ].join("\n");
    return base ? `${base}\n\n${innerStateBlock}` : innerStateBlock;
  }

  function buildContinueTemplate(baseTemplate) {
    const base = String(baseTemplate || "").trim();
    const continueBlock = [
      "Continue {{user}}'s current in-character draft.",
      "The draft so far is:",
      "{{impersonate_direction}}",
      "",
      "Return only the continuation text.",
      "Do not restart the draft.",
      "Do not repeat any part of the draft.",
      "Do not explain.",
    ].join("\n");
    return base ? `${base}\n\n${continueBlock}` : continueBlock;
  }

  // src/client/regex.js
  function stripTemplateUserPrefix(value) {
    return String(value || "").trim().replace(/^\{\{user\}\}\s*:\s*/iu, "").trim();
  }

  function escapeRegExp(value) {
    const specials = new Set(["\\", "^", "$", ".", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}"]);
    return Array.from(String(value), (ch) => (specials.has(ch) ? `\\${ch}` : ch)).join("");
  }

  function stripImpersonateSpeakerPrefix(text, personaName) {
    let next = String(text || "");
    const cleanedPersonaName = stripTemplateUserPrefix(personaName);
    const labels = ["{{user}}", cleanedPersonaName].filter(Boolean);

    for (let pass = 0; pass < 2; pass += 1) {
      const before = next;
      for (const label of labels) {
        const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*:\\s*`, "iu");
        next = next.replace(pattern, "");
      }
      if (next === before) break;
    }

    return next;
  }

  function readScopedRegexMode(chat) {
    const mode = readChatMetadata(chat).scopedRegexMode;
    return mode === "exclusive" || mode === "chat" ? mode : "disabled";
  }

  function isRegexEnabled(value) {
    return value === true || value === "true";
  }

  function readRegexApplyMode(script) {
    return script?.applyMode === "prompt" || script?.applyMode === "display" || script?.applyMode === "both"
      ? script.applyMode
      : script?.promptOnly === true || script?.promptOnly === "true"
        ? "prompt"
        : "display";
  }

  function readRegexStrings(value) {
    return parseJsonArray(value).filter((entry) => typeof entry === "string");
  }

  function readRegexPlacements(value) {
    return readRegexStrings(value).filter((entry) => entry === "ai_output" || entry === "user_input");
  }

  function resolveRegexMacros(value, regexContext) {
    return String(value || "")
      .replace(/\{\{\s*user\s*\}\}/giu, regexContext.personaName || "User")
      .replace(/\{\{\s*char\s*\}\}/giu, regexContext.characterName || "Character")
      .replace(/\{\{\s*noop\s*\}\}/giu, "")
      .replace(/\{\{\s*trim\s*\}\}/giu, "");
  }

  function resolveRegexPattern(value, regexContext) {
    return String(value || "").replace(/\{\{[\s\S]*?\}\}/gu, (macro) => escapeRegExp(resolveRegexMacros(macro, regexContext)));
  }

  function expandRegexReplacement(replacement, matchArgs) {
    const match = String(matchArgs[0] ?? "");
    const maybeGroups = matchArgs[matchArgs.length - 1];
    const hasGroups = maybeGroups && typeof maybeGroups === "object";
    const input = String(matchArgs[matchArgs.length - (hasGroups ? 2 : 1)] ?? "");
    const offset = Number(matchArgs[matchArgs.length - (hasGroups ? 3 : 2)] ?? 0);
    const captures = matchArgs.slice(1, hasGroups ? -3 : -2).map((capture) => (capture == null ? "" : String(capture)));
    const groups = hasGroups ? maybeGroups : null;
    let result = "";
    let caseMode = "";
    let oneShot = "";

    const applyCase = (value) => {
      let next = caseMode === "upper" ? value.toUpperCase() : caseMode === "lower" ? value.toLowerCase() : value;
      if (oneShot && next) {
        next = oneShot === "upper" ? next.charAt(0).toUpperCase() + next.slice(1) : next.charAt(0).toLowerCase() + next.slice(1);
        oneShot = "";
      }
      return next;
    };

    for (let i = 0; i < replacement.length; i += 1) {
      const ch = replacement[i];
      const next = replacement[i + 1];
      if (ch === "\\" && next && "ULEul".includes(next)) {
        if (next === "U") caseMode = "upper";
        else if (next === "L") caseMode = "lower";
        else if (next === "E") caseMode = "";
        else if (next === "u") oneShot = "upper";
        else if (next === "l") oneShot = "lower";
        i += 1;
        continue;
      }
      if (ch !== "$") {
        result += applyCase(ch || "");
        continue;
      }

      if (next === "$") {
        result += applyCase("$");
        i += 1;
      } else if (next === "&") {
        result += applyCase(match);
        i += 1;
      } else if (next === "`") {
        result += applyCase(input.slice(0, offset));
        i += 1;
      } else if (next === "'") {
        result += applyCase(input.slice(offset + match.length));
        i += 1;
      } else if (next === "<") {
        const close = replacement.indexOf(">", i + 2);
        if (close > i) {
          const name = replacement.slice(i + 2, close);
          result += applyCase(groups && Object.prototype.hasOwnProperty.call(groups, name) ? String(groups[name] ?? "") : "");
          i = close;
        } else {
          result += applyCase("$");
        }
      } else if (/\d/u.test(next || "")) {
        const two = replacement.slice(i + 1, i + 3);
        if (/^\d{2}$/u.test(two) && Number(two) >= 1 && Number(two) <= captures.length) {
          result += applyCase(captures[Number(two) - 1] || "");
          i += 2;
        } else {
          const index = Number(next);
          result += applyCase(index >= 1 && index <= captures.length ? captures[index - 1] || "" : `$${next}`);
          i += 1;
        }
      } else {
        result += applyCase("$");
      }
    }

    return result;
  }

  function applyRegexReplacementCompat(text, regex, replacement) {
    return text.replace(regex, (...args) => expandRegexReplacement(replacement, args));
  }

  function applyActiveAiOutputRegex(text, regexContext) {
    if (!regexContext?.scripts?.length) return text;
    let result = String(text || "");
    for (const script of regexContext.scripts) {
      if (!isRegexEnabled(script.enabled)) continue;
      const applyMode = readRegexApplyMode(script);
      if (applyMode !== "display" && applyMode !== "both") continue;
      if (!readRegexPlacements(script.placement).includes("ai_output")) continue;

      const targetCharacterIds = readRegexStrings(script.targetCharacterIds);
      if (targetCharacterIds.length > 0) {
        if (regexContext.scopedRegexMode === "disabled") continue;
        if (regexContext.scopedRegexMode === "exclusive") continue;
      }
      if (typeof script.minDepth === "number" && 0 < script.minDepth) continue;
      if (typeof script.maxDepth === "number" && 0 > script.maxDepth) continue;

      try {
        const findRegex = resolveRegexPattern(script.findRegex, regexContext);
        if (!findRegex) continue;
        const regex = new RegExp(findRegex, typeof script.flags === "string" ? script.flags : "");
        const replacement = resolveRegexMacros(script.replaceString, regexContext);
        result = applyRegexReplacementCompat(result, regex, replacement);
        for (const trim of readRegexStrings(script.trimStrings)) {
          const resolvedTrim = resolveRegexMacros(trim, regexContext);
          if (resolvedTrim) result = result.split(resolvedTrim).join("");
        }
      } catch {}
    }
    return result;
  }

  function renderGeneratedText(text, personaName, regexContext) {
    return stripImpersonateSpeakerPrefix(applyActiveAiOutputRegex(text, regexContext), personaName);
  }

  async function readRegexContext(chat, personaName) {
    const [scripts, characterName] = await Promise.all([readRegexScripts(), readPrimaryCharacterName(chat)]);
    return {
      scripts,
      personaName,
      characterName,
      scopedRegexMode: readScopedRegexMode(chat),
    };
  }

  // src/client/generation.js
  function normalizeMode(requestedMode, input) {
    const mode = requestedMode === "continue" ? "continue" : requestedMode === "inner_state" ? "inner_state" : "impersonate";
    if (mode === "continue" && !String(input || "").trim()) return "impersonate";
    return mode;
  }

  function joiner(left, right) {
    if (!left || !right) return "";
    if (/[\s"'([{]$/u.test(left)) return "";
    if (/^[\s.,!?;:)"'\]}]/u.test(right)) return "";
    return " ";
  }

  async function buildDryRunParams({ chatId, mode, originalInput, settings }) {
    const promptTemplate = normalizeImpersonatePromptTemplate(settings.impersonatePromptTemplate);
    const useRegularPresetDryRun = promptTemplate.trimOnly && !!settings.impersonatePresetId;
    const params = useRegularPresetDryRun
      ? {
          chatId,
          presetId: settings.impersonatePresetId,
          streaming: true,
        }
      : {
          chatId,
          userMessage: mode === "continue" || mode === "inner_state" ? originalInput.trim() : originalInput.trim() || null,
          impersonate: true,
          streaming: true,
          impersonateBlockAgents: settings.impersonateBlockAgents,
        };

    if (useRegularPresetDryRun) {
      if (settings.impersonateConnectionId) params.connectionId = settings.impersonateConnectionId;
      const generationGuide = buildModeGenerationGuide(mode, originalInput);
      if (generationGuide) {
        params.generationGuide = generationGuide;
        params.generationGuideSource = "guide";
      }
      return params;
    }

    if (settings.impersonatePresetId) params.impersonatePresetId = settings.impersonatePresetId;
    if (settings.impersonateConnectionId) params.impersonateConnectionId = settings.impersonateConnectionId;

    if (mode === "continue") {
      const baseTemplate = promptTemplate.template || (await readChatImpersonatePrompt(chatId));
      params.impersonatePromptTemplate = buildContinueTemplate(baseTemplate);
    } else if (mode === "inner_state") {
      const baseTemplate = promptTemplate.trimOnly ? "" : promptTemplate.template || (await readChatImpersonatePrompt(chatId));
      params.impersonatePromptTemplate = buildInnerStateTemplate(baseTemplate);
    } else if (promptTemplate.template) {
      params.impersonatePromptTemplate = promptTemplate.template;
    }

    return params;
  }

  async function startDryRun(runtime, requestedMode) {
    if (runtime.activeRun) {
      stopRun(runtime);
      return;
    }

    const context = findActiveComposerContext();
    const textarea = context.textarea;
    const chatId = context.chatId;
    if (!context.root || !textarea || !context.sendButton || !chatId) {
      showToast(runtime, "No active chat detected.", false);
      return;
    }
    if (textarea.disabled) return;

    const originalInput = textarea.value || "";
    const mode = normalizeMode(requestedMode, originalInput);
    if (mode === "impersonate" || mode === "inner_state") saveGuidance(chatId, originalInput);

    const run = {
      clientRunId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      serverRunId: "",
      abortController: new AbortController(),
      chatId,
      mode,
      originalInput,
      hasStartedText: false,
      aborted: false,
    };
    runtime.activeRun = run;
    scheduleComposerSlotRender(0);

    let buffer = "";
    let continuation = "";
    if (mode === "impersonate" || mode === "inner_state") setTextControlValue(textarea, "Generating...");

    const settings = readImpersonateSettings();
    const chat = await readChat(chatId);
    const personaName = await readPersonaName(chatId);
    const regexContext = await readRegexContext(chat, personaName);
    const params = await buildDryRunParams({ chatId, mode, originalInput, settings });
    const renderContinuation = (value) => {
      const cleanedValue = renderGeneratedText(value, personaName, regexContext);
      setTextControlValue(textarea, originalInput + joiner(originalInput, cleanedValue) + cleanedValue);
    };

    try {
      await streamBridgeDryRunGeneration({
        packageId: PACKAGE_ID,
        id: mode,
        kind: GENERATION_KIND_AGENT,
        chatId,
        reason: "dry-run-generation",
        body: params,
        signal: run.abortController.signal,
        lockComposer: true,
        abort: () => abortRun(runtime, run),
        handlers: {
          onEvent: (event) => {
            if (!isCurrentRun(runtime, run)) return;
            if (event.type === "dryrun_started") {
              run.serverRunId = event.data?.runId || "";
            } else if (event.type === "token") {
              run.hasStartedText = true;
              if (mode === "continue") {
                continuation += String(event.data || "");
                renderContinuation(continuation);
              } else {
                buffer += String(event.data || "");
                setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
              }
            } else if (event.type === "result") {
              run.hasStartedText = true;
              const cleaned = String(event.data?.content || "").trimEnd();
              if (mode === "continue") {
                continuation = cleaned;
                renderContinuation(continuation);
              } else {
                buffer = cleaned;
                setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
              }
            } else if (event.type === "content_replace") {
              run.hasStartedText = true;
              buffer = String(event.data || "").trimEnd();
              setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
            } else if (event.type === "text_rewrite" && event.data?.editedText) {
              run.hasStartedText = true;
              buffer = String(event.data.editedText).trimEnd();
              setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
            } else if (event.type === "error") {
              throw new Error(String(event.data || "Dry run failed."));
            }
          },
        },
      });
    } catch (error) {
      if (isCurrentRun(runtime, run)) {
        if (!run.hasStartedText && (mode === "impersonate" || mode === "inner_state")) setTextControlValue(textarea, originalInput);
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          showToast(runtime, error?.message || "Silent impersonate failed.", false);
        }
      }
    } finally {
      if (runtime.activeRun === run) runtime.activeRun = null;
      scheduleComposerSlotRender(0);
    }
  }

  function isCurrentRun(runtime, run) {
    return !!runtime.activeRun && !!run && runtime.activeRun.clientRunId === run.clientRunId;
  }

  function stopRun(runtime) {
    const run = runtime.activeRun;
    if (!run) return;
    abortRun(runtime, run);
  }

  function abortRun(runtime, run) {
    if (!run || run.aborted) return;
    run.aborted = true;
    if (!run.hasStartedText && (run.mode === "impersonate" || run.mode === "inner_state")) {
      const textarea = findActiveComposerContext().textarea;
      if (textarea) setTextControlValue(textarea, run.originalInput);
    }
    try {
      run.abortController?.abort();
    } catch {}
    void abortPackageDryRunGeneration(run.chatId, run.serverRunId);
    if (runtime.activeRun === run) runtime.activeRun = null;
    scheduleComposerSlotRender(0);
  }

  function abortPackageDryRunGeneration(chatId, runId) {
    if (!chatId || !runId) return Promise.resolve(null);
    return apiRequest("/generate/dryRun/abort", {
      method: "POST",
      body: JSON.stringify({ chatId, runId }),
    }).catch(() => null);
  }

  // src/client/runtime.js
  function createRuntime() {
    return {
      initialized: false,
      dom: createDomScope(),
      activeRun: null,
      registrations: [],
    };
  }

  function defineCapabilityElement() {
    const tag = "marinara-capability-impersonate-button";
    if (customElements.get(tag)) return;

    class ImpersonateButtonCapabilityElement extends HTMLElement {
      connectedCallback() {
        this.hidden = true;
        this.setAttribute("aria-hidden", "true");
      }
    }

    customElements.define(tag, ImpersonateButtonCapabilityElement);
  }

  function installPublicApi(runtime) {
    const api = Object.freeze({
      id: PACKAGE_ID,
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      start: (mode = "impersonate") => startDryRun(runtime, mode),
      stop: () => stopRun(runtime),
      restoreGuidance: () => restoreGuidance(runtime),
    });
    try {
      Object.defineProperty(window, PUBLIC_API_KEY, {
        value: api,
        enumerable: false,
        configurable: true,
      });
    } catch {
      window[PUBLIC_API_KEY] = api;
    }
    window.dispatchEvent(new CustomEvent("marinara:impersonate-button-ready", { detail: api }));
    return api;
  }

  function showToast(runtime, message, ok) {
    const t = document.createElement("div");
    t.textContent = message;
    t.className = ok ? "mari-ib-toast mari-ib-toast-ok" : "mari-ib-toast";
    document.body.appendChild(t);
    runtime.dom.timeout(() => {
      t.classList.add("mari-ib-toast-out");
      runtime.dom.timeout(() => t.remove(), 220);
    }, 2600);
  }

  function getDisabledReason(runtime, context) {
    if (!context.root || !context.textarea) return "Select or create a chat first.";
    if (runtime.activeRun) return "Impersonate generation is running.";
    if (context.textarea.disabled) return "Wait for the current generation to finish.";
    return "";
  }

  function restoreGuidance(runtime) {
    const context = findActiveComposerContext();
    if (!context.textarea || !context.chatId) return;
    const saved = loadGuidance(context.chatId);
    if (!saved.trim()) {
      showToast(runtime, "No saved guidance for this chat.", false);
      return;
    }
    setTextControlValue(context.textarea, saved);
    context.textarea.focus();
  }

  function quickActions(runtime) {
    return [
      {
        id: "impersonate",
        label: "Impersonate",
        title: "Generate as your persona",
        icon: ICONS.impersonate,
        handler: () => startDryRun(runtime, "impersonate"),
      },
      {
        id: "continue",
        label: "Continue draft",
        title: "Continue the current draft",
        icon: ICONS.continue,
        handler: () => startDryRun(runtime, "continue"),
      },
      {
        id: "inner-state",
        label: "Inner State",
        title: "Use the current text as private thoughts or feelings",
        icon: ICONS.innerState,
        handler: () => startDryRun(runtime, "inner_state"),
      },
      {
        id: "restore-guidance",
        label: "Restore guidance",
        title: "Restore the last guidance text",
        icon: ICONS.restore,
        handler: () => restoreGuidance(runtime),
      },
    ];
  }

  function createQuickActionButton(runtime, action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON_CLASS;
    btn.dataset.mariImpersonateAction = action.id;
    btn.title = `${action.label}: ${action.title}`;
    btn.setAttribute("aria-label", `${action.label}: ${action.title}`);
    btn.innerHTML = `<span class="mari-ib-icon-shell">${action.icon}</span>`;
    runtime.dom.on(btn, "pointerdown", (event) => event.preventDefault());
    runtime.dom.on(btn, "dragstart", (event) => event.preventDefault());
    runtime.dom.on(btn, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (btn.disabled) return;
      action.handler();
    });
    return btn;
  }

  function renderQuickActionSlot(runtime) {
    const root = document.createElement("span");
    root.className = ROOT_CLASS;
    runtime.dom.on(root, "selectstart", (event) => event.preventDefault());
    runtime.dom.on(root, "dragstart", (event) => event.preventDefault());
    for (const action of quickActions(runtime)) root.appendChild(createQuickActionButton(runtime, action));
    return root;
  }

  function updateQuickActionSlot(runtime, context) {
    const reason = getDisabledReason(runtime, context);
    for (const button of context.node.querySelectorAll(`.${BUTTON_CLASS}`)) {
      button.disabled = Boolean(reason);
      button.classList.toggle("mari-ib-active", !!runtime.activeRun);
      const action = quickActions(runtime).find((item) => item.id === button.dataset.mariImpersonateAction);
      if (!action) continue;
      button.title = reason || `${action.label}: ${action.title}`;
      button.setAttribute("aria-label", reason || `${action.label}: ${action.title}`);
    }
  }

  function registerSlots(runtime) {
    runtime.registrations.push(
      registerComposerSlotContribution({
        packageId: PACKAGE_ID,
        id: "quick-actions",
        slot: COMPOSER_SLOT_QUICK_ACTIONS,
        priority: 50,
        render: () => renderQuickActionSlot(runtime),
        update: (context) => updateQuickActionSlot(runtime, context),
      }),
    );
  }

  function startRuntime(runtime) {
    injectStyle(STYLE_ID, CLIENT_CSS);
    ensureGenerationLifecycleBridge();
    runtime.dom.on(window, GENERATION_STATE_EVENT, () => scheduleComposerSlotRender(0));
    registerSlots(runtime);
  }

  function destroyRuntime(runtime) {
    if (runtime.activeRun) stopRun(runtime);
    while (runtime.registrations.length) {
      try {
        runtime.registrations.pop()?.();
      } catch {}
    }
    document.getElementById(STYLE_ID)?.remove();
    runtime.dom.destroy();
  }

  function startImpersonateButtonPackage() {
    defineCapabilityElement();

    if (window[RUNTIME_KEY]?.initialized) {
      installPublicApi(window[RUNTIME_KEY]);
      return window[RUNTIME_KEY];
    }

    const runtime = createRuntime();
    runtime.initialized = true;
    window[RUNTIME_KEY] = runtime;
    installPublicApi(runtime);

    if (document.readyState === "loading") {
      runtime.dom.on(document, "DOMContentLoaded", () => startRuntime(runtime), { once: true });
    } else {
      startRuntime(runtime);
    }

    runtime.dom.cleanup(() => {
      if (window[RUNTIME_KEY] === runtime) delete window[RUNTIME_KEY];
    });
    runtime.destroy = () => destroyRuntime(runtime);
    return runtime;
  }

  startImpersonateButtonPackage();
})();
