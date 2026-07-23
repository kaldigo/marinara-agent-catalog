(() => {
  "use strict";
  // bridge/runtime.js
  // Shared runtime coordinator for bridge copies bundled by different packages.

  const MARI_BRIDGE_VERSION = "1.0.3";

  const MARI_BRIDGE_RUNTIME_KEY = "__mariBridgeRuntime";
  const DEFAULT_CAPABILITIES = [
    "runtime:newest-wins",
    "commands:register",
    "fetch:interceptors",
    "generation:lifecycle-events",
    "ui-slots:composer-above-input",
    "ui-slots:quick-actions-menu",
  ];

  // Returns the page-global Mari bridge runtime shared by every bundled bridge copy.
  function getMariBridgeRuntime() {
    const root = globalThis;
    const runtime = root[MARI_BRIDGE_RUNTIME_KEY] || {
      version: "0.0.0",
      capabilities: new Set(),
      subsystems: new Map(),
      warnings: [],
    };
    if (!(runtime.capabilities instanceof Set)) runtime.capabilities = new Set(runtime.capabilities || []);
    if (!(runtime.subsystems instanceof Map)) runtime.subsystems = new Map();
    if (!Array.isArray(runtime.warnings)) runtime.warnings = [];
    if (compareBridgeVersions(MARI_BRIDGE_VERSION, runtime.version) > 0) runtime.version = MARI_BRIDGE_VERSION;
    for (const capability of DEFAULT_CAPABILITIES) runtime.capabilities.add(capability);
    root[MARI_BRIDGE_RUNTIME_KEY] = runtime;
    return runtime;
  }

  // Claims a singleton bridge subsystem; newer bridge versions replace older owners.
  function claimBridgeSubsystem(name, definition = {}) {
    const runtime = getMariBridgeRuntime();
    const subsystem = String(name || "").trim();
    if (!subsystem) throw new Error("Bridge subsystem claim requires a name.");

    const version = String(definition.version || MARI_BRIDGE_VERSION);
    const ownerId = String(definition.ownerId || `${subsystem}@${version}`);
    const current = runtime.subsystems.get(subsystem) || null;
    const comparison = current ? compareBridgeVersions(version, current.version) : 1;

    if (current && comparison < 0) {
      warnBridgeRuntime(`Ignoring older ${subsystem} bridge ${version}; ${current.version} is already active.`);
      return { active: false, current, runtime, token: null };
    }

    if (current && comparison === 0 && (current.installed || current.installing)) {
      return { active: false, current, runtime, token: current.token || null };
    }

    if (current?.cleanup) {
      try {
        current.cleanup();
      } catch (error) {
        warnBridgeRuntime(`Bridge subsystem ${subsystem} cleanup failed: ${errorMessage(error)}`);
      }
    }

    const token = Symbol(`mari-bridge:${subsystem}:${version}`);
    const next = {
      name: subsystem,
      version,
      ownerId,
      token,
      installed: false,
      installing: true,
      installedAt: Date.now(),
      cleanup: null,
    };
    runtime.subsystems.set(subsystem, next);

    try {
      if (typeof definition.install === "function") {
        const cleanup = definition.install({ runtime, previous: current, token });
        if (typeof cleanup === "function") next.cleanup = cleanup;
      }
      next.installed = true;
      return { active: true, current: next, runtime, token };
    } catch (error) {
      if (current) runtime.subsystems.set(subsystem, current);
      else runtime.subsystems.delete(subsystem);
      throw error;
    } finally {
      next.installing = false;
    }
  }

  // Checks whether a callback still belongs to the active owner of a subsystem.
  function isBridgeSubsystemOwner(name, token) {
    if (!token) return false;
    return getMariBridgeRuntime().subsystems.get(name)?.token === token;
  }

  // Registers package-neutral bridge capabilities for feature detection.
  function registerBridgeCapabilities(capabilities) {
    const runtime = getMariBridgeRuntime();
    for (const capability of Array.isArray(capabilities) ? capabilities : [capabilities]) {
      const normalized = String(capability || "").trim();
      if (normalized) runtime.capabilities.add(normalized);
    }
    return runtime;
  }

  function hasBridgeCapability(capability) {
    return getMariBridgeRuntime().capabilities.has(String(capability || "").trim());
  }

  function compareBridgeVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (a[index] || 0) - (b[index] || 0);
      if (delta !== 0) return delta > 0 ? 1 : -1;
    }
    return 0;
  }

  function warnBridgeRuntime(message) {
    const runtime = getMariBridgeRuntime();
    runtime.warnings.push({ message, at: Date.now() });
    if (runtime.warnings.length > 25) runtime.warnings.splice(0, runtime.warnings.length - 25);
    globalThis.console?.warn?.(`[mari-bridge] ${message}`);
  }

  function parseVersion(value) {
    return String(value || "0")
      .split(/[.-]/u)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

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
    const fromStoreApi = readChatIdFromKnownStores();
    if (fromStoreApi) return fromStoreApi;
    const fromLocalStorage = readStoredActiveChatId();
    if (fromLocalStorage) return fromLocalStorage;
    const selected = document.querySelector('[data-chat-id][class*="sidebar-accent"], [data-chat-id][aria-current="true"]');
    if (selected) return selected.getAttribute("data-chat-id") || "";
    const firstDataChat = document.querySelector("[data-chat-id]");
    if (firstDataChat) return firstDataChat.getAttribute("data-chat-id") || "";
    return "";
  }

  function readStoredActiveChatId() {
    try {
      return localStorage.getItem("marinara-active-chat-id") || "";
    } catch {
      return "";
    }
  }

  function readChatIdFromKnownStores() {
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
    state.renderDelayMs = Number.isFinite(Number(options.renderDelayMs)) ? Number(options.renderDelayMs) : 80;
    claimBridgeSubsystem("ui-slots", {
      version: MARI_BRIDGE_VERSION,
      ownerId: "mari-bridge:ui-slots",
      install: ({ token }) => {
        state.ownerToken = token;
        state.scope = createDomScope();
        state.scheduleRender = (delayMs) => scheduleComposerSlotRenderForOwner(state, delayMs, token);
        if (document.readyState === "loading") {
          state.scope.on(document, "DOMContentLoaded", () => startComposerSlotObservation(state, token), { once: true });
        } else {
          startComposerSlotObservation(state, token);
        }
        return () => {
          unmountAll(state);
          state.scope?.destroy?.();
          state.scope = null;
          state.observer = null;
          state.renderTimer = 0;
          state.scheduleRender = null;
          if (state.ownerToken === token) state.ownerToken = null;
        };
      },
    });
    return state;
  }

  // Forces a bridge slot render pass after a package changes its own state.
  function scheduleComposerSlotRender(delayMs) {
    const state = getUiSlotState();
    ensureComposerSlotBridge();
    if (typeof state.scheduleRender === "function") {
      state.scheduleRender(delayMs);
      return;
    }
  }

  function scheduleComposerSlotRenderForOwner(state, delayMs, token) {
    if (!isBridgeSubsystemOwner("ui-slots", token)) return;
    if (state.renderTimer) state.scope?.clearTimer?.(state.renderTimer);
    const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : state.renderDelayMs;
    state.renderTimer = (state.scope || createDomScope()).timeout(() => {
      state.renderTimer = 0;
      if (!isBridgeSubsystemOwner("ui-slots", token)) return;
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
        ownerToken: null,
        scheduleRender: null,
      };
    }
    const state = window[UI_SLOT_STATE_KEY];
    if (!(state.contributions instanceof Map)) state.contributions = new Map();
    if (!(state.mounted instanceof Map)) state.mounted = new Map();
    if (!("ownerToken" in state)) state.ownerToken = null;
    if (!("scheduleRender" in state)) state.scheduleRender = null;
    return state;
  }

  function startComposerSlotObservation(state, token) {
    if (!isBridgeSubsystemOwner("ui-slots", token)) return;
    state.scope.on(window, "focus", () => scheduleComposerSlotRender(0));
    state.scope.on(window, "resize", () => scheduleComposerSlotRender());
    state.scope.on(window, "popstate", () => scheduleComposerSlotRender(0));
    state.scope.on(window, "mari-bridge:generation-state", () => scheduleComposerSlotRender());
    state.scope.cleanup(watchActiveChatId(() => scheduleComposerSlotRender(0), { debounceMs: 80, intervalMs: 750 }));
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

    const contributions = [...state.contributions.values()]
      .filter((entry) => KNOWN_COMPOSER_SLOTS.has(entry.slot))
      .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
    const visibleKeys = new Set();

    for (const contribution of contributions) {
      if (contribution.shouldShow(context) === false) {
        unmountContribution(state, contribution.key);
        continue;
      }
      const slotHost = ensureSlotHost(contribution.slot, context);
      if (!slotHost) {
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

  function ensureSlotHost(slot, context) {
    if (slot === COMPOSER_SLOT_ABOVE_INPUT) return ensureAboveInputHost(context.root);
    if (slot === COMPOSER_SLOT_QUICK_ACTIONS) return ensureQuickActionsHost(context);
    return null;
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
    if (host.parentElement !== menu || host !== menu.firstElementChild) menu.insertBefore(host, menu.firstChild);
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
    claimBridgeSubsystem("generation-lifecycle", {
      version: MARI_BRIDGE_VERSION,
      ownerId: "mari-bridge:generation-lifecycle",
      install: ({ token }) => {
        state.ownerToken = token;
        state.emitGenerationSnapshot = (entry, active, status, detail) =>
          emitGenerationSnapshotForOwner(state, entry, active, status, detail, token);
        const start = () => startGenerationObservation(state, token);
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", start, { once: true });
          return () => document.removeEventListener("DOMContentLoaded", start);
        }
        start();
        return () => stopGenerationObservation(state, token);
      },
    });
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
        ownerToken: null,
        nativeHandlers: null,
        emitGenerationSnapshot: null,
      };
    }
    const state = window[GENERATION_STATE_KEY];
    if (!(state.active instanceof Map)) state.active = new Map();
    if (!("ownerToken" in state)) state.ownerToken = null;
    if (!("nativeHandlers" in state)) state.nativeHandlers = null;
    if (!("emitGenerationSnapshot" in state)) state.emitGenerationSnapshot = null;
    return state;
  }

  function startGenerationObservation(state, token) {
    if (!isBridgeSubsystemOwner("generation-lifecycle", token)) return;
    if (state.nativeTracking) {
      const handlers = {
        click: () => scheduleNativeGenerationSync(state, token),
        focus: () => scheduleNativeGenerationSync(state, token),
        pageshow: () => scheduleNativeGenerationSync(state, token),
        complete: () => setNativeMainActive(state, false, "complete"),
        error: () => setNativeMainActive(state, false, "error"),
      };
      state.nativeHandlers = handlers;
      document.addEventListener("click", handlers.click, true);
      window.addEventListener("focus", handlers.focus);
      window.addEventListener("pageshow", handlers.pageshow);
      window.addEventListener("marinara:generation-complete", handlers.complete);
      window.addEventListener("marinara:generation-error", handlers.error);
      if (document.body) {
        state.observer = new MutationObserver(() => scheduleNativeGenerationSync(state, token));
        state.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-label", "title", "class", "disabled"],
        });
      }
      scheduleNativeGenerationSync(state, token, 0);
    }
  }

  function stopGenerationObservation(state, token) {
    if (state.ownerToken !== token) return;
    const handlers = state.nativeHandlers;
    if (handlers) {
      document.removeEventListener("click", handlers.click, true);
      window.removeEventListener("focus", handlers.focus);
      window.removeEventListener("pageshow", handlers.pageshow);
      window.removeEventListener("marinara:generation-complete", handlers.complete);
      window.removeEventListener("marinara:generation-error", handlers.error);
    }
    state.observer?.disconnect?.();
    if (state.syncTimer) window.clearTimeout(state.syncTimer);
    state.nativeHandlers = null;
    state.observer = null;
    state.syncTimer = 0;
    state.emitGenerationSnapshot = null;
    state.ownerToken = null;
  }

  function scheduleNativeGenerationSync(state, token, delay = 80) {
    if (!isBridgeSubsystemOwner("generation-lifecycle", token)) return;
    if (state.syncTimer) window.clearTimeout(state.syncTimer);
    state.syncTimer = window.setTimeout(() => {
      state.syncTimer = 0;
      if (!isBridgeSubsystemOwner("generation-lifecycle", token)) return;
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
    if (typeof state.emitGenerationSnapshot === "function") {
      state.emitGenerationSnapshot(entry, active, status, detail);
      return;
    }
    emitGenerationSnapshotForOwner(state, entry, active, status, detail, state.ownerToken);
  }

  function emitGenerationSnapshotForOwner(state, entry, active, status, detail = {}, token = null) {
    if (token && !isBridgeSubsystemOwner("generation-lifecycle", token)) return;
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

  // src/client/runtime.js
  (function () {
    const PACKAGE_ID = "group-sort-order";
    const TAG_NAME = "marinara-capability-group-sort-order";
    const ROOT_ID = "marinara-group-sort-order-root";
    const STYLE_ID = "marinara-group-sort-order-style";
    const RUNTIME_KEY = "__marinaraGroupSortOrderRuntime";
    const RUNTIME_VERSION = "1.0.15";

    const previousState = window[RUNTIME_KEY];
    if (previousState && previousState.version !== RUNTIME_VERSION) {
      previousState.disposed = true;
      previousState.slotCleanup?.();
      previousState.cleanups?.forEach?.((cleanup) => cleanup());
      window.clearTimeout(previousState.pollTimer);
      window.clearTimeout(previousState.renderTimer);
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      window[RUNTIME_KEY] = null;
    }

    const state = window[RUNTIME_KEY] || {
      version: RUNTIME_VERSION,
      disposed: false,
      initialized: false,
      activeChatId: "",
      lastEnsuredChatId: "",
      lastView: null,
      lastRefreshAt: 0,
      barNode: null,
      pollTimer: 0,
      renderTimer: 0,
      slotCleanup: null,
      cleanups: [],
      ensureInFlight: new Set(),
    };
    state.version = RUNTIME_VERSION;
    window[RUNTIME_KEY] = state;
    state.disposed = false;

    injectStyle(STYLE_ID, styleText());
    defineCapabilityElement();

    if (!state.initialized) {
      state.initialized = true;
      startRuntime();
    }

    function defineCapabilityElement() {
      if (customElements.get(TAG_NAME)) return;

      class GroupSortOrderCapabilityElement extends HTMLElement {
        connectedCallback() {
          this.setAttribute("aria-hidden", "true");
          this.style.display = "contents";
          this.addEventListener("marinara-capability-props", this);
          scheduleComposerSlotRender(0);
        }

        disconnectedCallback() {
          this.removeEventListener("marinara-capability-props", this);
          scheduleComposerSlotRender(0);
        }

        handleEvent(event) {
          if (event.type === "marinara-capability-props") scheduleComposerSlotRender(0);
        }
      }

      customElements.define(TAG_NAME, GroupSortOrderCapabilityElement);
    }

    function startRuntime() {
      state.slotCleanup = registerComposerSlotContribution({
        packageId: PACKAGE_ID,
        id: "next-speaker",
        slot: COMPOSER_SLOT_ABOVE_INPUT,
        priority: 40,
        shouldShow: ({ chatId }) => Boolean(chatId),
        render: ({ host }) => renderBar(host),
        update: ({ chatId, node }) => {
          bindActiveChat(chatId || "");
          updateBar(node, state.lastView);
        },
      });
      on(document, "visibilitychange", scheduleRefreshFromEvent, true);
      on(window, "focus", scheduleRefreshFromEvent);
      on(window, "marinara:generation-complete", scheduleRefreshFromEvent);
      on(window, "marinara:generation-error", scheduleRefreshFromEvent);
      scheduleComposerSlotRender(0);
    }

    function on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      state.cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function scheduleRefreshFromEvent() {
      scheduleViewRefresh(100);
      scheduleComposerSlotRender(100);
    }

    function scheduleViewRefresh(delay) {
      if (state.disposed) return;
      if (state.renderTimer) window.clearTimeout(state.renderTimer);
      state.renderTimer = window.setTimeout(runViewRefresh, delay);
    }

    function runViewRefresh() {
      state.renderTimer = 0;
      if (state.disposed) return;
      const chatId = state.activeChatId;
      if (chatId && chatId !== state.lastEnsuredChatId && !state.ensureInFlight.has(chatId)) {
        void ensure(chatId);
      } else if (chatId && Date.now() - state.lastRefreshAt > 1500) {
        void refreshView(chatId);
      }
      if (state.pollTimer) window.clearTimeout(state.pollTimer);
      state.pollTimer = window.setTimeout(runViewRefresh, 2000);
    }

    function bindActiveChat(chatId) {
      const nextChatId = typeof chatId === "string" ? chatId.trim() : "";
      if (nextChatId === state.activeChatId) return;
      state.activeChatId = nextChatId;
      state.lastView = null;
      updateBar(state.barNode, null);
      if (nextChatId) scheduleViewRefresh(0);
    }

    async function ensure(chatId) {
      state.ensureInFlight.add(chatId);
      try {
        const persona = await readPersonaCandidate(chatId).catch(() => null);
        await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/ensure`, {
          method: "POST",
          body: JSON.stringify({ personaCandidate: persona }),
        });
        state.lastEnsuredChatId = chatId;
      } catch (error) {
        warn("ensure failed", error);
      } finally {
        state.ensureInFlight.delete(chatId);
        await refreshView(chatId);
      }
    }

    async function refreshView(chatId) {
      try {
        state.lastRefreshAt = Date.now();
        const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/state`);
        if (chatId !== state.activeChatId) return;
        state.lastView = view;
        updateBar(state.barNode, view);
        scheduleComposerSlotRender(0);
      } catch (error) {
        warn("state refresh failed", error);
        updateBar(state.barNode, { enabled: true, hidden: true, nextSpeaker: null, includePersonaCandidate: false, status: "unknown" });
      }
    }

    function renderBar(host) {
      host.id = ROOT_ID;
      host.className = "mari-bridge-slot-contribution gso-root";
      host.innerHTML = [
        '<span class="gso-label">Next</span>',
        '<strong class="gso-next">Unknown</strong>',
        '<button type="button" class="gso-icon-button gso-persona" aria-label="Include persona candidate" title="Include persona candidate" aria-pressed="false">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>' +
        "</button>",
        '<button type="button" class="gso-icon-button gso-refresh" aria-label="Refresh next speaker" title="Refresh next speaker">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.36 6.36L4 16"/><path d="M4 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.36 5.64L20 8"/><path d="M20 3v5h-5"/></svg>' +
        "</button>",
      ].join("");
      host.querySelector(".gso-refresh")?.addEventListener("click", onRefreshClick);
      host.querySelector(".gso-persona")?.addEventListener("click", onPersonaToggle);
      state.barNode = host;
      updateBar(host, state.lastView);
      return host;
    }

    async function onRefreshClick() {
      const chatId = state.activeChatId;
      if (!chatId) return;
      const button = state.barNode?.querySelector(".gso-refresh");
      if (button) button.disabled = true;
      let generation = declarePackageGeneration({
        packageId: PACKAGE_ID,
        id: "refresh-next-speaker",
        kind: GENERATION_KIND_AGENT,
        chatId,
        reason: "raw-next-speaker-refresh",
      });
      try {
        const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/refresh`, { method: "POST", body: "{}" });
        generation.end();
        generation = null;
        if (chatId !== state.activeChatId) return;
        state.lastView = view;
        updateBar(state.barNode, view);
        scheduleComposerSlotRender(0);
      } catch (error) {
        generation?.error(error);
        warn("refresh failed", error);
        await refreshView(chatId);
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function onPersonaToggle() {
      const chatId = state.activeChatId;
      if (!chatId) return;
      const checked = state.lastView?.includePersonaCandidate !== true;
      try {
        const persona = await readPersonaCandidate(chatId).catch(() => null);
        const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/settings`, {
          method: "PATCH",
          body: JSON.stringify({
            includePersonaCandidate: checked,
            personaCandidate: persona,
          }),
        });
        if (chatId !== state.activeChatId) return;
        state.lastView = view;
        updateBar(state.barNode, view);
        scheduleComposerSlotRender(0);
      } catch (error) {
        warn("settings update failed", error);
        await refreshView(chatId);
      }
    }

    function updateBar(root, view) {
      if (!root) return;
      const shouldHide = !state.activeChatId || view?.enabled === false || view?.hidden !== false;
      root.hidden = shouldHide;
      root.dataset.status = typeof view?.status === "string" ? view.status : "unknown";
      if (root.dataset.chatId !== (state.activeChatId || "")) root.dataset.chatId = state.activeChatId || "";
      root.querySelector(".gso-next").textContent = view?.nextSpeaker?.name || "Unknown";
      const personaButton = root.querySelector(".gso-persona");
      if (personaButton) personaButton.setAttribute("aria-pressed", view?.includePersonaCandidate === true ? "true" : "false");
    }

    async function readPersonaCandidate(chatId) {
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
      const personaId = typeof chat?.personaId === "string" ? chat.personaId : "";
      if (!personaId) return null;
      const persona = await api(`/characters/personas/${encodeURIComponent(personaId)}`).catch(() => null);
      const data = normalizeObject(persona?.data ?? persona);
      return { id: personaId, name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : personaId };
    }

    async function api(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (options.body !== undefined && !headers["content-type"] && !headers["Content-Type"]) {
        headers["content-type"] = "application/json";
      }
      const response = await fetch(`/api${path}`, {
        headers,
        ...options,
      });
      if (!response.ok) throw new Error(await response.text());
      if (response.status === 204) return {};
      return response.json();
    }

    function normalizeObject(value) {
      if (!value) return {};
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
          return {};
        }
      }
      return typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    function styleText() {
      return `
        #${ROOT_ID} { display:flex; align-items:center; gap:8px; min-height:28px; padding:4px 8px 6px; font:12px system-ui,sans-serif; color:var(--muted-foreground,#9ca3af); }
        #${ROOT_ID}[hidden] { display:none !important; }
        #${ROOT_ID} .gso-label { text-transform:uppercase; letter-spacing:.04em; font-size:10px; opacity:.78; }
        #${ROOT_ID} .gso-next { color:var(--foreground,#f8fafc); font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #${ROOT_ID} .gso-persona { margin-left:auto; }
        #${ROOT_ID} .gso-icon-button { display:inline-flex; width:26px; height:26px; align-items:center; justify-content:center; border:1px solid color-mix(in srgb,var(--foreground,#f8fafc) 16%,transparent); border-radius:999px; padding:0; background:color-mix(in srgb,var(--secondary,#1f2937) 72%,transparent); color:color-mix(in srgb,var(--foreground,#f8fafc) 82%,transparent); line-height:1; }
        #${ROOT_ID} .gso-icon-button:hover:not(:disabled) { background:color-mix(in srgb,var(--foreground,#f8fafc) 10%,transparent); color:var(--foreground,#f8fafc); }
        #${ROOT_ID} .gso-icon-button[aria-pressed="true"] { color:var(--primary,#93c5fd); border-color:color-mix(in srgb,var(--primary,#93c5fd) 45%,transparent); background:color-mix(in srgb,var(--primary,#93c5fd) 16%,transparent); }
        #${ROOT_ID} .gso-icon-button svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
        #${ROOT_ID} button:disabled { opacity:.5; }
      `;
    }

    function warn(...args) {
      console.warn("[Group Sort Order]", ...args);
    }

    window.marinaraGroupSortOrder = {
      refresh() {
        return state.activeChatId ? refreshView(state.activeChatId) : Promise.resolve();
      },
      state,
      dispose() {
        state.disposed = true;
        state.slotCleanup?.();
        state.cleanups.forEach((cleanup) => cleanup());
        state.cleanups = [];
        window.clearTimeout(state.pollTimer);
        window.clearTimeout(state.renderTimer);
        state.slotCleanup = null;
        state.barNode = null;
        document.getElementById(ROOT_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
      },
    };
  })();

})();
