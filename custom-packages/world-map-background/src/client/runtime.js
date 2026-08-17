import { injectStyle, watchActiveChatId } from "../../bridge/composer-dom.js";

(function () {
  const PACKAGE_ID = "world-map-background";
  const WORLD_MAPS_AGENT_ID = "hierarchical-maps";
  const TAG_NAME = "marinara-capability-world-map-background";
  const STYLE_ID = "marinara-world-map-background-style";
  const RUNTIME_KEY = "__marinaraWorldMapBackgroundRuntime";
  const OWNER_STORAGE_KEY = "marinara-world-map-background-owner";
  const RUNTIME_VERSION = "1.0.3";
  const CAPABILITY_SERVER_EVENT = "marinara-capability-server-event";
  const GLOBAL_GALLERY_PREFIX = "global-gallery:";
  const SYNC_INTERVAL_MS = 2500;
  const API_TIMEOUT_MS = 10000;

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
    syncRequested: false,
    syncTimer: 0,
    syncDueAt: 0,
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
    on(window, CAPABILITY_SERVER_EVENT, handleCapabilityServerEvent);
    on(window, "marinara:generation-complete", handleGenerationSettled);
    on(window, "marinara:generation-error", handleGenerationSettled);
    scheduleSync(0);
  }

  function handleCapabilityServerEvent(event) {
    const detail = normalizeObject(event?.detail);
    if (detail.packageId !== WORLD_MAPS_AGENT_ID) return;
    if (detail.chatId && detail.chatId !== state.activeChatId) return;
    if (detail.type !== "spatial_transition_committed" && detail.type !== "spatial_context_refresh") return;
    scheduleSync(0);
  }

  function handleGenerationSettled(event) {
    const detail = normalizeObject(event?.detail);
    if (detail.chatId && detail.chatId !== state.activeChatId) return;
    scheduleSync(250);
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
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }

    const normalizedDelay = Math.max(0, Number(delayMs) || 0);
    const dueAt = Date.now() + normalizedDelay;
    if (state.syncTimer && state.syncDueAt && state.syncDueAt <= dueAt) return;
    if (state.syncTimer) window.clearTimeout(state.syncTimer);
    state.syncDueAt = dueAt;
    state.syncTimer = window.setTimeout(runSync, normalizedDelay);
  }

  async function runSync() {
    state.syncTimer = 0;
    state.syncDueAt = 0;
    if (state.disposed) return;
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }
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
      if (!applyLiveBackground(image.url)) return;
      if (state.lastSyncKey === syncKey && metadata.background === image.url) return;
      state.lastSyncKey = syncKey;
      await persistOwnedBackground(chatId, metadata, image);
    } catch (error) {
      warn("background synchronization failed", error);
    } finally {
      state.syncing = false;
      const nextDelay = state.syncRequested ? 0 : SYNC_INTERVAL_MS;
      state.syncRequested = false;
      scheduleSync(nextDelay);
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
    const root = findRoleplayRoot();
    if (!root) return false;

    let image = root.querySelector(":scope > .wmb-live-background");
    if (!image) {
      image = document.createElement("img");
      image.className = "wmb-live-background";
      image.alt = "";
      image.draggable = false;
      const overlay = root.querySelector(":scope > .rpg-overlay");
      root.insertBefore(image, overlay || root.firstChild);
      image.addEventListener("load", () => {
        image.dataset.loadState = "loaded";
        scheduleSync(0);
      });
      image.addEventListener("error", () => {
        warn("background image failed to load; retrying", new Error(image.currentSrc || image.src || url));
        image.remove();
        scheduleSync(1000);
      });
    }
    if (image.getAttribute("src") !== url) {
      image.dataset.loadState = "loading";
      image.setAttribute("src", url);
    }
    image.setAttribute("data-reference-owned-by", PACKAGE_ID);
    if (image.complete && image.naturalWidth > 0) image.dataset.loadState = "loaded";
    return image.dataset.loadState === "loaded";
  }

  function findRoleplayRoot() {
    const exact = document.querySelector(
      '[data-component="ChatArea.Roleplay"] .rpg-chat-area[data-chat-mode="roleplay"]',
    );
    if (exact) return exact;
    return document.querySelector('.rpg-chat-area[data-chat-mode="roleplay"]');
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
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await fetch(`/api${path}`, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      if (response.status === 204) return {};
      return response.json();
    } finally {
      window.clearTimeout(timeout);
    }
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
