const cleanupWorldMapBackgroundClient = await activateClientWithMariBridge(
  {
    consumerId: "world-map-background",
    api: { major: 1, minMinor: 0 },
    require: ["chat.active", "client.bridge-first", "consumer.sessions", "runtime.health", "ui.chat-settings"],
  },
  async (bridgeSession) => {
  const PACKAGE_ID = "world-map-background";
  const WORLD_MAPS_AGENT_ID = "hierarchical-maps";
  const TAG_NAME = "marinara-capability-world-map-background";
  const STYLE_ID = "marinara-world-map-background-style";
  const RUNTIME_KEY = "__marinaraWorldMapBackgroundRuntime";
  const OWNER_STORAGE_KEY = "marinara-world-map-background-owner";
  const RUNTIME_VERSION = "1.1.1";
  const CAPABILITY_SERVER_EVENT = "marinara-capability-server-event";
  const GLOBAL_GALLERY_PREFIX = "global-gallery:";
  const SYNC_INTERVAL_MS = 2500;
  const API_TIMEOUT_MS = 10000;

  const previousState = window[RUNTIME_KEY];
  if (previousState && previousState.version !== RUNTIME_VERSION) {
    previousState.disposed = true;
    previousState.cleanups?.forEach?.((cleanup) => cleanup());
    previousState.settingsCleanup?.();
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
    settingsCleanup: null,
  };
  state.version = RUNTIME_VERSION;
  state.disposed = false;
  window[RUNTIME_KEY] = state;

  injectStyle(STYLE_ID, styleText());
  defineCapabilityElement();
  document.documentElement.dataset.mariBridgeConsumerWorldMap = "ready";

  if (!state.initialized) {
    state.initialized = true;
    startRuntime();
  }

  function defineCapabilityElement() {
    if (customElements.get(TAG_NAME)) return;

    class WorldMapBackgroundCapabilityElement extends HTMLElement {
      connectedCallback() {
        this.addEventListener("marinara-capability-props", this);
        this.render();
      }
      disconnectedCallback() {
        this.removeEventListener("marinara-capability-props", this);
      }
      handleEvent() {
        this.render();
      }
      render() {
        if (this.getAttribute("view") !== "settings") {
          this.setAttribute("aria-hidden", "true");
          this.style.display = "contents";
          this.replaceChildren();
          return;
        }
        this.removeAttribute("aria-hidden");
        this.style.display = "block";
        void renderWorldMapBackgroundSettings(this);
      }
    }

    customElements.define(TAG_NAME, WorldMapBackgroundCapabilityElement);
  }

  function startRuntime() {
    state.settingsCleanup = bridgeSession.ui.register({ id: "settings", slot: "chat.settings", view: "settings", priority: 20 });
    state.cleanups.push(bridgeSession.chat.active.subscribe(({ chatId }) => {
      bindActiveChat(chatId || "");
      scheduleSync(0);
    }));
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

  function injectStyle(id, cssText) {
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = cssText;
    return style;
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

      const displaySettings = normalizeWorldMapBackgroundSettings(metadata.worldMapBackground);
      const syncKey = `${chatId}:${image.referenceImageId}:${image.url}:${JSON.stringify(displaySettings)}`;
      if (!applyLiveBackground(image.url, displaySettings)) return;
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

  function applyLiveBackground(url, displaySettings = normalizeWorldMapBackgroundSettings()) {
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
    image.style.objectFit = displaySettings.fit;
    image.style.objectPosition = displaySettings.position;
    image.style.opacity = String(displaySettings.opacity);
    image.style.filter = displaySettings.blur > 0 ? `blur(${displaySettings.blur}px)` : "none";
    image.style.transform = displaySettings.blur > 0 ? "scale(1.02)" : "none";
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

  function normalizeWorldMapBackgroundSettings(value = {}) {
    const input = normalizeObject(value);
    const fit = input.fit === "contain" ? "contain" : "cover";
    const allowedPositions = new Set(["center", "top", "bottom", "left", "right"]);
    const position = allowedPositions.has(input.position) ? input.position : "center";
    const opacityValue = Number(input.opacity);
    const blurValue = Number(input.blur);
    return {
      fit,
      position,
      opacity: Number.isFinite(opacityValue) ? Math.min(1, Math.max(0.1, opacityValue)) : 1,
      blur: Number.isFinite(blurValue) ? Math.min(20, Math.max(0, blurValue)) : 0,
    };
  }

  async function renderWorldMapBackgroundSettings(root) {
    prepareMariBridgeSettingsRoot(root);
    const chatId = root.capabilityProps?.chatId || state.activeChatId;
    if (!chatId) {
      setMariBridgeSettingsHtml(root, "no-chat", '<p class="mari-sdk-settings-status">Open a chat to configure World Map Background.</p>');
      return;
    }
    root.setAttribute("aria-busy", "true");
    try {
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
      const metadata = normalizeObject(chat?.metadata);
      const settings = normalizeWorldMapBackgroundSettings(metadata.worldMapBackground);
      setMariBridgeSettingsHtml(root, `${chatId}:${JSON.stringify(settings)}`, `
        <section class="mari-sdk-settings-group">
          <div class="mari-sdk-settings-heading"><h3 class="mari-sdk-settings-title">World Map Background</h3></div>
          <p class="mari-sdk-settings-description">Controls how the current World Maps location image is displayed in this chat.</p>
          <div class="mari-sdk-settings-grid">
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Image fit</span><select class="mari-sdk-settings-select" data-wmb-setting="fit"><option value="cover"${settings.fit === "cover" ? " selected" : ""}>Cover</option><option value="contain"${settings.fit === "contain" ? " selected" : ""}>Contain</option></select></label>
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Position</span><select class="mari-sdk-settings-select" data-wmb-setting="position">${["center","top","bottom","left","right"].map((value) => `<option value="${value}"${settings.position === value ? " selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label>
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Opacity</span><input class="mari-sdk-settings-input" type="number" min="10" max="100" step="5" data-wmb-setting="opacity" value="${Math.round(settings.opacity * 100)}"><span class="mari-sdk-settings-help">10–100 percent.</span></label>
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Blur</span><input class="mari-sdk-settings-input" type="number" min="0" max="20" step="1" data-wmb-setting="blur" value="${settings.blur}"><span class="mari-sdk-settings-help">0–20 pixels.</span></label>
          </div>
          <p class="mari-sdk-settings-status" data-wmb-status></p>
          <div class="mari-sdk-settings-actions"><button type="button" class="mari-sdk-settings-button" data-wmb-reset>Reset defaults</button><button type="button" class="mari-sdk-settings-button" data-variant="primary" data-wmb-save>Save</button></div>
        </section>
      `);
      root.querySelector("[data-wmb-save]")?.addEventListener("click", () => saveWorldMapBackgroundSettings(root, chatId, false));
      root.querySelector("[data-wmb-reset]")?.addEventListener("click", () => saveWorldMapBackgroundSettings(root, chatId, true));
    } catch (error) {
      setMariBridgeSettingsHtml(root, `error:${chatId}:${error.message}`, `<p class="mari-sdk-settings-status">World Map Background settings could not load: ${escapeMariBridgeSettingsHtml(error.message)}</p>`);
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  async function saveWorldMapBackgroundSettings(root, chatId, reset) {
    const status = root.querySelector("[data-wmb-status]");
    if (status) status.textContent = "Saving…";
    const read = (name) => root.querySelector(`[data-wmb-setting="${name}"]`);
    const value = reset ? {} : normalizeWorldMapBackgroundSettings({
      fit: read("fit")?.value,
      position: read("position")?.value,
      opacity: Number(read("opacity")?.value) / 100,
      blur: Number(read("blur")?.value),
    });
    try {
      await patchChatMetadata(chatId, { worldMapBackground: value });
      state.lastSyncKey = "";
      scheduleSync(0);
      root.dataset.mariBridgeSettingsRenderKey = "";
      await renderWorldMapBackgroundSettings(root);
    } catch (error) {
      if (status) status.textContent = `Save failed: ${error.message}`;
    }
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
  return () => {
    state.disposed = true;
    state.cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    state.settingsCleanup?.();
    window.clearTimeout(state.syncTimer);
    document.getElementById(STYLE_ID)?.remove();
    delete document.documentElement.dataset.mariBridgeConsumerWorldMap;
    removeLiveBackground();
    if (window[RUNTIME_KEY] === state) delete window[RUNTIME_KEY];
  };
  },
);
