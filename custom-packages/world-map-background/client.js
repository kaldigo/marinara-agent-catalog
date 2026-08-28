// bridge-sdk/contracts.js
const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 8 });
const MARI_BRIDGE_SERVER_SYMBOL = Symbol.for("marinara.mari-bridge.v1");
const MARI_BRIDGE_CLIENT_SYMBOL = Symbol.for("marinara.mari-bridge.client.v1");

class MariBridgeUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MariBridgeUnavailableError";
    this.code = "MARI_BRIDGE_UNAVAILABLE";
    this.reason = details.reason ?? "unhealthy";
    this.consumerId = details.consumerId ?? null;
    this.missingCapabilities = Object.freeze([...(details.missingCapabilities ?? [])]);
    this.failedPatches = Object.freeze([...(details.failedPatches ?? [])]);
  }
}

function normalizeBridgeRequirements(input = {}) {
  const consumerId = String(input.consumerId ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(consumerId)) {
    throw new TypeError("Mari Bridge consumerId must be a lowercase package ID");
  }
  const major = Number(input.api?.major);
  const minMinor = Number(input.api?.minMinor ?? 0);
  if (!Number.isInteger(major) || major < 1 || !Number.isInteger(minMinor) || minMinor < 0) {
    throw new TypeError("Mari Bridge API requirement must contain a positive major and non-negative minMinor");
  }
  return Object.freeze({
    consumerId,
    api: Object.freeze({ major, minMinor }),
    require: Object.freeze([...new Set((input.require ?? []).map(String).map((value) => value.trim()).filter(Boolean))].sort()),
  });
}

function missingBridgeError(consumerId, surface) {
  return new MariBridgeUnavailableError(
    `Mari Bridge ${surface} runtime is not installed or did not start before ${consumerId}`,
    { reason: "missing", consumerId },
  );
}

// bridge-sdk/client.js
function readyClientRuntime() {
  const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
  return runtime?.status === "ready" && typeof runtime.registerConsumer === "function" ? runtime : null;
}

async function activateClientWithMariBridge(input, activateConsumer) {
  if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
  const requirements = normalizeBridgeRequirements(input);
  const runtime = readyClientRuntime();
  if (!runtime) {
    throw missingBridgeError(requirements.consumerId, "client");
  }
  const session = runtime.registerConsumer(requirements);
  try {
    const cleanup = await activateConsumer(session);
    if (typeof cleanup === "function") session.addCleanup(cleanup);
    const marker = `data-mari-bridge-consumer-${requirements.consumerId}`;
    globalThis.document?.documentElement?.setAttribute(marker, "ready");
    return async () => {
      globalThis.document?.documentElement?.removeAttribute(marker);
      await session.close(`${requirements.consumerId} client deactivated`);
    };
  } catch (error) {
    await session.close(`${requirements.consumerId} client activation failed`);
    throw error;
  }
}

// src/client/runtime.js
const cleanupWorldMapBackgroundClient = await activateClientWithMariBridge(
  {
    consumerId: "world-map-background",
    api: { major: 1, minMinor: 4 },
    require: ["chat.active", "chat.background", "client.bridge-first", "consumer.sessions", "generation.lifecycle", "runtime.health", "spatial.context", "ui.agent-settings"],
  },
  async (bridgeSession) => {
    const PACKAGE_ID = "world-map-background";
    const WORLD_MAPS_AGENT_ID = "hierarchical-maps";
    const TAG_NAME = "marinara-capability-world-map-background";
    const CAPABILITY_SERVER_EVENT = "marinara-capability-server-event";
    const GLOBAL_GALLERY_PREFIX = "global-gallery:";
    const state = { activeChatId: "", syncing: new Map(), elements: new Set() };

    class WorldMapBackgroundElement extends HTMLElement {
      connectedCallback() {
        state.elements.add(this);
        this.addEventListener("marinara-capability-props", this);
        this.addEventListener("input", this);
        void this.render();
      }
      disconnectedCallback() {
        state.elements.delete(this);
        this.removeEventListener("marinara-capability-props", this);
        this.removeEventListener("input", this);
      }
      handleEvent(event) {
        if (event.type === "input") {
          const input = event.target instanceof HTMLInputElement ? event.target : null;
          if (input?.matches("[data-wmb-blur]")) void saveBlur(this.chatId, Number(input.value));
          return;
        }
        void this.render();
      }
      get chatId() {
        return typeof this.capabilityProps?.chatId === "string"
          ? this.capabilityProps.chatId
          : bridgeSession.chat.active.getSnapshot().chatId || "";
      }
      async render() {
        if (this.getAttribute("view") !== "settings" || !this.chatId) {
          this.hidden = true;
          this.replaceChildren();
          return;
        }
        this.hidden = false;
        const chat = await api(`/chats/${encodeURIComponent(this.chatId)}`).catch(() => null);
        if (!chat || !this.isConnected) return;
        const metadata = record(chat.metadata);
        const settings = record(metadata.worldMapBackground);
        const blur = clampBlur(settings.blur);
        this.innerHTML = `<label class="flex flex-col gap-2 rounded-lg bg-[var(--background)]/75 px-3 py-2.5 ring-1 ring-[var(--border)]">
          <span class="flex items-center justify-between gap-3 text-xs"><span>Location background blur</span><strong>${blur}px</strong></span>
          <input data-wmb-blur type="range" min="0" max="24" step="1" value="${blur}" aria-label="Location background blur">
          <span class="text-[0.625rem] leading-snug text-[var(--muted-foreground)]">The native Roleplay background renderer applies this when the active World Maps location supplies an image.</span>
        </label>`;
      }
    }

    if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, WorldMapBackgroundElement);

    const disposeSettings = bridgeSession.ui.register({
      id: "settings",
      slot: "agent.settings",
      agentIds: [PACKAGE_ID],
      view: "settings",
    });
    const disposeChat = bridgeSession.chat.active.subscribe(({ chatId }) => {
      state.activeChatId = chatId || "";
      if (state.activeChatId) void synchronize(state.activeChatId);
    });
    const disposeGeneration = bridgeSession.generation.subscribe((snapshot, event) => {
      const chatId = event?.detail?.chatId;
      if (!chatId) return;
      if (event.source === "marinara:generation-controller" && event.detail.active === true) {
        void synchronize(chatId);
        return;
      }
      if (!snapshot.mainActive) void synchronize(chatId);
    }, { emitCurrent: false });
    const disposeSpatial = bridgeSession.chat.spatial.subscribe((snapshot) => {
      if (snapshot?.chatId) void synchronize(snapshot.chatId, snapshot.data);
    }, { emitCurrent: false });
    const onCapabilityEvent = (event) => {
      const detail = record(event?.detail);
      if (detail.packageId !== WORLD_MAPS_AGENT_ID) return;
      if (["spatial_transition_committed", "spatial_context_changed", "spatial_context_refresh"].includes(detail.type)) {
        void synchronize(detail.chatId || state.activeChatId);
      }
    };
    window.addEventListener(CAPABILITY_SERVER_EVENT, onCapabilityEvent);

    async function synchronize(chatId, spatial = null) {
      if (!chatId) return;
      const existing = state.syncing.get(chatId);
      if (existing) {
        existing.pending = true;
        if (spatial) existing.spatial = spatial;
        return existing.promise;
      }
      const entry = { pending: false, spatial, promise: null };
      entry.promise = (async () => {
        do {
          entry.pending = false;
          const nextSpatial = entry.spatial;
          entry.spatial = null;
          await runSynchronization(chatId, nextSpatial);
        } while (entry.pending);
      })().finally(() => state.syncing.delete(chatId));
      state.syncing.set(chatId, entry);
      return entry.promise;
    }

    async function runSynchronization(chatId, spatial) {
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`).catch(() => null);
      if (!chat) return;
      const metadata = record(chat.metadata);
      const settings = record(metadata.worldMapBackground);
      const activeIds = Array.isArray(metadata.activeAgentIds) ? metadata.activeAgentIds : [];
      const active = chat.mode === "roleplay" && metadata.enableAgents === true
        && activeIds.includes(PACKAGE_ID) && activeIds.includes(WORLD_MAPS_AGENT_ID);
      const image = active ? await resolveCurrentLocationImage(chatId, spatial).catch(() => null) : null;

      if (!image) {
        if (settings.currentUrl && metadata.background === settings.currentUrl) {
          const restoredUrl = settings.previousBackground ?? null;
          await patchMetadata(chatId, {
            background: restoredUrl,
            worldMapBackground: { blur: clampBlur(settings.blur) },
          });
          bridgeSession.chat.background.set({ chatId, url: restoredUrl, blurPx: 0 });
        }
        return;
      }

      const previousBackground = metadata.background && metadata.background !== settings.currentUrl
        ? metadata.background
        : settings.previousBackground ?? null;
      const blur = clampBlur(settings.blur);
      if (metadata.background !== image.url || settings.currentUrl !== image.url) {
        await patchMetadata(chatId, {
          background: image.url,
          worldMapBackground: {
            blur,
            currentUrl: image.url,
            previousBackground,
            referenceImageId: image.referenceImageId,
          },
        });
      }
      bridgeSession.chat.background.set({ chatId, url: image.url, blurPx: blur });
    }

    async function resolveCurrentLocationImage(chatId, currentSpatial) {
      const spatial = currentSpatial ?? await api(`/chats/${encodeURIComponent(chatId)}/spatial-context`);
      const definition = record(spatial?.definition);
      if (definition.enabled === false) return null;
      const currentLocationId = typeof spatial?.currentLocationId === "string" ? spatial.currentLocationId.trim() : "";
      const current = (Array.isArray(definition.locations) ? definition.locations : [])
        .find((location) => location?.id === currentLocationId && location?.status !== "archived");
      if (!current || current.useReferenceImage !== true) return null;
      const referenceImageId = typeof current.referenceImageId === "string" ? current.referenceImageId.trim() : "";
      if (!referenceImageId) return null;
      const [chatImages, globalImages] = await Promise.all([
        api(`/gallery/${encodeURIComponent(chatId)}`).catch(() => []),
        api("/global-gallery").catch(() => []),
      ]);
      const image = resolveGalleryImage(referenceImageId, chatImages, globalImages);
      return image?.url ? { referenceImageId, url: image.url } : null;
    }

    function resolveGalleryImage(referenceImageId, chatImages, globalImages) {
      const chatMatch = array(chatImages).find((image) => image?.id === referenceImageId);
      if (chatMatch) return chatMatch;
      const globalId = referenceImageId.startsWith(GLOBAL_GALLERY_PREFIX)
        ? referenceImageId.slice(GLOBAL_GALLERY_PREFIX.length).trim()
        : referenceImageId;
      return array(globalImages).find((image) => image?.id === globalId || referenceImageId === `${GLOBAL_GALLERY_PREFIX}${image?.id}`);
    }

    async function saveBlur(chatId, blur) {
      if (!chatId) return;
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
      const metadata = record(chat.metadata);
      await patchMetadata(chatId, {
        worldMapBackground: { ...record(metadata.worldMapBackground), blur: clampBlur(blur) },
      });
      const settings = record(metadata.worldMapBackground);
      if (typeof settings.currentUrl === "string" && settings.currentUrl === metadata.background) {
        bridgeSession.chat.background.set({ chatId, url: settings.currentUrl, blurPx: clampBlur(blur) });
      }
      for (const element of state.elements) if (element.chatId === chatId) void element.render();
    }

    return () => {
      window.removeEventListener(CAPABILITY_SERVER_EVENT, onCapabilityEvent);
      disposeSpatial();
      disposeGeneration();
      disposeChat();
      disposeSettings();
    };
  },
);

function record(value) {
  if (typeof value === "string") {
    try { value = JSON.parse(value || "{}"); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.images) ? value.images : [];
}

function clampBlur(value) {
  return Math.max(0, Math.min(24, Math.round(Number(value) || 0)));
}

async function patchMetadata(chatId, patch) {
  return api(`/chats/${encodeURIComponent(chatId)}/metadata`, {
    method: "PATCH",
    headers: { "x-marinara-csrf": "1" },
    body: JSON.stringify(patch),
  });
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `World Map Background request failed (${response.status})`);
  return data;
}

void cleanupWorldMapBackgroundClient;

