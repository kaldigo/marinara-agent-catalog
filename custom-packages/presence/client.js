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



  function registerCapabilityChatSettingsContribution(contribution) {
    return registerCapabilitySlotContribution({
      ...contribution,
      slot: CAPABILITY_SLOT_CHAT_SETTINGS,
      view: contribution?.view || "settings",
      match: {
        ...(contribution?.match || {}),
        agentId: contribution?.agentId || contribution?.match?.agentId || contribution?.packageId,
      },
    });
  }

  function scheduleChatSettingsRender(delayMs) {
    scheduleCapabilitySlotRender(delayMs);
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



  const PACKAGE_ID = "presence";
  const TAG_NAME = "marinara-capability-presence";
  const state = window.__marinaraPresencePackageRuntime || {
    initialized: false,
    commandDisposers: [],
    chatSettingsDisposer: null,
    activeChatId: "",
    pendingChatId: "",
    chatWatcherCleanup: null,
    ensureTimer: 0,
    ensureInFlight: new Set(),
    lastEnsureAttemptAt: 0,
    lastEnsureAttemptChatId: "",
    settingsTimer: 0,
    settingsDataByChatId: new Map(),
    settingsLoadingChatIds: new Set(),
    settingsLoadPromisesByChatId: new Map(),
    settingsElements: new Set(),
    settingsStyleInjected: false,
  };
  window.__marinaraPresencePackageRuntime = state;
  state.activeChatId = typeof state.activeChatId === "string" ? state.activeChatId : "";
  state.chatSettingsDisposer = typeof state.chatSettingsDisposer === "function" ? state.chatSettingsDisposer : null;
  state.pendingChatId = typeof state.pendingChatId === "string" ? state.pendingChatId : "";
  state.chatWatcherCleanup = typeof state.chatWatcherCleanup === "function" ? state.chatWatcherCleanup : null;
  state.ensureTimer = Number(state.ensureTimer) || 0;
  state.ensureInFlight = state.ensureInFlight instanceof Set ? state.ensureInFlight : new Set();
  state.settingsDataByChatId = state.settingsDataByChatId instanceof Map ? state.settingsDataByChatId : new Map();
  state.settingsLoadingChatIds = state.settingsLoadingChatIds instanceof Set ? state.settingsLoadingChatIds : new Set();
  state.settingsLoadPromisesByChatId =
    state.settingsLoadPromisesByChatId instanceof Map ? state.settingsLoadPromisesByChatId : new Map();
  state.commandDisposers = Array.isArray(state.commandDisposers) ? state.commandDisposers : [];
  state.lastEnsureAttemptAt = Number(state.lastEnsureAttemptAt) || 0;
  state.lastEnsureAttemptChatId = typeof state.lastEnsureAttemptChatId === "string" ? state.lastEnsureAttemptChatId : "";
  state.settingsTimer = Number(state.settingsTimer) || 0;
  state.settingsStyleInjected = state.settingsStyleInjected === true;
  state.settingsElements = state.settingsElements instanceof Set ? state.settingsElements : new Set();

  class PresenceCapabilityElement extends HTMLElement {
    constructor() {
      super();
      this.onCapabilityProps = () => this.render();
    }

    static get observedAttributes() {
      return ["view"];
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (name === "view" && oldValue !== newValue && this.isConnected) this.render();
    }

    connectedCallback() {
      this.addEventListener("marinara-capability-props", this.onCapabilityProps);
      state.settingsElements.add(this);
      this.render();
    }

    disconnectedCallback() {
      this.removeEventListener("marinara-capability-props", this.onCapabilityProps);
      state.settingsElements.delete(this);
    }

    render() {
      if (this.getAttribute("view") !== "settings") {
        this.hidden = true;
        this.setAttribute("aria-hidden", "true");
        this.replaceChildren();
        return;
      }
      injectPresenceSettingsStyle();
      this.hidden = false;
      this.removeAttribute("aria-hidden");
      const mount = getSettingsRenderRoot(this);
      const chatId = getChatIdFromCapabilityProps(this.capabilityProps) || getActiveChatIdFromClient();
      this.dataset.chatId = chatId || "";
      if (!chatId) {
        renderPresenceSettingsNotice(mount, "Open a chat to configure Presence.");
        return;
      }
      const cached = state.settingsDataByChatId.get(chatId);
      if (cached) renderPresenceSettingsSection(mount, cached);
      else renderPresenceSettingsLoading(mount);
      if (!cached || Date.now() - cached.loadedAt >= 5_000) {
        loadPresenceSettings(chatId).then(() => {
          if (this.isConnected && this.getAttribute("view") === "settings" && this.dataset.chatId === chatId) this.render();
        });
      }
    }
  }

  if (!customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, PresenceCapabilityElement);
  }

  if (!state.initialized) {
    state.initialized = true;
    registerPresenceCommands();
  }
  if (!state.chatSettingsDisposer) registerPresenceChatSettings();
  if (!state.chatWatcherCleanup) startChatLifecycleDetection();

  function registerPresenceChatSettings() {
    state.chatSettingsDisposer = registerCapabilityChatSettingsContribution({
      packageId: PACKAGE_ID,
      id: "presence.settings",
      agentId: "presence",
      match: { sectionId: "roleplay-agents" },
      title: "Presence",
      description: "Configure character visibility for this chat.",
      iconText: "P",
      className: "block",
      props: () => ({ enabledForChat: true }),
    });
  }

  function startChatLifecycleDetection() {
    state.chatWatcherCleanup = watchActiveChatId((chatId) => {
      scheduleEnsureActiveChat(chatId);
    }, {
      debounceMs: 150,
      intervalMs: 2_000,
    });
  }

  function scheduleEnsureActiveChat(chatId = getActiveChatIdFromClient()) {
    state.pendingChatId = chatId || "";
    if (state.ensureTimer) window.clearTimeout(state.ensureTimer);
    state.ensureTimer = window.setTimeout(ensureActiveChat, 150);
    scheduleRenderPresenceSettings();
  }

  async function ensureActiveChat() {
    state.ensureTimer = 0;
    const chatId = state.pendingChatId || getActiveChatIdFromClient();
    state.pendingChatId = "";
    const now = Date.now();
    if (!chatId || chatId === state.activeChatId || state.ensureInFlight.has(chatId)) return;
    if (chatId === state.lastEnsureAttemptChatId && now - state.lastEnsureAttemptAt < 10_000) return;
    state.lastEnsureAttemptAt = now;
    state.lastEnsureAttemptChatId = chatId;
    state.ensureInFlight.add(chatId);
    try {
      const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/ensure`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `${response.status} ${response.statusText}`);
      }
      state.activeChatId = chatId;
    } catch (error) {
      console.warn("[Presence] chat lifecycle ensure failed", error);
    } finally {
      state.ensureInFlight.delete(chatId);
    }
  }

  function scheduleRenderPresenceSettings() {
    if (state.settingsTimer) window.clearTimeout(state.settingsTimer);
    state.settingsTimer = window.setTimeout(() => {
      state.settingsTimer = 0;
      for (const element of state.settingsElements) {
        if (element instanceof PresenceCapabilityElement) element.render();
      }
    }, 100);
  }

  function getChatIdFromCapabilityProps(props) {
    const chatId = props?.chatId;
    return typeof chatId === "string" && chatId.trim() ? chatId.trim() : "";
  }

  function getSettingsRenderRoot(element) {
    const current = element.firstElementChild;
    if (current instanceof HTMLElement && current.dataset.presenceSettingsRoot === "true") return current;
    const root = document.createElement("div");
    root.dataset.presenceSettingsRoot = "true";
    element.replaceChildren(root);
    return root;
  }

  async function loadPresenceSettings(chatId, { force = false } = {}) {
    const cached = state.settingsDataByChatId.get(chatId);
    if (!force && cached && Date.now() - cached.loadedAt < 5_000) return cached;
    const existingLoad = state.settingsLoadPromisesByChatId.get(chatId);
    if (existingLoad && !force) return existingLoad;
    state.settingsLoadingChatIds.add(chatId);
    let loadPromise;
    loadPromise = (async () => {
      try {
        const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/state`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
        const normalized = normalizeSettingsData(data);
        state.settingsDataByChatId.set(chatId, normalized);
        return normalized;
      } catch (error) {
        const fallback = {
          chatId,
          enabled: true,
          error: error instanceof Error ? error.message : String(error),
          loadedAt: Date.now(),
          roster: [],
          state: { alwaysPresentCharacterIds: [] },
        };
        state.settingsDataByChatId.set(chatId, fallback);
        return fallback;
      } finally {
        state.settingsLoadingChatIds.delete(chatId);
        if (state.settingsLoadPromisesByChatId.get(chatId) === loadPromise) state.settingsLoadPromisesByChatId.delete(chatId);
      }
    })();
    state.settingsLoadPromisesByChatId.set(chatId, loadPromise);
    return loadPromise;
  }

  function normalizeSettingsData(data) {
    const roster = Array.isArray(data?.roster)
      ? data.roster
          .filter((character) => character && typeof character.id === "string")
          .map((character) => ({
            id: character.id,
            name: typeof character.name === "string" && character.name.trim() ? character.name.trim() : character.id,
          }))
      : [];
    return {
      chatId: typeof data?.chatId === "string" ? data.chatId : "",
      enabled: data?.enabled !== false,
      loadedAt: Date.now(),
      roster,
      state: {
        alwaysPresentCharacterIds: uniqueStrings(data?.state?.alwaysPresentCharacterIds),
      },
    };
  }

  function renderPresenceSettingsLoading(mount) {
    mount.className = "mari-presence-settings-section";
    setPresenceSettingsHtml(mount, `loading:${mount.dataset.chatId || ""}`, `
      <div class="mari-presence-settings-body">
        <p class="mari-presence-settings-muted">Loading Presence settings...</p>
      </div>
    `);
  }

  function renderPresenceSettingsNotice(mount, message) {
    mount.className = "mari-presence-settings-section";
    setPresenceSettingsHtml(mount, `notice:${message}`, `
      <div class="mari-presence-settings-body">
        <p class="mari-presence-settings-muted">${escapeHtml(message)}</p>
      </div>
    `);
  }

  function renderPresenceSettingsSection(mount, data) {
    if (data.enabled === false) {
      mount.hidden = true;
      setPresenceSettingsHtml(mount, "disabled", "");
      return;
    }
    if (data.error) {
      mount.hidden = false;
      renderPresenceSettingsNotice(mount, `Presence settings could not load: ${data.error}`);
      return;
    }
    mount.hidden = false;
    const alwaysPresent = new Set(uniqueStrings(data.state?.alwaysPresentCharacterIds));
    mount.className = "mari-presence-settings-section";
    const renderKey = JSON.stringify({
      chatId: data.chatId,
      roster: data.roster.map((character) => [character.id, character.name]),
      alwaysPresent: [...alwaysPresent].sort(),
    });
    const activeCount = alwaysPresent.size;
    const items = data.roster.map((character) => {
      const checked = alwaysPresent.has(character.id);
      return `
        <button type="button" class="mari-presence-character-toggle${checked ? " is-active" : ""}" data-presence-always-character-id="${escapeAttribute(character.id)}" role="switch" aria-checked="${checked ? "true" : "false"}">
          <span class="mari-presence-character-copy">
            <span class="mari-presence-character-name">${escapeHtml(character.name)}</span>
            <span class="mari-presence-character-state">${checked ? "Always present" : "Follows active presence"}</span>
          </span>
          <span class="mari-presence-switch" aria-hidden="true">
            <span class="mari-presence-switch-thumb"></span>
          </span>
        </button>
      `;
    }).join("");
    const changed = setPresenceSettingsHtml(mount, renderKey, `
      <div class="mari-presence-settings-body">
        <section class="mari-presence-subsection">
          <div class="mari-presence-subsection-header">
            <span class="mari-presence-subsection-title">Always present characters</span>
            ${activeCount > 0 ? `<span class="mari-presence-count">${activeCount} enabled</span>` : ""}
          </div>
          <p class="mari-presence-subsection-description">
            Treat selected characters as present for every message and summary. Use this for narrator or system-style cards that should always see the whole scene.
          </p>
        </section>
        <div class="mari-presence-character-list">
          ${items || '<p class="mari-presence-settings-muted">No characters in this chat.</p>'}
        </div>
      </div>
    `);
    if (!changed) return;
    for (const button of mount.querySelectorAll("[data-presence-always-character-id]")) {
      button.addEventListener("click", () => {
        const characterId = button.getAttribute("data-presence-always-character-id");
        if (!characterId) return;
        toggleAlwaysPresentCharacter(data.chatId, characterId);
      });
    }
  }

  function setPresenceSettingsHtml(mount, renderKey, html) {
    if (mount.dataset.presenceRenderKey === renderKey) return false;
    mount.dataset.presenceRenderKey = renderKey;
    mount.innerHTML = html;
    return true;
  }

  async function toggleAlwaysPresentCharacter(chatId, characterId) {
    const current = state.settingsDataByChatId.get(chatId);
    if (!current) return;
    const next = new Set(uniqueStrings(current.state?.alwaysPresentCharacterIds));
    if (next.has(characterId)) next.delete(characterId);
    else next.add(characterId);
    const optimistic = {
      ...current,
      state: { ...current.state, alwaysPresentCharacterIds: [...next] },
      loadedAt: Date.now(),
    };
    state.settingsDataByChatId.set(chatId, optimistic);
    scheduleRenderPresenceSettings();
    try {
      const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alwaysPresentCharacterIds: [...next] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
      state.settingsDataByChatId.set(chatId, normalizeSettingsData({
        ...data,
        chatId,
        roster: current.roster,
        enabled: true,
      }));
    } catch (error) {
      console.warn("[Presence] could not update always-present characters", error);
      state.settingsDataByChatId.set(chatId, current);
    } finally {
      scheduleRenderPresenceSettings();
    }
  }

  function injectPresenceSettingsStyle() {
    if (state.settingsStyleInjected || document.getElementById("mari-presence-settings-style")) return;
    const style = document.createElement("style");
    style.id = "mari-presence-settings-style";
    style.textContent = `
      .mari-presence-settings-section {
        display: block;
      }
      .mari-presence-settings-body {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .mari-presence-subsection {
        border-top: 1px solid var(--border);
        padding-top: 0.75rem;
      }
      .mari-presence-subsection-header {
        align-items: center;
        display: flex;
        gap: 0.375rem;
        justify-content: space-between;
        padding-inline: 0.125rem;
      }
      .mari-presence-subsection-title {
        color: var(--foreground);
        font-size: 0.6875rem;
        font-weight: 600;
        line-height: 1.35;
        min-width: 0;
      }
      .mari-presence-count {
        background: color-mix(in srgb, var(--primary) 10%, transparent);
        border-radius: 999px;
        color: var(--primary);
        flex: 0 0 auto;
        font-size: 0.5625rem;
        font-weight: 500;
        line-height: 1.2;
        padding: 0.125rem 0.375rem;
      }
      .mari-presence-subsection-description {
        color: var(--muted-foreground);
        font-size: 0.59375rem;
        line-height: 1.35;
        margin: 0.125rem 0 0;
        padding-inline: 0.125rem;
      }
      .mari-presence-settings-muted {
        color: color-mix(in srgb, var(--muted-foreground) 80%, transparent);
        font-size: 0.6875rem;
        line-height: 1.35;
        margin: 0;
      }
      .mari-presence-character-list {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .mari-presence-character-toggle {
        align-items: center;
        background: color-mix(in srgb, var(--background) 75%, transparent);
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        color: var(--foreground);
        cursor: pointer;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
        min-height: 2.5rem;
        padding: 0.625rem 0.75rem;
        text-align: left;
        transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
        width: 100%;
      }
      .mari-presence-character-toggle:hover {
        background: var(--accent);
      }
      .mari-presence-character-toggle.is-active {
        background: color-mix(in srgb, var(--primary) 12%, transparent);
        border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
      }
      .mari-presence-character-copy {
        display: block;
        min-width: 0;
      }
      .mari-presence-character-name {
        color: var(--foreground);
        display: block;
        font-size: 0.6875rem;
        font-weight: 500;
        line-height: 1.25;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mari-presence-character-state {
        color: var(--muted-foreground);
        display: block;
        font-size: 0.59375rem;
        line-height: 1.25;
        margin-top: 0.125rem;
      }
      .mari-presence-switch {
        background: color-mix(in srgb, var(--muted-foreground) 50%, transparent);
        border-radius: 999px;
        display: inline-flex;
        flex: 0 0 auto;
        height: 1.25rem;
        padding: 0.125rem;
        transition: background-color 120ms ease;
        width: 2.25rem;
      }
      .mari-presence-switch-thumb {
        background: #fff;
        border-radius: 999px;
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
        display: block;
        height: 1rem;
        transform: translateX(0);
        transition: transform 120ms ease;
        width: 1rem;
      }
      .mari-presence-character-toggle.is-active .mari-presence-switch {
        background: var(--primary);
      }
      .mari-presence-character-toggle.is-active .mari-presence-switch-thumb {
        transform: translateX(1rem);
      }
    `;
    document.head.appendChild(style);
    state.settingsStyleInjected = true;
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))];
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  async function runServerCommand(raw, context) {
    const chatId = context?.chatId || getActiveChatIdFromClient();
    if (!chatId) throw new Error("No active chat detected.");
    const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: raw }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
    return data;
  }

  function registerPresenceCommands() {
    ensureSlashCommandBridge();
    state.commandDisposers.push(
      registerBridgeSlashCommand({
        packageId: PACKAGE_ID,
        id: "presence.command",
        kind: "command",
        commands: ["/presence"],
        handler: ({ raw, context }) => runServerCommand(raw, context),
      }),
    );
    state.commandDisposers.push(
      registerBridgeSlashCommand({
        packageId: PACKAGE_ID,
        id: "hide-from-ai.augment",
        kind: "augment",
        hijacks: ["/hide", "/unhide"],
        owns: createHideHijackOwner(),
        handler: ({ raw, context }) => runServerCommand(raw, context),
      }),
    );
  }

})();
