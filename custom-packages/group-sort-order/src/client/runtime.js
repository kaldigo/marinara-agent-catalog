import { injectStyle } from "../../bridge/composer-dom.js";
import {
  COMPOSER_SLOT_ABOVE_INPUT,
  registerComposerSlotContribution,
  scheduleComposerSlotRender,
} from "../../bridge/ui-slots.js";
import { declarePackageGeneration, GENERATION_KIND_AGENT } from "../../bridge/generation-lifecycle.js";

(function () {
  const PACKAGE_ID = "group-sort-order";
  const TAG_NAME = "marinara-capability-group-sort-order";
  const ROOT_ID = "marinara-group-sort-order-root";
  const STYLE_ID = "marinara-group-sort-order-style";
  const RUNTIME_KEY = "__marinaraGroupSortOrderRuntime";
  const RUNTIME_VERSION = "1.0.10";

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
    propsChatIds: new Map(),
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
        syncCapabilityProps(this);
      }

      disconnectedCallback() {
        this.removeEventListener("marinara-capability-props", this);
        state.propsChatIds.delete(this);
        scheduleComposerSlotRender(0);
      }

      handleEvent(event) {
        if (event.type === "marinara-capability-props") syncCapabilityProps(this);
      }
    }

    customElements.define(TAG_NAME, GroupSortOrderCapabilityElement);
  }

  function syncCapabilityProps(element) {
    const props = normalizeObject(element.capabilityProps);
    const chatId = typeof props.chatId === "string" && props.chatId.trim() ? props.chatId.trim() : "";
    if (chatId) state.propsChatIds.set(element, chatId);
    else state.propsChatIds.delete(element);
    bindActiveChat(readCapabilityChatId());
  }

  function startRuntime() {
    state.slotCleanup = registerComposerSlotContribution({
      packageId: PACKAGE_ID,
      id: "next-speaker",
      slot: COMPOSER_SLOT_ABOVE_INPUT,
      priority: 40,
      shouldShow: ({ chatId }) => Boolean(readCapabilityChatId() || chatId),
      render: ({ host }) => renderBar(host),
      update: ({ chatId, node }) => {
        bindActiveChat(readCapabilityChatId() || chatId || "");
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
      updateBar(state.barNode, { enabled: true, hidden: false, nextSpeaker: null, includePersonaCandidate: false, status: "unknown" });
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
    const shouldHide = !state.activeChatId || view?.enabled === false || view?.hidden === true;
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

  function readCapabilityChatId() {
    for (const chatId of state.propsChatIds.values()) {
      if (chatId) return chatId;
    }
    return "";
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
      #${ROOT_ID} .gso-icon-button { display:inline-flex; width:26px; height:26px; align-items:center; justify-content:center; border:1px solid var(--border,#334155); border-radius:6px; padding:0; background:var(--secondary,#1f2937); color:inherit; line-height:1; }
      #${ROOT_ID} .gso-icon-button[aria-pressed="true"] { color:var(--primary,#93c5fd); border-color:color-mix(in srgb,var(--primary,#93c5fd) 55%,var(--border,#334155)); background:color-mix(in srgb,var(--primary,#93c5fd) 14%,transparent); }
      #${ROOT_ID} .gso-icon-button svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
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
