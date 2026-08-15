(() => {
  "use strict";
  // Shared runtime coordinator for bridge copies bundled by different packages.

  const MARI_BRIDGE_VERSION = "1.0.13";

  const MARI_BRIDGE_RUNTIME_KEY = "__mariBridgeRuntime";
  const DEFAULT_CAPABILITIES = [
    "runtime:newest-wins",
    "commands:register",
    "fetch:interceptors",
    "generation:lifecycle-events",
    "ui-slots:composer-above-input",
    "ui-slots:quick-actions-menu",
    "ui-slots:message-actions",
    "ui-slots:topbar-panel",
    "ui-slots:chat-settings",
    "capability-slots:register",
  ];

  // Returns the page-global Mari bridge runtime shared by every bundled bridge copy.
  function getMariBridgeRuntime() {
    const root = globalThis;
    const runtime = root[MARI_BRIDGE_RUNTIME_KEY] || {
      version: "0.0.0",
      capabilities: new Set(),
      subsystems: new Map(),
      warnings: [],
      warningKeys: new Map(),
    };
    if (!(runtime.capabilities instanceof Set)) runtime.capabilities = new Set(runtime.capabilities || []);
    if (!(runtime.subsystems instanceof Map)) runtime.subsystems = new Map();
    if (!Array.isArray(runtime.warnings)) runtime.warnings = [];
    if (!(runtime.warningKeys instanceof Map)) runtime.warningKeys = new Map();
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
    const now = Date.now();
    const normalized = String(message || "");
    const previous = runtime.warningKeys.get(normalized) || 0;
    if (now - previous < 60_000) return;
    runtime.warningKeys.set(normalized, now);
    runtime.warnings.push({ message: normalized, at: now });
    if (runtime.warnings.length > 25) runtime.warnings.splice(0, runtime.warnings.length - 25);
    if (runtime.warningKeys.size > 50) {
      for (const [key, at] of runtime.warningKeys) {
        if (now - at > 300_000) runtime.warningKeys.delete(key);
      }
    }
    globalThis.console?.warn?.(`[mari-bridge] ${normalized}`);
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


  function parseMessageRange(tokens, messages) {
    const list = Array.isArray(messages) ? messages : [];
    const parts = Array.isArray(tokens) ? tokens.map(String) : tokenizeCommandTail(String(tokens || ""));
    const joined = parts.join(" ").trim().toLowerCase();
    if (!joined) throw new Error("Range is required.");
    if (joined === "all") return list;

    if (parts[0]?.toLowerCase() === "last") {
      const count = Math.max(0, Math.floor(Number(parts[1])));
      if (!count) throw new Error("Use last <number>.");
      return list.slice(-count);
    }

    if (parts[0]?.toLowerCase() === "from" && parts[2]?.toLowerCase() === "to") {
      return selectIndexRange(list, Number(parts[1]), Number(parts[3]));
    }

    const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dash) return selectIndexRange(list, Number(dash[1]), Number(dash[2]));

    const single = Number(joined);
    if (Number.isInteger(single) && single > 0) return selectIndexRange(list, single, single);

    throw new Error(`Unsupported range: ${parts.join(" ")}`);
  }

  function selectIndexRange(messages, start, end) {
    const list = Array.isArray(messages) ? messages : [];
    const left = Math.max(1, Math.min(start, end));
    const right = Math.min(list.length, Math.max(start, end));
    if (!Number.isFinite(left) || !Number.isFinite(right) || left > list.length) {
      throw new Error("Range is outside the loaded chat.");
    }
    return list.slice(left - 1, right);
  }

  function tokenizeCommandTail(text) {
    const tokens = [];
    const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
    let match;
    while ((match = re.exec(String(text || "")))) {
      tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1"));
    }
    return tokens;
  }

  function looksLikeNativeMessageRange(value) {
    const text = String(value || "").trim().toLowerCase();
    return (
      text === "all" ||
      /^last\s+\d+$/u.test(text) ||
      /^from\s+\d+\s+to\s+\d+$/u.test(text) ||
      /^\d+(?:\s*-\s*\d+)?$/u.test(text)
    );
  }


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



  // Upstream gap MB-011: some declared or desired capability package slots are
  // not yet mounted by the Marinara host. Bridge mounts package custom elements
  // with upstream-style `view` and `capabilityProps` so packages can move to the
  // native slot renderer later without changing their element contract.

  const CAPABILITY_SLOT_STATE_KEY = "__mariBridgeCapabilitySlotState";

  const CAPABILITY_SLOT_CHAT_SETTINGS = "chat-settings";
  const CAPABILITY_SLOT_MESSAGE_ACTIONS = "message-actions";
  const CAPABILITY_SLOT_TOPBAR_PANEL = "topbar-panel";

  const KNOWN_CAPABILITY_SLOTS = new Set([
    CAPABILITY_SLOT_CHAT_SETTINGS,
    CAPABILITY_SLOT_MESSAGE_ACTIONS,
    CAPABILITY_SLOT_TOPBAR_PANEL,
  ]);
  const AGENT_SETTINGS_SURFACE_CLASS = "border border-[var(--border)] bg-[var(--secondary)]/70";
  const GENERATED_AGENT_CARD_SELECTOR = "[data-mari-bridge-generated-agent-card]";
  const SLOT_LOG_PREFIX = "[mari-bridge:slots]";

  registerBridgeCapabilities([
    "ui-slots:chat-settings",
    "ui-slots:message-actions",
    "ui-slots:topbar-panel",
    "capability-slots:register",
  ]);

  function registerCapabilitySlotContribution(contribution) {
    const normalized = normalizeCapabilitySlotContribution(contribution);
    const state = getCapabilitySlotState();
    state.contributions.set(normalized.key, normalized);
    logCapabilitySlotState(state, `contribution:${normalized.key}`, "registered contribution", {
      slot: normalized.slot,
      packageId: normalized.packageId,
      id: normalized.id,
      view: normalized.view,
      match: normalized.match,
    });
    ensureCapabilitySlotBridge();
    scheduleCapabilitySlotRenderInternal(0);
    return () => {
      const current = state.contributions.get(normalized.key);
      if (current !== normalized) return;
      state.contributions.delete(normalized.key);
      logCapabilitySlotState(state, `contribution:${normalized.key}`, "removed contribution", {
        slot: normalized.slot,
        packageId: normalized.packageId,
        id: normalized.id,
      });
      unmountContributionFamily(state, normalized.key);
      scheduleCapabilitySlotRenderInternal(0);
    };
  }

  function ensureCapabilitySlotBridge(options = {}) {
    const state = getCapabilitySlotState();
    state.renderDelayMs = Number.isFinite(Number(options.renderDelayMs)) ? Number(options.renderDelayMs) : 120;
    claimBridgeSubsystem("capability-slots", {
      version: MARI_BRIDGE_VERSION,
      ownerId: "mari-bridge:capability-slots",
      install: ({ token }) => {
        state.ownerToken = token;
        state.scope = createDomScope();
        state.scheduleRender = (delayMs) => scheduleCapabilitySlotRenderForOwner(state, delayMs, token);
        if (document.readyState === "loading") {
          state.scope.on(document, "DOMContentLoaded", () => startCapabilitySlotObservation(state, token), { once: true });
        } else {
          startCapabilitySlotObservation(state, token);
        }
        return () => {
          unmountAll(state);
          disconnectChatSettingsPanelWatcher(state);
          state.scope?.destroy?.();
          state.scope = null;
          state.observer = null;
          state.chatSettingsPanel = null;
          state.renderTimerDueAt = 0;
          state.ownerToken = null;
          state.scheduleRender = null;
        };
      },
    });
    return state;
  }

  function scheduleCapabilitySlotRender(delayMs) {
    scheduleCapabilitySlotRenderInternal(delayMs);
  }

  function getCapabilitySlotState() {
    if (!window[CAPABILITY_SLOT_STATE_KEY]) {
      window[CAPABILITY_SLOT_STATE_KEY] = {
        contributions: new Map(),
        mounted: new Map(),
        scope: null,
        observer: null,
        chatSettingsPanel: null,
        chatSettingsPanelScope: null,
        chatSettingsPanelObserver: null,
        debugValues: new Map(),
        renderTimer: 0,
        renderTimerDueAt: 0,
        renderDelayMs: 120,
        ownerToken: null,
        scheduleRender: null,
      };
    }
    const state = window[CAPABILITY_SLOT_STATE_KEY];
    if (!(state.contributions instanceof Map)) state.contributions = new Map();
    if (!(state.mounted instanceof Map)) state.mounted = new Map();
    if (!(state.debugValues instanceof Map)) state.debugValues = new Map();
    state.renderTimerDueAt = Number(state.renderTimerDueAt) || 0;
    return state;
  }

  function startCapabilitySlotObservation(state, token) {
    if (!isBridgeSubsystemOwner("capability-slots", token)) return;
    logCapabilitySlotState(state, "observer:body", "started outer slot observer", { bridgeVersion: MARI_BRIDGE_VERSION });
    state.scope.on(window, "focus", () => handleCapabilitySlotDomChange(state, token, 0));
    state.scope.on(window, "resize", () => scheduleCapabilitySlotRenderInternal());
    state.scope.on(window, "popstate", () => handleCapabilitySlotDomChange(state, token, 0));
    state.scope.cleanup(watchActiveChatId(() => handleCapabilitySlotDomChange(state, token, 0), { debounceMs: 80, intervalMs: 1_000 }));
    patchCapabilitySlotHistoryMethod("pushState");
    patchCapabilitySlotHistoryMethod("replaceState");
    if (document.body) {
      state.observer = state.scope.observe(document.body, (mutations) => {
        if (shouldIgnoreBridgeOwnedMutations(mutations)) return;
        handleCapabilitySlotDomChange(state, token);
      }, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-chat-agent-entry", "data-message-id", "data-message-role", "data-chat-floating-panel", "class", "style"],
      });
    }
    handleCapabilitySlotDomChange(state, token, 0);
  }

  function handleCapabilitySlotDomChange(state, token, delayMs) {
    if (!isBridgeSubsystemOwner("capability-slots", token)) return;
    syncChatSettingsPanelWatcher(state, token);
    scheduleCapabilitySlotRenderInternal(delayMs);
  }

  function syncChatSettingsPanelWatcher(state, token) {
    if (!isBridgeSubsystemOwner("capability-slots", token)) return;
    const panel = findChatSettingsPanel();
    if (panel === state.chatSettingsPanel) return;
    disconnectChatSettingsPanelWatcher(state);
    state.chatSettingsPanel = panel;
    if (!(panel instanceof HTMLElement)) {
      logCapabilitySlotState(state, "chat-settings:panel", "chat settings panel missing", {});
      unmountSlot(state, CAPABILITY_SLOT_CHAT_SETTINGS);
      return;
    }
    logCapabilitySlotState(state, "chat-settings:panel", "chat settings panel found", describeElement(panel));
    const panelScope = createDomScope();
    state.chatSettingsPanelScope = panelScope;
    state.scope?.cleanup?.(() => panelScope.destroy());
    state.chatSettingsPanelObserver = panelScope.observe(panel, (mutations) => {
      if (shouldIgnoreBridgeOwnedMutations(mutations)) return;
      if (!document.body?.contains(panel) || !isVisibleElement(panel)) {
        logCapabilitySlotState(state, "chat-settings:panel", "chat settings panel disappeared", describeElement(panel));
        syncChatSettingsPanelWatcher(state, token);
        scheduleCapabilitySlotRenderInternal(0);
        return;
      }
      scheduleCapabilitySlotRenderInternal();
    }, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-chat-settings-section", "data-chat-agent-entry", "class", "style"],
    });
    logCapabilitySlotState(state, "chat-settings:panel-observer", "attached chat settings panel observer", describeElement(panel));
    scheduleCapabilitySlotRenderInternal(0);
  }

  function disconnectChatSettingsPanelWatcher(state) {
    if (state.chatSettingsPanel || state.chatSettingsPanelScope) {
      logCapabilitySlotState(state, "chat-settings:panel-observer", "detached chat settings panel observer", {});
    }
    state.chatSettingsPanelScope?.destroy?.();
    state.chatSettingsPanelScope = null;
    state.chatSettingsPanelObserver = null;
    state.chatSettingsPanel = null;
  }

  function scheduleCapabilitySlotRenderInternal(delayMs) {
    const state = getCapabilitySlotState();
    ensureCapabilitySlotBridge();
    if (typeof state.scheduleRender === "function") state.scheduleRender(delayMs);
  }

  function scheduleCapabilitySlotRenderForOwner(state, delayMs, token) {
    if (!isBridgeSubsystemOwner("capability-slots", token)) return;
    const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : state.renderDelayMs;
    const dueAt = Date.now() + delay;
    if (state.renderTimer) {
      if (delay > 0 && state.renderTimerDueAt > 0 && state.renderTimerDueAt <= dueAt) return;
      state.scope?.clearTimer?.(state.renderTimer);
    }
    state.renderTimerDueAt = dueAt;
    state.renderTimer = (state.scope || createDomScope()).timeout(() => {
      state.renderTimer = 0;
      state.renderTimerDueAt = 0;
      if (isBridgeSubsystemOwner("capability-slots", token)) renderCapabilitySlots(state);
    }, delay);
  }

  function renderCapabilitySlots(state) {
    const visible = new Set();
    const contributions = [...state.contributions.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
    for (const contribution of contributions) {
      for (const context of findSlotContexts(contribution)) {
        if (contribution.shouldShow(context) === false) continue;
        const slotHost = ensureSlotContributionHost(contribution, context);
        if (!slotHost) continue;
        const mountKey = context.mountKey ? `${contribution.key}:${context.mountKey}` : contribution.key;
        visible.add(mountKey);
        mountOrUpdateContribution(state, mountKey, contribution, slotHost, context);
      }
    }
    for (const key of [...state.mounted.keys()]) {
      if (!visible.has(key)) unmountContribution(state, key);
    }
  }

  function findSlotContexts(contribution) {
    if (contribution.slot === CAPABILITY_SLOT_CHAT_SETTINGS) return findChatSettingsContexts(contribution);
    if (contribution.slot === CAPABILITY_SLOT_MESSAGE_ACTIONS) return findMessageActionContexts(contribution);
    if (contribution.slot === CAPABILITY_SLOT_TOPBAR_PANEL) return findTopbarPanelContexts(contribution);
    return [];
  }

  function findChatSettingsContexts(contribution) {
    const state = getCapabilitySlotState();
    const panel = findChatSettingsPanel();
    if (!panel) {
      if (contribution.slot === CAPABILITY_SLOT_CHAT_SETTINGS) {
        logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for chat settings panel", {
          sectionId: contribution.match.sectionId || "",
        });
      }
      return [];
    }
    const chatId = getActiveChatIdFromClient();
    const agentId = contribution.match.agentId || contribution.packageId;
    if (contribution.match.sectionId) {
      const section = findChatSettingsSection(panel, contribution.match.sectionId);
      const sectionStack = findChatSettingsSectionStack(section);
      if (!section) {
        logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for chat settings section", {
          chatId,
          sectionId: contribution.match.sectionId,
          panel: true,
        });
        return [];
      }
      if (!sectionStack) {
        logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for open chat settings section content", {
          chatId,
          sectionId: contribution.match.sectionId,
          sectionChildren: section.children.length,
          headerExpanded: section.firstElementChild?.getAttribute?.("aria-expanded") || "",
        });
        return [];
      }
      logCapabilitySlotState(state, `context:${contribution.key}`, "chat settings section content ready", {
        chatId,
        sectionId: contribution.match.sectionId,
        stackChildren: sectionStack.children.length,
      });
      const agentCard = findAgentSettingsCard(section, chatId, agentId);
      return [{ slot: contribution.slot, chatId, panel, section, sectionStack, agentId, agentCard, mountKey: "chat-settings" }];
    }
    const section = findChatSettingsSection(panel, contribution.match.sectionId);
    const agentEntry = findAgentEntry(panel, agentId);
    const agentCard = findAgentSettingsCard(panel, chatId, agentId);
    if (!section && !agentEntry && !agentCard) {
      logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for generic chat settings target", {
        chatId,
        agentId,
      });
      return [];
    }
    return [{ slot: contribution.slot, chatId, panel, section, agentId, agentEntry, agentCard, mountKey: "chat-settings" }];
  }

  function findMessageActionContexts(contribution) {
    const chatId = getActiveChatIdFromClient();
    const nodes = Array.from(document.querySelectorAll("[data-message-id]")).filter(
      (node) => node instanceof HTMLElement && isVisibleElement(node),
    );
    return nodes.flatMap((node) => {
      const messageId = node.getAttribute("data-message-id") || "";
      if (!messageId) return [];
      const role = node.getAttribute("data-message-role") || "";
      return [{ slot: contribution.slot, chatId, messageId, role, node, mountKey: messageId }];
    });
  }

  function findTopbarPanelContexts(contribution) {
    const host = findTopbarHost();
    if (!host) return [];
    return [{ slot: contribution.slot, chatId: getActiveChatIdFromClient(), topbarHost: host, mountKey: "topbar" }];
  }

  function ensureSlotContributionHost(contribution, context) {
    if (context.slot === CAPABILITY_SLOT_CHAT_SETTINGS) return ensureChatSettingsHost(context, contribution);
    if (context.slot === CAPABILITY_SLOT_MESSAGE_ACTIONS) return ensureMessageActionHost(context.node, contribution);
    if (context.slot === CAPABILITY_SLOT_TOPBAR_PANEL) return ensureTopbarPanelHost(context.topbarHost, contribution);
    return null;
  }

  function mountOrUpdateContribution(state, mountKey, contribution, slotHost, context) {
    let mounted = state.mounted.get(mountKey);
    if (!mounted || mounted.slotHost !== slotHost) {
      unmountContribution(state, mountKey);
      const element = document.createElement(`marinara-capability-${contribution.packageId}`);
      element.setAttribute("view", contribution.view);
      if (contribution.className) element.className = contribution.className;
      element.dataset.mariBridgeCapabilitySlot = contribution.slot;
      element.dataset.mariBridgePackageId = contribution.packageId;
      element.dataset.mariBridgeContributionId = contribution.id;
      slotHost.appendChild(element);
      mounted = { element, slotHost };
      state.mounted.set(mountKey, mounted);
      logCapabilitySlotState(state, `mounted:${mountKey}`, "mounted capability element", {
        packageId: contribution.packageId,
        id: contribution.id,
        slot: contribution.slot,
        view: contribution.view,
        chatId: context.chatId || "",
        sectionId: context.section?.dataset?.chatSettingsSection || "",
        host: describeElement(slotHost),
      });
    }
    setCapabilityProps(mounted.element, contribution, context);
  }

  function unmountContribution(state, key) {
    const mounted = state.mounted.get(key);
    state.mounted.delete(key);
    if (mounted?.element) {
      logCapabilitySlotState(state, `mounted:${key}`, "unmounted capability element", {
        slot: mounted.element.dataset.mariBridgeCapabilitySlot || "",
        packageId: mounted.element.dataset.mariBridgePackageId || "",
        id: mounted.element.dataset.mariBridgeContributionId || "",
      });
    }
    mounted?.element?.remove();
    cleanupEmptyHost(mounted?.slotHost);
  }

  function unmountAll(state) {
    for (const key of [...state.mounted.keys()]) unmountContribution(state, key);
  }

  function unmountSlot(state, slot) {
    for (const [key, mounted] of [...state.mounted.entries()]) {
      if (mounted?.element?.dataset?.mariBridgeCapabilitySlot === slot) unmountContribution(state, key);
    }
  }

  function unmountContributionFamily(state, contributionKey) {
    for (const key of [...state.mounted.keys()]) {
      if (key === contributionKey || key.startsWith(`${contributionKey}:`)) unmountContribution(state, key);
    }
  }

  function setCapabilityProps(element, contribution, context) {
    const extraProps = typeof contribution.props === "function" ? normalizeObject(contribution.props(context)) : contribution.props;
    element.capabilityProps = {
      ...extraProps,
      chatId: context.chatId || extraProps.chatId || "",
      slot: contribution.slot,
      packageId: contribution.packageId,
      contributionId: contribution.id,
      messageId: context.messageId,
      role: context.role,
      agentId: context.agentId,
    };
    element.dispatchEvent(new CustomEvent("marinara-capability-props"));
  }

  function findChatSettingsPanel() {
    const panels = Array.from(
      document.querySelectorAll(
        ".mari-chat-settings-drawer[data-chat-floating-panel], [data-chat-floating-panel].mari-chat-settings-drawer, .mari-chat-settings-popover[data-chat-floating-panel], [data-chat-floating-panel].mari-chat-settings-popover",
      ),
    );
    return panels.find((panel) => panel instanceof HTMLElement && isVisibleElement(panel)) || null;
  }

  function findAgentEntry(panel, agentId) {
    if (!panel || !agentId) return null;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(agentId) : agentId.replaceAll('"', '\\"');
    const entry = panel.querySelector(`[data-chat-agent-entry="${escaped}"]`);
    return entry instanceof HTMLElement && isVisibleElement(entry) ? entry : null;
  }

  function findChatSettingsSection(panel, sectionId) {
    if (!panel || !sectionId) return null;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sectionId) : cssAttributeValue(sectionId);
    const section = panel.querySelector(`[data-chat-settings-section="${escaped}"]`);
    return section instanceof HTMLElement && isVisibleElement(section) ? section : null;
  }

  function findAgentSettingsCard(panel, chatId, agentId) {
    if (!panel || !agentId) return null;
    const cardId = getAgentSettingsCardId(chatId, agentId);
    if (cardId) {
      const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(cardId) : cardId.replaceAll('"', '\\"');
      const existing = panel.querySelector(`#${escaped}`);
      if (existing instanceof HTMLElement) return existing;
    }
    const generated = panel.querySelector(`${GENERATED_AGENT_CARD_SELECTOR}[data-mari-bridge-agent-id="${cssAttributeValue(agentId)}"]`);
    return generated instanceof HTMLElement ? generated : null;
  }

  function ensureChatSettingsHost(context, contribution) {
    const state = getCapabilitySlotState();
    const card = context.agentCard || ensureGeneratedAgentSettingsCard(context.panel, context.agentId, contribution, context);
    if (card) {
      ensureGeneratedAgentSettingsCardPlacement(card, context, contribution);
      const body = ensureGeneratedAgentSettingsBody(card);
      if (body) return ensureContributionHost(body, contribution, "div", "mari-bridge-slot-host mari-bridge-chat-settings-host");
    }
    if (!context.agentEntry) {
      logCapabilitySlotState(state, `host:${contribution.key}`, "no chat settings host available", {
        sectionId: context.section?.dataset?.chatSettingsSection || "",
        agentId: context.agentId || "",
      });
      return null;
    }
    return ensureContributionHost(context.agentEntry, contribution, "div", "mari-bridge-slot-host mari-bridge-chat-settings-host");
  }

  function ensureGeneratedAgentSettingsCard(panel, agentId, contribution, context = null) {
    const state = getCapabilitySlotState();
    if (!panel || !agentId) return null;
    const existing = findAgentSettingsCard(panel, getActiveChatIdFromClient(), agentId);
    if (existing) {
      logCapabilitySlotState(state, `card:${contribution.key}`, "found existing settings card", {
        agentId,
        card: describeElement(existing),
      });
      return existing;
    }
    const parent = findAgentSettingsCardContainer(panel, context, contribution);
    if (!parent) {
      logCapabilitySlotState(state, `card:${contribution.key}`, "waiting for settings card parent", {
        agentId,
        sectionId: context?.section?.dataset?.chatSettingsSection || "",
      });
      return null;
    }
    const card = document.createElement("div");
    const cardId = getAgentSettingsCardId(getActiveChatIdFromClient(), agentId);
    if (cardId) {
      card.id = cardId;
      card.tabIndex = -1;
    }
    card.dataset.mariBridgeGeneratedAgentCard = contribution.key;
    card.dataset.mariBridgeAgentId = agentId;
    card.className = `scroll-mt-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/45 ${AGENT_SETTINGS_SURFACE_CLASS}`;
    if (Number.isFinite(contribution.order)) card.style.order = String(contribution.order);

    const header = document.createElement("div");
    header.className = "flex items-start p-3";
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "-m-1 flex min-w-0 flex-1 items-start gap-2 rounded-lg p-1 text-left transition-colors hover:bg-[var(--accent)]/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/60";
    button.setAttribute("aria-expanded", "true");
    const icon = document.createElement("span");
    icon.className = "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[0.5625rem] font-semibold text-[var(--primary)] ring-1 ring-[var(--primary)]/30";
    icon.textContent = contribution.iconText || contribution.title.charAt(0) || "P";
    const text = document.createElement("span");
    text.className = "min-w-0 flex-1";
    const title = document.createElement("span");
    title.className = "flex min-w-0 items-center gap-1.5 text-[0.6875rem] font-medium";
    const titleText = document.createElement("span");
    titleText.className = "min-w-0 truncate";
    titleText.textContent = contribution.title;
    title.appendChild(titleText);
    const description = document.createElement("span");
    description.className = "mt-1 block text-[0.625rem] text-[var(--muted-foreground)]";
    description.textContent = contribution.description;
    text.append(title, description);
    const chevron = document.createElement("span");
    chevron.className = "mt-0.5 shrink-0 text-[var(--muted-foreground)]";
    chevron.textContent = "›";
    chevron.style.transform = "rotate(90deg)";
    button.append(icon, text, chevron);
    header.appendChild(button);
    const body = document.createElement("div");
    body.className = "space-y-2 px-3 pb-2";
    body.dataset.mariBridgeAgentSettingsBody = "true";
    button.addEventListener("click", () => {
      const open = body.hidden === true;
      body.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
      chevron.style.transform = open ? "rotate(90deg)" : "rotate(0deg)";
    });
    card.append(header, body);
    insertGeneratedAgentSettingsCard(parent, card, context, contribution);
    logCapabilitySlotState(state, `card:${contribution.key}`, "created generated settings card", {
      agentId,
      sectionId: context?.section?.dataset?.chatSettingsSection || "",
      parent: describeElement(parent),
    });
    return card;
  }

  function findAgentSettingsCardContainer(panel, context, contribution) {
    if (context?.sectionStack instanceof HTMLElement) return context.sectionStack;
    const generated = panel.querySelector(GENERATED_AGENT_CARD_SELECTOR);
    if (generated?.parentElement instanceof HTMLElement) return generated.parentElement;
    const existingCards = Array.from(panel.querySelectorAll('[id^="chat-settings-agent-menu-"]')).filter(
      (node) => node instanceof HTMLElement,
    );
    const lastCard = existingCards.at(-1);
    if (lastCard?.parentElement instanceof HTMLElement) return lastCard.parentElement;
    const agentEntries = Array.from(panel.querySelectorAll("[data-chat-agent-entry]")).filter((node) => node instanceof HTMLElement);
    const lastEntry = agentEntries.at(-1);
    return lastEntry?.parentElement instanceof HTMLElement ? lastEntry.parentElement : null;
  }

  function ensureGeneratedAgentSettingsCardPlacement(card, context, contribution) {
    const state = getCapabilitySlotState();
    if (!(card instanceof HTMLElement) || !card.matches(GENERATED_AGENT_CARD_SELECTOR)) return;
    const parent = findAgentSettingsCardContainer(context.panel, context, contribution);
    if (!parent) return;
    insertGeneratedAgentSettingsCard(parent, card, context, contribution);
    logCapabilitySlotState(state, `card-placement:${contribution.key}`, "placed generated settings card", {
      sectionId: context.section?.dataset?.chatSettingsSection || "",
      parent: describeElement(parent),
    });
  }

  function findChatSettingsSectionStack(section) {
    if (!(section instanceof HTMLElement)) return null;
    const content = section.children[1];
    if (!(content instanceof HTMLElement)) return null;
    const stack = content.firstElementChild;
    if (stack instanceof HTMLElement && stack.classList.contains("space-y-2")) return stack;
    return content;
  }

  function insertGeneratedAgentSettingsCard(parent, card, context, contribution) {
    const after = findChatSettingsSectionInsertionAnchor(parent, context, contribution);
    if (after?.parentElement === parent) {
      if (card.parentElement === parent && card.previousElementSibling === after) return;
      after.after(card);
      return;
    }
    if (card.parentElement === parent && parent.firstElementChild === card) return;
    parent.prepend(card);
  }

  function findChatSettingsSectionInsertionAnchor(parent, context) {
    if (context?.section?.dataset?.chatSettingsSection !== "roleplay-agents") return null;
    const directButtons = Array.from(parent.children).filter(
      (child) => child instanceof HTMLElement && child.tagName === "BUTTON",
    );
    return directButtons.at(-1) || null;
  }

  function ensureGeneratedAgentSettingsBody(card) {
    const body = card.querySelector(":scope > [data-mari-bridge-agent-settings-body]");
    if (body instanceof HTMLElement) return body;
    const nativeBody = Array.from(card.children).find(
      (child) =>
        child instanceof HTMLElement &&
        child.classList.contains("space-y-2") &&
        child.classList.contains("px-3") &&
        child.classList.contains("pb-2"),
    );
    if (nativeBody instanceof HTMLElement) return nativeBody;
    return card;
  }

  function ensureContributionHost(parent, contribution, tagName, className) {
    const state = getCapabilitySlotState();
    let host = parent.querySelector(`:scope > [data-mari-bridge-slot-host="${contribution.key}"]`);
    if (!(host instanceof HTMLElement)) {
      host = document.createElement(tagName);
      host.dataset.mariBridgeSlotHost = contribution.key;
      host.className = className;
      parent.appendChild(host);
      logCapabilitySlotState(state, `host:${contribution.key}`, "created contribution host", {
        slot: contribution.slot,
        parent: describeElement(parent),
      });
    }
    return host;
  }

  function ensureMessageActionHost(node, contribution) {
    const actionBar = node.querySelector(":scope .mari-message-actions") || node;
    let host = actionBar.querySelector(`:scope > [data-mari-bridge-slot-host="${contribution.key}"]`);
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("span");
      host.dataset.mariBridgeSlotHost = contribution.key;
      host.className = "mari-bridge-slot-host mari-bridge-message-action-host";
      actionBar.appendChild(host);
    }
    return host;
  }

  function findTopbarHost() {
    const hosts = Array.from(document.querySelectorAll(".mari-topbar-panel-nav, .mari-topbar-left-controls, .mari-topbar"));
    return hosts.find((host) => host instanceof HTMLElement && isVisibleElement(host)) || null;
  }

  function ensureTopbarPanelHost(topbarHost, contribution) {
    let host = topbarHost.querySelector(`:scope > [data-mari-bridge-slot-host="${contribution.key}"]`);
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("span");
      host.dataset.mariBridgeSlotHost = contribution.key;
      host.className = "mari-bridge-slot-host mari-bridge-topbar-panel-host";
      topbarHost.appendChild(host);
    }
    return host;
  }

  function cleanupEmptyHost(host) {
    if (host instanceof HTMLElement && host.childElementCount === 0) host.remove();
  }

  function shouldIgnoreBridgeOwnedMutations(mutations) {
    const list = Array.from(mutations || []);
    return list.length > 0 && list.every(isBridgeOwnedMutation);
  }

  function isBridgeOwnedMutation(mutation) {
    if (isBridgeOwnedNode(mutation.target)) return true;
    const changedNodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
    return changedNodes.length > 0 && changedNodes.every(isBridgeOwnedNode);
  }

  function isBridgeOwnedNode(node) {
    if (!(node instanceof Node)) return false;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!(element instanceof HTMLElement)) return false;
    return Boolean(
      element.closest(
        `${GENERATED_AGENT_CARD_SELECTOR}, [data-mari-bridge-slot-host], [data-mari-bridge-capability-slot]`,
      ),
    );
  }

  function logCapabilitySlotState(state, key, message, details = {}) {
    if (!(state.debugValues instanceof Map)) state.debugValues = new Map();
    const signature = `${message}:${stableDebugSignature(details)}`;
    if (state.debugValues.get(key) === signature) return;
    state.debugValues.set(key, signature);
    globalThis.console?.info?.(SLOT_LOG_PREFIX, message, details);
  }

  function stableDebugSignature(value) {
    try {
      return JSON.stringify(value, Object.keys(value || {}).sort());
    } catch {
      return String(value);
    }
  }

  function describeElement(element) {
    if (!(element instanceof HTMLElement)) return {};
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      className: typeof element.className === "string" ? element.className : "",
      chatSettingsSection: element.dataset.chatSettingsSection || "",
      chatFloatingPanel: element.dataset.chatFloatingPanel || "",
      chatAgentEntry: element.dataset.chatAgentEntry || "",
      bridgeSlotHost: element.dataset.mariBridgeSlotHost || "",
    };
  }

  function normalizeCapabilitySlotContribution(contribution) {
    const packageId = String(contribution?.packageId || "").trim();
    const id = String(contribution?.id || "").trim();
    const slot = String(contribution?.slot || "").trim();
    const view = String(contribution?.view || defaultViewForSlot(slot)).trim();
    if (!packageId) throw new Error("Capability slot contribution requires packageId.");
    if (!id) throw new Error("Capability slot contribution requires id.");
    if (!KNOWN_CAPABILITY_SLOTS.has(slot)) throw new Error(`Unknown capability slot: ${slot || "(missing)"}.`);
    if (!view) throw new Error(`Capability slot contribution ${packageId}:${id} requires view.`);
    return {
      packageId,
      id,
      slot,
      view,
      key: `${packageId}:${id}`,
      match: normalizeObject(contribution.match),
      className: String(contribution.className || ""),
      priority: Number.isFinite(Number(contribution.priority)) ? Number(contribution.priority) : 100,
      order: Number.isFinite(Number(contribution.order)) ? Number(contribution.order) : null,
      title: String(contribution.title || contribution.packageId || packageId),
      description: String(contribution.description || ""),
      iconText: String(contribution.iconText || "").trim().slice(0, 2),
      props: typeof contribution.props === "function" ? contribution.props : normalizeObject(contribution.props),
      shouldShow: typeof contribution.shouldShow === "function" ? contribution.shouldShow : () => true,
    };
  }

  function getAgentSettingsCardId(chatId, agentId) {
    if (!chatId || !agentId) return "";
    return `chat-settings-agent-menu-${chatId}-${agentId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  function cssAttributeValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function defaultViewForSlot(slot) {
    if (slot === CAPABILITY_SLOT_CHAT_SETTINGS) return "settings";
    if (slot === CAPABILITY_SLOT_MESSAGE_ACTIONS) return "message-actions";
    if (slot === CAPABILITY_SLOT_TOPBAR_PANEL) return "toolbar";
    return "";
  }

  function normalizeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function patchCapabilitySlotHistoryMethod(method) {
    const state = getCapabilitySlotHistoryState();
    state.watchers[method].add(scheduleCapabilitySlotRenderInternal);
    const original = history[method];
    if (original && !state.patched[method]) {
      state.original[method] = original;
      history[method] = function patchedHistoryMethod(...args) {
        const result = state.original[method].apply(this, args);
        for (const watcher of [...state.watchers[method]]) watcher(0);
        return result;
      };
      state.patched[method] = true;
    }
  }

  function getCapabilitySlotHistoryState() {
    const key = "__mariBridgeCapabilitySlotHistoryState";
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



  // Upstream gap MB-001: packages cannot register Roleplay/Conversation slash commands.

  const COMMAND_BRIDGE_STATE_KEY = "__mariBridgeSlashCommandState";

  function createSlashCommandRouter() {
    const registrations = new Map();
    return {
      register(registration) {
        const normalized = normalizeRegistration(registration);
        registrations.set(normalized.id, normalized);
        return () => registrations.delete(normalized.id);
      },
      match(rawText) {
        return matchSlashCommand(rawText, [...registrations.values()]);
      },
      async run(rawText, context = {}) {
        const match = matchSlashCommand(rawText, [...registrations.values()]);
        if (!match) return { handled: false };
        const result = await match.registration.handler({ ...match, context });
        return { handled: true, result };
      },
    };
  }

  // Registers a browser-side package slash command or native-command augment.
  function registerBridgeSlashCommand(registration) {
    const normalized = normalizeBridgeCommandRegistration(registration);
    const state = getCommandBridgeState();
    state.registrations.set(normalized.key, normalized);
    ensureSlashCommandBridge();
    return () => {
      const current = state.registrations.get(normalized.key);
      if (current === normalized) state.registrations.delete(normalized.key);
    };
  }

  // Installs the bridge-owned composer interception runtime.
  function ensureSlashCommandBridge(options = {}) {
    const state = getCommandBridgeState();
    if (typeof options.resolveContext === "function") state.resolveContext = options.resolveContext;
    if (typeof options.onFeedback === "function") state.onFeedback = options.onFeedback;
    claimBridgeSubsystem("slash-commands", {
      version: MARI_BRIDGE_VERSION,
      ownerId: "mari-bridge:slash-commands",
      install: ({ token }) => {
        state.ownerToken = token;
        const start = () => installSlashCommandListeners(token);
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", start, { once: true });
          return () => document.removeEventListener("DOMContentLoaded", start);
        }
        return start();
      },
    });
    return state;
  }

  // Pure helper for tests and packages that want to inspect registered commands.
  function listBridgeSlashCommands() {
    return sortedBridgeRegistrations(getCommandBridgeState());
  }

  function matchSlashCommand(rawText, registrations) {
    const raw = String(rawText || "").trim();
    if (!raw.startsWith("/")) return null;
    for (const registration of registrations || []) {
      const match = matchOne(raw, normalizeRegistration(registration));
      if (match) return match;
    }
    return null;
  }

  function normalizeRegistration(registration) {
    if (!registration?.id) throw new Error("Slash command registration requires an id.");
    if (typeof registration.handler !== "function") {
      throw new Error(`Slash command ${registration.id} requires a handler.`);
    }
    return {
      id: String(registration.id),
      commands: normalizeCommandNames(registration.commands || registration.command || registration.name),
      hijacks: normalizeCommandNames(registration.hijacks || []),
      owns: typeof registration.owns === "function" ? registration.owns : () => true,
      handler: registration.handler,
    };
  }

  function normalizeCommandNames(value) {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter(Boolean)
      .map((item) => String(item).trim().toLowerCase())
      .map((item) => (item.startsWith("/") ? item : `/${item}`));
  }

  function matchOne(raw, registration) {
    const lower = raw.toLowerCase();
    const direct = registration.commands.find((command) => lower === command || lower.startsWith(`${command} `));
    if (direct) {
      const tail = raw.slice(direct.length).trim();
      const tokens = tokenizeCommandTail(tail);
      if (!registration.owns({ raw, command: direct, tail, tokens, hijacked: false })) return null;
      return { registration, raw, command: direct, tail, tokens, hijacked: false };
    }

    for (const hijack of registration.hijacks) {
      if (lower !== hijack && !lower.startsWith(`${hijack} `)) continue;
      const tail = raw.slice(hijack.length).trim();
      const tokens = tokenizeCommandTail(tail);
      if (!tokens.length) continue;
      if (looksLikeNativeMessageRange(tail)) continue;
      if (!registration.owns({ raw, command: hijack, tail, tokens, hijacked: true })) continue;
      return { registration, raw, command: hijack, tail, tokens, hijacked: true };
    }

    return null;
  }

  function createHideHijackOwner() {
    return ({ tokens }) => {
      const first = tokens[0] || "";
      return Boolean(first) && !looksLikeNativeMessageRange(first);
    };
  }

  function getCommandBridgeState() {
    if (!window[COMMAND_BRIDGE_STATE_KEY]) {
      window[COMMAND_BRIDGE_STATE_KEY] = {
        started: false,
        registrations: new Map(),
        resolveContext: null,
        onFeedback: null,
        ownerToken: null,
      };
    }
    const state = window[COMMAND_BRIDGE_STATE_KEY];
    if (!(state.registrations instanceof Map)) state.registrations = new Map();
    if (!("ownerToken" in state)) state.ownerToken = null;
    return state;
  }

  function installSlashCommandListeners(token) {
    const onKeyDown = (event) => {
      if (isBridgeSubsystemOwner("slash-commands", token)) onComposerKeyDownCapture(event);
    };
    const onSubmit = (event) => {
      if (isBridgeSubsystemOwner("slash-commands", token)) onComposerSubmitCapture(event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("submit", onSubmit, true);
    };
  }

  async function onComposerKeyDownCapture(event) {
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return;
    await maybeHandleBridgeSlashCommand(event, target);
  }

  async function onComposerSubmitCapture(event) {
    if (event.defaultPrevented) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const field = form.querySelector("textarea, input[type='text']");
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      await maybeHandleBridgeSlashCommand(event, field);
    }
  }

  async function maybeHandleBridgeSlashCommand(event, field) {
    const raw = String(field.value || "").trim();
    if (!raw.startsWith("/")) return;
    const state = getCommandBridgeState();
    const match = matchSlashCommand(raw, sortedBridgeRegistrations(state));
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const context = await resolveCommandContext(state, { raw, field, match });
    try {
      const result = await match.registration.handler({ ...match, context });
      if (result?.clearInput !== false) setTextControlValue(field, "");
      publishCommandFeedback(state, {
        ok: true,
        packageId: match.registration.packageId,
        id: match.registration.id,
        command: match.command,
        result,
      });
    } catch (error) {
      publishCommandFeedback(state, {
        ok: false,
        packageId: match.registration.packageId,
        id: match.registration.id,
        command: match.command,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function resolveCommandContext(state, base) {
    const context = {
      chatId: getActiveChatIdFromClient(),
      field: base.field,
      raw: base.raw,
      match: base.match,
    };
    if (typeof state.resolveContext !== "function") return context;
    const extra = await state.resolveContext(context);
    return extra && typeof extra === "object" ? { ...context, ...extra } : context;
  }

  function publishCommandFeedback(state, detail) {
    state.onFeedback?.(detail);
    window.dispatchEvent(new CustomEvent("mari-bridge:slash-command-feedback", { detail }));
  }

  function sortedBridgeRegistrations(state) {
    return [...state.registrations.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  }

  function normalizeBridgeCommandRegistration(registration) {
    const packageId = String(registration?.packageId || "").trim();
    if (!packageId) throw new Error("Bridge slash command registration requires packageId.");
    const normalized = normalizeRegistration(registration);
    const localId = String(registration.id || normalized.id).trim();
    return {
      ...normalized,
      id: localId,
      key: `${packageId}:${localId}`,
      packageId,
      kind: registration.kind === "augment" ? "augment" : "command",
      priority: Number.isFinite(Number(registration.priority)) ? Number(registration.priority) : 100,
    };
  }



  function registerMessageActionContribution(contribution) {
    return registerCapabilitySlotContribution({
      ...contribution,
      slot: CAPABILITY_SLOT_MESSAGE_ACTIONS,
      view: contribution?.view || "message-actions",
    });
  }

  function scheduleMessageActionRender(delayMs) {
    scheduleCapabilitySlotRender(delayMs);
  }



  const PACKAGE_ID = "persona-reapply";
  const TAG_NAME = "marinara-capability-persona-reapply";
  const STYLE_ID = "persona-reapply-styles";
  const state = window.__marinaraPersonaReapplyRuntime || {
    initialized: false,
    overrides: new Map(),
    disposers: [],
    toastTimer: 0,
  };
  window.__marinaraPersonaReapplyRuntime = state;
  state.overrides = state.overrides instanceof Map ? state.overrides : new Map();
  state.disposers = Array.isArray(state.disposers) ? state.disposers : [];

  class PersonaReapplyElement extends HTMLElement {
    constructor() {
      super();
      this.onCapabilityProps = () => this.render();
      this.onClick = (event) => {
        event.stopPropagation();
        this.reapply();
      };
      this.busy = false;
    }

    connectedCallback() {
      this.addEventListener("marinara-capability-props", this.onCapabilityProps);
      this.render();
    }

    disconnectedCallback() {
      this.removeEventListener("marinara-capability-props", this.onCapabilityProps);
    }

    render() {
      if (this.getAttribute("view") !== "message-actions" || this.capabilityProps?.role !== "user") {
        this.replaceChildren();
        this.hidden = true;
        return;
      }
      this.hidden = false;
      let button = this.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "persona-reapply-message-button";
        button.addEventListener("click", this.onClick);
        this.replaceChildren(button);
      }
      button.disabled = this.busy;
      button.replaceChildren();
      const icon = document.createElement("span");
      icon.className = "persona-reapply-message-icon";
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
      button.classList.toggle("persona-reapply-message-button--busy", this.busy);
      button.title = "Reapply this message's persona colours";
      button.setAttribute("aria-label", button.title);

      const key = overrideKey(this.capabilityProps?.chatId, this.capabilityProps?.messageId);
      const update = state.overrides.get(key);
      if (update) applyUpdateToVisibleMessage(update);
    }

    async reapply() {
      const chatId = this.capabilityProps?.chatId || getActiveChatIdFromClient();
      const messageId = this.capabilityProps?.messageId;
      if (!chatId || !messageId || this.busy) return;
      this.busy = true;
      this.render();
      try {
        const data = await fetchJson(
          `/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
          { method: "POST" },
        );
        const update = data.update;
        rememberAndApplyUpdate(chatId, update);
        showToast("Persona colours reapplied.", true);
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), false);
      } finally {
        this.busy = false;
        this.render();
        scheduleMessageActionRender(0);
      }
    }
  }

  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, PersonaReapplyElement);

  if (!state.initialized) {
    state.initialized = true;
    injectStyle(STYLE_ID, personaReapplyStyles());
    registerMessageAction();
    registerSlashCommand();
  }

  function registerMessageAction() {
    state.disposers.push(
      registerMessageActionContribution({
        packageId: PACKAGE_ID,
        id: "reapply-colours",
        title: "Reapply persona colours",
        priority: 72,
        shouldShow: ({ chatId, role }) => Boolean(chatId) && role === "user",
      }),
    );
  }

  function registerSlashCommand() {
    ensureSlashCommandBridge();
    state.disposers.push(
      registerBridgeSlashCommand({
        packageId: PACKAGE_ID,
        id: "reapply-persona",
        commands: ["/reapply-persona"],
        priority: 72,
        async handler({ context }) {
          const chatId = context?.chatId || getActiveChatIdFromClient();
          if (!chatId) throw new Error("Open a chat before using /reapply-persona.");
          const confirmed = window.confirm(
            "Reapply the latest saved colours from each persona to every user message in this chat?",
          );
          if (!confirmed) {
            showToast("Persona colour refresh cancelled.", false);
            return { cancelled: true };
          }
          const data = await fetchJson(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/all`, {
            method: "POST",
          });
          for (const update of data.updates || []) rememberAndApplyUpdate(chatId, update);
          const summary = data.skipped
            ? `Updated ${data.updated} messages; skipped ${data.skipped}.`
            : `Updated ${data.updated} persona messages.`;
          showToast(summary, data.updated > 0);
          scheduleMessageActionRender(0);
          return data;
        },
      }),
    );
  }

  async function fetchJson(url, options) {
    const headers = { ...(options?.headers || {}) };
    const hasBody = options?.body !== undefined && options?.body !== null;
    const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === "content-type");
    if (hasBody && !hasContentType) headers["Content-Type"] = "application/json";
    const request = { ...options };
    if (Object.keys(headers).length > 0) request.headers = headers;
    else delete request.headers;
    const response = await fetch(url, request);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
    return data;
  }

  function rememberAndApplyUpdate(chatId, update) {
    if (!update?.messageId || !update?.personaSnapshot) return;
    state.overrides.set(overrideKey(chatId, update.messageId), update);
    applyUpdateToVisibleMessage(update);
  }

  function overrideKey(chatId, messageId) {
    return `${String(chatId || "")}:${String(messageId || "")}`;
  }

  function applyUpdateToVisibleMessage(update) {
    const messageId = String(update?.messageId || "");
    if (!messageId) return;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(messageId) : cssAttributeValue(messageId);
    const node = document.querySelector(`[data-message-id="${escaped}"]`);
    if (!(node instanceof HTMLElement)) return;
    const next = update.personaSnapshot || {};
    const previous = update.previousSnapshot || {};
    applyNameColor(node, next.nameColor);
    const chatMode = node.closest("[data-chat-mode]")?.getAttribute("data-chat-mode") || "";
    if (chatMode === "conversation") return;
    applyBoxColor(node, next.boxColor);
    applyDialogueColor(node, previous.dialogueColor, next.dialogueColor);
  }

  function applyNameColor(node, color) {
    const name = node.querySelector(".mari-message-name");
    if (!(name instanceof HTMLElement)) return;
    clearGradientStyles(name);
    for (const child of name.querySelectorAll(":scope > span[style]")) clearGradientStyles(child);
    const value = String(color || "").trim();
    if (!value) {
      name.style.removeProperty("color");
      name.style.removeProperty("-webkit-text-fill-color");
      return;
    }
    if (/gradient\(/i.test(value)) {
      name.style.backgroundImage = value;
      name.style.backgroundRepeat = "no-repeat";
      name.style.backgroundSize = "100% 100%";
      name.style.setProperty("-webkit-background-clip", "text");
      name.style.backgroundClip = "text";
      name.style.setProperty("-webkit-text-fill-color", "transparent");
      name.style.color = "transparent";
      return;
    }
    name.style.color = value;
    name.style.setProperty("-webkit-text-fill-color", value);
  }

  function clearGradientStyles(element) {
    if (!(element instanceof HTMLElement)) return;
    element.style.removeProperty("background-image");
    element.style.removeProperty("background-repeat");
    element.style.removeProperty("background-size");
    element.style.removeProperty("background-clip");
    element.style.removeProperty("-webkit-background-clip");
    element.style.removeProperty("-webkit-text-fill-color");
    element.style.removeProperty("display");
    if (element !== element.closest(".mari-message-name")) element.style.removeProperty("color");
  }

  function applyBoxColor(node, color) {
    const bubble = node.querySelector(".mari-message-bubble");
    if (!(bubble instanceof HTMLElement)) return;
    const value = String(color || "").trim();
    if (value) {
      bubble.style.setProperty("--mari-rp-bubble-bg", value);
      bubble.style.backgroundColor = value;
    } else {
      if (bubble.classList.contains("mari-rp-bubble")) {
        const opacity = readChatFontOpacity();
        bubble.style.setProperty(
          "--mari-rp-bubble-bg",
          opacity <= 0
            ? "transparent"
            : `color-mix(in srgb, var(--marinara-chat-chrome-panel-bg) ${opacity.toFixed(2)}%, transparent)`,
        );
      } else {
        bubble.style.removeProperty("--mari-rp-bubble-bg");
      }
      bubble.style.removeProperty("background-color");
    }
  }

  function readChatFontOpacity() {
    try {
      const stored = JSON.parse(localStorage.getItem("marinara-engine-ui") || "{}");
      const value = Number(stored?.state?.chatFontOpacity);
      if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
    } catch {
      // Fall back to Marinara's default below.
    }
    return 90;
  }

  function applyDialogueColor(node, oldColor, newColor) {
    const oldValue = normalizeCssColor(oldColor);
    const newValue = String(newColor || "").trim();
    for (const element of node.querySelectorAll(".mari-message-content strong, .mari-message-content span")) {
      if (!(element instanceof HTMLElement)) continue;
      const current = normalizeCssColor(element.style.color);
      if ((oldValue && current === oldValue) || looksLikeDialogueElement(element)) {
        if (newValue) element.style.color = newValue;
        else element.style.removeProperty("color");
      }
    }
  }

  function normalizeCssColor(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const probe = document.createElement("span");
    probe.style.color = raw;
    return probe.style.color.toLowerCase();
  }

  function looksLikeDialogueElement(element) {
    const text = String(element.textContent || "").trim();
    if (text.length < 2) return false;
    const pairs = { '"': '"', "“": "”", "«": "»", "「": "」", "『": "』", "‹": "›" };
    return pairs[text[0]] === text[text.length - 1];
  }

  function cssAttributeValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function showToast(message, ok) {
    let toast = document.querySelector(".persona-reapply-toast");
    if (!(toast instanceof HTMLElement)) {
      toast = document.createElement("div");
      toast.className = "persona-reapply-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle("persona-reapply-toast--ok", ok);
    toast.classList.remove("persona-reapply-toast--out");
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.add("persona-reapply-toast--out"), 2800);
  }

  function personaReapplyStyles() {
    return `
  ${TAG_NAME}[view="message-actions"] {
    display: inline-flex;
  }

  .persona-reapply-message-button {
    display: inline-flex;
    width: 1.7em;
    height: 1.7em;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: color-mix(in srgb, var(--foreground) 40%, transparent);
    padding: 0;
    font: inherit;
    font-size: 0.8125rem;
    line-height: 1;
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease, opacity 150ms ease, transform 100ms ease;
  }

  .persona-reapply-message-button:hover {
    background: color-mix(in srgb, var(--foreground) 10%, transparent);
    color: color-mix(in srgb, var(--foreground) 70%, transparent);
  }

  .persona-reapply-message-button:active {
    transform: scale(0.9);
  }

  .persona-reapply-message-button:disabled {
    pointer-events: none;
    cursor: not-allowed;
    opacity: 0.3;
  }

  .persona-reapply-message-icon {
    display: block;
    width: 1em;
    height: 1em;
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21a8 8 0 0 1 16 0z'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21a8 8 0 0 1 16 0z'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  [data-chat-mode="conversation"] .persona-reapply-message-button {
    width: auto;
    height: auto;
    border-radius: 0.25rem;
    color: color-mix(in srgb, var(--foreground) 70%, transparent);
    padding: 0.25rem;
    font-size: 0.75rem;
  }

  [data-chat-mode="conversation"] .persona-reapply-message-button:hover {
    background: color-mix(in srgb, var(--foreground) 20%, transparent);
    color: var(--foreground);
  }

  [data-chat-mode="conversation"] .persona-reapply-message-icon {
    width: 0.75rem;
    height: 0.75rem;
  }

  .persona-reapply-message-button--busy .persona-reapply-message-icon {
    animation: persona-reapply-pulse 750ms ease-in-out infinite alternate;
  }

  @keyframes persona-reapply-pulse {
    to { opacity: 0.35; transform: scale(0.88); }
  }

  .persona-reapply-toast {
    position: fixed;
    left: 50%;
    bottom: 5.5rem;
    z-index: 99999;
    max-width: min(90vw, 40rem);
    transform: translateX(-50%);
    border-radius: 0.625rem;
    background: rgba(15, 23, 42, 0.96);
    color: white;
    padding: 0.55rem 0.8rem;
    text-align: center;
    font: 700 0.75rem/1.3 system-ui, sans-serif;
    box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.42);
    transition: opacity 180ms ease;
  }

  .persona-reapply-toast--ok {
    background: linear-gradient(135deg, #059669, #0d9488);
  }

  .persona-reapply-toast--out {
    opacity: 0;
    pointer-events: none;
  }
  `;
  }

})();
