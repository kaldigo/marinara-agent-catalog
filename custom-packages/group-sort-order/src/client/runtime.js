import { activateClientWithMariBridge } from "../../bridge-sdk/client.js";
import {
  escapeMariBridgeSettingsHtml,
  prepareMariBridgeSettingsRoot,
  setMariBridgeSettingsHtml,
} from "../../bridge-sdk/settings.js";

const cleanupGroupSortClient = await activateClientWithMariBridge(
  {
    consumerId: "group-sort-order",
    api: { major: 1, minMinor: 0 },
    require: ["chat.active", "client.bridge-first", "consumer.sessions", "generation.lifecycle", "runtime.health", "ui.chat-settings", "ui.composer.above-input"],
  },
  async (bridgeSession) => {
return (function () {
  const PACKAGE_ID = "group-sort-order";
  const TAG_NAME = "marinara-capability-group-sort-order";
  const ROOT_ID = "marinara-group-sort-order-root";
  const STYLE_ID = "marinara-group-sort-order-style";
  const RUNTIME_KEY = "__marinaraGroupSortOrderRuntime";
  const RUNTIME_VERSION = "2.1.0";

  const previousState = window[RUNTIME_KEY];
  if (previousState && previousState.version !== RUNTIME_VERSION) {
    previousState.disposed = true;
    previousState.slotCleanup?.();
    previousState.settingsCleanup?.();
    previousState.cleanups?.forEach?.((cleanup) => cleanup());
    window.clearTimeout(previousState.pollTimer);
    window.clearTimeout(previousState.renderTimer);
    window.clearTimeout(previousState.followupTimer);
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
    followupTimer: 0,
    refreshing: false,
    slotCleanup: null,
    settingsCleanup: null,
    settingsNodes: new Set(),
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
        this.addEventListener("marinara-capability-props", this);
        this.style.display = "block";
        bindActiveChat(this.capabilityProps?.chatId || bridgeSession.chat.active.getSnapshot().chatId || "");
        this.render();
      }

      disconnectedCallback() {
        this.removeEventListener("marinara-capability-props", this);
        if (state.barNode === this) state.barNode = null;
        state.settingsNodes.delete(this);
      }

      handleEvent(event) {
        if (event.type === "marinara-capability-props") {
          bindActiveChat(this.capabilityProps?.chatId || bridgeSession.chat.active.getSnapshot().chatId || "");
          this.render();
        }
      }

      render() {
        if (this.getAttribute("view") === "settings") {
          state.settingsNodes.add(this);
          void renderSettings(this);
          return;
        }
        state.settingsNodes.delete(this);
        renderBar(this);
      }
    }

    customElements.define(TAG_NAME, GroupSortOrderCapabilityElement);
  }

  function startRuntime() {
    state.slotCleanup = bridgeSession.ui.register({
      id: "next-speaker",
      slot: "composer.above-input",
      view: "surface",
      priority: 40,
    });
    state.settingsCleanup = bridgeSession.ui.register({
      id: "settings",
      slot: "chat.settings",
      view: "settings",
      priority: 40,
    });
    state.cleanups.push(bridgeSession.chat.active.subscribe(({ chatId }) => bindActiveChat(chatId || "")));
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

  function scheduleRefreshFromEvent(event) {
    const eventChatId = typeof event?.detail?.chatId === "string" ? event.detail.chatId : "";
    if (eventChatId && state.activeChatId && eventChatId !== state.activeChatId) return;
    state.lastRefreshAt = 0;
    scheduleViewRefresh(150);
    scheduleComposerSlotRender(100);
    if (state.followupTimer) window.clearTimeout(state.followupTimer);
    state.followupTimer = window.setTimeout(() => {
      state.followupTimer = 0;
      state.lastRefreshAt = 0;
      scheduleViewRefresh(0);
    }, 1250);
  }

  function injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function scheduleComposerSlotRender(delay = 0) {
    window.setTimeout(() => updateBar(state.barNode, state.lastView), Math.max(0, delay));
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
    state.lastRefreshAt = 0;
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
    state.refreshing = true;
    updateBar(state.barNode, state.lastView);
    if (button) button.disabled = true;
    try {
      const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/refresh`, { method: "POST", body: "{}" });
      if (chatId !== state.activeChatId) return;
      state.lastView = view;
      updateBar(state.barNode, view);
      scheduleComposerSlotRender(0);
    } catch (error) {
      warn("refresh failed", error);
      await refreshView(chatId);
    } finally {
      state.refreshing = false;
      updateBar(state.barNode, state.lastView);
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

  async function renderSettings(root) {
    prepareMariBridgeSettingsRoot(root);
    const chatId = root.capabilityProps?.chatId || state.activeChatId;
    if (!chatId) {
      setMariBridgeSettingsHtml(root, "no-chat", '<p class="mari-sdk-settings-status">Open a chat to configure Group Sort Order.</p>');
      return;
    }
    root.setAttribute("aria-busy", "true");
    try {
      const [view, connections] = await Promise.all([
        api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/state`),
        api("/connections").catch(() => []),
      ]);
      if (!root.isConnected || (root.capabilityProps?.chatId || state.activeChatId) !== chatId) return;
      const settings = normalizeObject(view.settings);
      const options = (Array.isArray(connections) ? connections : []).map((connection) => {
        const id = escapeMariBridgeSettingsHtml(connection?.id || "");
        const label = escapeMariBridgeSettingsHtml(connection?.name || connection?.model || connection?.id || "Connection");
        const model = connection?.model ? ` — ${escapeMariBridgeSettingsHtml(connection.model)}` : "";
        return `<option value="${id}"${settings.selectorConnectionId === connection?.id ? " selected" : ""}>${label}${model}</option>`;
      }).join("");
      setMariBridgeSettingsHtml(root, `${chatId}:${JSON.stringify(settings)}:${options}`, `
        <section class="mari-sdk-settings-group">
          <div class="mari-sdk-settings-heading"><h3 class="mari-sdk-settings-title">Group Sort Order</h3></div>
          <p class="mari-sdk-settings-description">Controls the terminal next-speaker marker and the optional hidden selector call for this chat.</p>
          <label class="mari-sdk-settings-switch">
            <span class="mari-sdk-settings-switch-copy"><span class="mari-sdk-settings-label">Include persona candidate</span><span class="mari-sdk-settings-help">Allow the current persona to be selected as the next participant.</span></span>
            <input data-gso-setting="includePersonaCandidate" type="checkbox"${view.includePersonaCandidate ? " checked" : ""}>
          </label>
          <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Selector connection / model</span><select class="mari-sdk-settings-select" data-gso-setting="selectorConnectionId"><option value="">Use Agent default</option><option value="random"${settings.selectorConnectionId === "random" ? " selected" : ""}>Random pool</option>${options}</select><span class="mari-sdk-settings-help">Used only by Refresh. Normal replies still use the chat model.</span></label>
          <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Terminal marker</span><input class="mari-sdk-settings-input" data-gso-setting="markerTemplate" value="${escapeMariBridgeSettingsHtml(settings.markerTemplate)}"><span class="mari-sdk-settings-help">Must contain exactly one <code>{{speaker_id}}</code>.</span></label>
          <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Main-response instruction</span><textarea rows="8" class="mari-sdk-settings-textarea" data-gso-setting="promptTemplate">${escapeMariBridgeSettingsHtml(settings.promptTemplate)}</textarea><span class="mari-sdk-settings-help">Macros: <code>{{candidates}}</code>, <code>{{marker}}</code>, <code>{{excluded_candidate_id}}</code>.</span></label>
          <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Refresh selector prompt</span><textarea rows="7" class="mari-sdk-settings-textarea" data-gso-setting="selectorPrompt">${escapeMariBridgeSettingsHtml(settings.selectorPrompt)}</textarea></label>
          <p class="mari-sdk-settings-status" data-gso-settings-status></p>
          <div class="mari-sdk-settings-actions"><button type="button" class="mari-sdk-settings-button" data-gso-reset>Reset defaults</button><button type="button" class="mari-sdk-settings-button" data-variant="primary" data-gso-save>Save</button></div>
        </section>
      `);
      root.querySelector("[data-gso-save]")?.addEventListener("click", () => saveGsoSettings(root, chatId, false));
      root.querySelector("[data-gso-reset]")?.addEventListener("click", () => saveGsoSettings(root, chatId, true));
    } catch (error) {
      setMariBridgeSettingsHtml(root, `error:${chatId}:${error.message}`, `<p class="mari-sdk-settings-status">Group Sort Order settings could not load: ${escapeMariBridgeSettingsHtml(error.message)}</p>`);
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  async function saveGsoSettings(root, chatId, reset) {
    const status = root.querySelector("[data-gso-settings-status]");
    root.setAttribute("aria-busy", "true");
    if (status) status.textContent = "Saving…";
    const read = (name) => root.querySelector(`[data-gso-setting="${name}"]`);
    const body = reset ? {
      markerTemplate: null,
      promptTemplate: null,
      selectorPrompt: null,
      selectorConnectionId: null,
    } : {
      includePersonaCandidate: read("includePersonaCandidate")?.checked === true,
      markerTemplate: read("markerTemplate")?.value || "",
      promptTemplate: read("promptTemplate")?.value || "",
      selectorPrompt: read("selectorPrompt")?.value || "",
      selectorConnectionId: read("selectorConnectionId")?.value || null,
    };
    try {
      const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/settings`, { method: "PATCH", body: JSON.stringify(body) });
      if (chatId === state.activeChatId) state.lastView = view;
      root.dataset.mariBridgeSettingsRenderKey = "";
      await renderSettings(root);
    } catch (error) {
      if (status) status.textContent = `Save failed: ${error.message}`;
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  function updateBar(root, view) {
    if (!root) return;
    const shouldHide = !state.activeChatId || view?.enabled === false || view?.hidden !== false;
    root.hidden = shouldHide;
    root.dataset.status = typeof view?.status === "string" ? view.status : "unknown";
    if (root.dataset.chatId !== (state.activeChatId || "")) root.dataset.chatId = state.activeChatId || "";
    root.querySelector(".gso-next").textContent = state.refreshing ? "Refreshing..." : view?.nextSpeaker?.name || "Unknown";
    const personaButton = root.querySelector(".gso-persona");
    if (personaButton) personaButton.setAttribute("aria-pressed", view?.includePersonaCandidate === true ? "true" : "false");
    const refreshButton = root.querySelector(".gso-refresh");
    if (refreshButton) refreshButton.disabled = state.refreshing || view?.canRefresh !== true;
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
      state.settingsCleanup?.();
      state.cleanups.forEach((cleanup) => cleanup());
      state.cleanups = [];
      window.clearTimeout(state.pollTimer);
      window.clearTimeout(state.renderTimer);
      window.clearTimeout(state.followupTimer);
      state.slotCleanup = null;
      state.settingsCleanup = null;
      state.barNode = null;
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
    },
  };
  return async () => {
    state.disposed = true;
    state.slotCleanup?.();
    state.settingsCleanup?.();
    state.slotCleanup = null;
    state.settingsCleanup = null;
    for (const cleanup of state.cleanups.splice(0)) cleanup();
    window.clearTimeout(state.pollTimer);
    window.clearTimeout(state.renderTimer);
    window.clearTimeout(state.followupTimer);
    state.initialized = false;
  };
})();
  },
);

void cleanupGroupSortClient;
