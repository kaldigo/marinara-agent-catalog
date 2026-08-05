(() => {
  "use strict";
  // bridge/runtime.js
  // Shared runtime coordinator for bridge copies bundled by different packages.

  const MARI_BRIDGE_VERSION = "1.0.6";

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

  // src/client/runtime.js
  (function () {
    const PACKAGE_ID = "world-map-background";
    const WORLD_MAPS_AGENT_ID = "hierarchical-maps";
    const TAG_NAME = "marinara-capability-world-map-background";
    const STYLE_ID = "marinara-world-map-background-style";
    const RUNTIME_KEY = "__marinaraWorldMapBackgroundRuntime";
    const OWNER_STORAGE_KEY = "marinara-world-map-background-owner";
    const RUNTIME_VERSION = "1.0.2";
    const GLOBAL_GALLERY_PREFIX = "global-gallery:";
    const SYNC_INTERVAL_MS = 2500;

    const previousState = window[RUNTIME_KEY];
    if (previousState && previousState.version !== RUNTIME_VERSION) {
      previousState.disposed = true;
      previousState.cleanups?.forEach?.((cleanup) => cleanup());
      window.clearTimeout(previousState.syncTimer);
      removeLiveBackground();
      window[RUNTIME_KEY] = null;
    }

    const state = window[RUNTIME_KEY] || {
      version: RUNTIME_VERSION,
      initialized: false,
      disposed: false,
      activeChatId: "",
      syncing: false,
      syncTimer: 0,
      lastSyncKey: "",
      lastAppliedUrl: "",
      cleanups: [],
    };
    state.version = RUNTIME_VERSION;
    state.disposed = false;
    window[RUNTIME_KEY] = state;

    injectStyle(STYLE_ID, styleText());
    defineCapabilityElement();

    if (!state.initialized) {
      state.initialized = true;
      startRuntime();
    }

    function defineCapabilityElement() {
      if (customElements.get(TAG_NAME)) return;

      class WorldMapBackgroundCapabilityElement extends HTMLElement {
        connectedCallback() {
          this.setAttribute("aria-hidden", "true");
          this.style.display = "contents";
        }
      }

      customElements.define(TAG_NAME, WorldMapBackgroundCapabilityElement);
    }

    function startRuntime() {
      state.cleanups.push(
        watchActiveChatId(
          (chatId) => {
            bindActiveChat(chatId || "");
            scheduleSync(0);
          },
          { debounceMs: 100, intervalMs: 1000 },
        ),
      );
      on(document, "visibilitychange", () => {
        if (!document.hidden) scheduleSync(100);
      });
      on(window, "focus", () => scheduleSync(100));
      on(window, "marinara:generation-complete", () => scheduleSync(250));
      on(window, "marinara:generation-error", () => scheduleSync(250));
      scheduleSync(0);
    }

    function on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      state.cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function bindActiveChat(chatId) {
      const nextChatId = typeof chatId === "string" ? chatId.trim() : "";
      if (nextChatId === state.activeChatId) return;
      state.activeChatId = nextChatId;
      state.lastSyncKey = "";
      state.lastAppliedUrl = "";
      removeLiveBackground();
    }

    function scheduleSync(delayMs = SYNC_INTERVAL_MS) {
      if (state.disposed) return;
      if (state.syncTimer) window.clearTimeout(state.syncTimer);
      state.syncTimer = window.setTimeout(runSync, delayMs);
    }

    async function runSync() {
      state.syncTimer = 0;
      if (state.disposed || state.syncing) return scheduleSync(SYNC_INTERVAL_MS);
      state.syncing = true;
      try {
        const chatId = state.activeChatId;
        if (!chatId) {
          removeLiveBackground();
          return;
        }
        const chat = await api(`/chats/${encodeURIComponent(chatId)}`).catch(() => null);
        if (!chat || chatId !== state.activeChatId) return;

        const metadata = normalizeObject(chat.metadata);
        if (!isAgentActive(chat, metadata)) {
          await clearOwnedBackground(chatId, metadata);
          removeLiveBackground();
          return;
        }

        const image = await resolveCurrentLocationImage(chatId).catch((error) => {
          warn("location image lookup failed", error);
          return null;
        });
        if (!image || chatId !== state.activeChatId) {
          await clearOwnedBackground(chatId, metadata);
          removeLiveBackground();
          return;
        }

        const syncKey = `${chatId}:${image.referenceImageId}:${image.url}`;
        applyLiveBackground(image.url);
        if (state.lastSyncKey === syncKey && metadata.background === image.url) return;
        state.lastSyncKey = syncKey;
        await persistOwnedBackground(chatId, metadata, image);
      } finally {
        state.syncing = false;
        scheduleSync(SYNC_INTERVAL_MS);
      }
    }

    function isAgentActive(chat, metadata) {
      if (chat?.mode && chat.mode !== "roleplay") return false;
      if (metadata.enableAgents !== true) return false;
      const activeAgentIds = Array.isArray(metadata.activeAgentIds) ? metadata.activeAgentIds : [];
      return activeAgentIds.includes(PACKAGE_ID) && activeAgentIds.includes(WORLD_MAPS_AGENT_ID);
    }

    async function resolveCurrentLocationImage(chatId) {
      const spatial = await api(`/chats/${encodeURIComponent(chatId)}/spatial-context`);
      const definition = normalizeObject(spatial?.definition);
      if (definition.enabled === false) return null;

      const currentLocationId = typeof spatial?.currentLocationId === "string" ? spatial.currentLocationId.trim() : "";
      const locations = Array.isArray(definition.locations) ? definition.locations : [];
      const current = locations.find((location) => location?.id === currentLocationId && location?.status !== "archived");
      if (!current || current.useReferenceImage !== true) return null;

      const referenceImageId = typeof current.referenceImageId === "string" ? current.referenceImageId.trim() : "";
      if (!referenceImageId) return null;

      const [chatImages, globalImages] = await Promise.all([
        api(`/gallery/${encodeURIComponent(chatId)}`).catch(() => []),
        api("/global-gallery").catch(() => []),
      ]);
      const image = resolveGalleryImage(referenceImageId, chatImages, globalImages);
      if (!image?.url) return null;

      return {
        referenceImageId,
        url: image.url,
      };
    }

    function resolveGalleryImage(referenceImageId, chatImages, globalImages) {
      const normalized = referenceImageId.trim();
      const chatMatch = asArray(chatImages).find((image) => image?.id === normalized);
      if (chatMatch) return chatMatch;

      const globalId = normalized.startsWith(GLOBAL_GALLERY_PREFIX)
        ? normalized.slice(GLOBAL_GALLERY_PREFIX.length).trim()
        : normalized;
      return asArray(globalImages).find((image) => {
        const id = typeof image?.id === "string" ? image.id.trim() : "";
        return id && (id === globalId || normalized === `${GLOBAL_GALLERY_PREFIX}${id}`);
      });
    }

    async function persistOwnedBackground(chatId, metadata, image) {
      const owners = readOwnerState();
      const currentOwner = owners[chatId] || {};
      const currentBackground = typeof metadata.background === "string" ? metadata.background : null;
      const previousBackground =
        currentBackground && currentBackground !== currentOwner.currentUrl ? currentBackground : currentOwner.previousBackground ?? null;

      if (currentBackground !== image.url) {
        await patchChatMetadata(chatId, { background: image.url });
      }

      owners[chatId] = {
        referenceImageId: image.referenceImageId,
        currentUrl: image.url,
        previousBackground,
        updatedAt: Date.now(),
      };
      writeOwnerState(owners);
      state.lastAppliedUrl = image.url;
    }

    async function clearOwnedBackground(chatId, metadata) {
      const owners = readOwnerState();
      const owner = owners[chatId];
      if (!owner) return;

      const currentBackground = typeof metadata.background === "string" ? metadata.background : null;
      if (currentBackground === owner.currentUrl) {
        await patchChatMetadata(chatId, { background: owner.previousBackground ?? null }).catch((error) =>
          warn("background restore failed", error),
        );
      }
      delete owners[chatId];
      writeOwnerState(owners);
      state.lastAppliedUrl = "";
    }

    function applyLiveBackground(url) {
      const root = document.querySelector('[data-component="ChatArea.Roleplay"] .rpg-chat-area[data-chat-mode="roleplay"]');
      if (!root) return;

      let image = root.querySelector(":scope > .wmb-live-background");
      if (!image) {
        image = document.createElement("img");
        image.className = "wmb-live-background";
        image.alt = "";
        image.draggable = false;
        const overlay = root.querySelector(":scope > .rpg-overlay");
        root.insertBefore(image, overlay || root.firstChild);
      }
      if (image.getAttribute("src") !== url) image.setAttribute("src", url);
      image.setAttribute("data-reference-owned-by", PACKAGE_ID);
    }

    function removeLiveBackground() {
      document.querySelectorAll(".wmb-live-background").forEach((node) => node.remove());
    }

    async function patchChatMetadata(chatId, metadata) {
      return api(`/chats/${encodeURIComponent(chatId)}/metadata`, {
        method: "PATCH",
        headers: { "x-marinara-csrf": "1" },
        body: JSON.stringify(metadata),
      });
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

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function readOwnerState() {
      try {
        const parsed = JSON.parse(localStorage.getItem(OWNER_STORAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }

    function writeOwnerState(value) {
      try {
        localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(value));
      } catch {}
    }

    function warn(message, error) {
      console.warn(`[${PACKAGE_ID}] ${message}`, error);
    }

    function styleText() {
      return `
        .wmb-live-background {
          pointer-events: none;
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          user-select: none;
          opacity: 1;
          transition: opacity 700ms ease-in-out;
        }
      `;
    }
  })();

})();
