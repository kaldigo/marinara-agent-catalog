(function () {
  const PACKAGE_ID = "group-sort-order";
  const TAG_NAME = "marinara-capability-group-sort-order";
  const ROOT_ID = "marinara-group-sort-order-root";
  const STYLE_ID = "marinara-group-sort-order-style";
  const RUNTIME_KEY = "__marinaraGroupSortOrderRuntime";
  const RUNTIME_VERSION = "1.0.3";

  const previousState = window[RUNTIME_KEY];
  if (previousState && previousState.version !== RUNTIME_VERSION) {
    previousState.disposed = true;
    window.clearTimeout(previousState.pollTimer);
    window.clearTimeout(previousState.renderTimer);
    previousState.observer?.disconnect();
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
    inputContainer: null,
    propsChatIds: new Map(),
    pollTimer: 0,
    renderTimer: 0,
    observer: null,
    ensureInFlight: new Set(),
  };
  state.version = RUNTIME_VERSION;
  window[RUNTIME_KEY] = state;
  state.disposed = false;

  injectStyle();
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
        scheduleTick(0);
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
    scheduleTick(0);
  }

  function startRuntime() {
    document.addEventListener("visibilitychange", scheduleTickFromEvent, true);
    window.addEventListener("focus", scheduleTickFromEvent);
    window.addEventListener("resize", onViewportChanged);
    window.addEventListener("popstate", scheduleTickFromEvent);
    window.addEventListener("marinara:generation-complete", scheduleTickFromEvent);
    window.addEventListener("marinara:generation-error", scheduleTickFromEvent);
    patchHistoryMethod("pushState");
    patchHistoryMethod("replaceState");
    observeDom();
    scheduleTick(0);
  }

  function scheduleTickFromEvent() {
    scheduleTick(100);
  }

  function onViewportChanged() {
    state.inputContainer = null;
    scheduleTick(100);
  }

  function scheduleTick(delay) {
    if (state.disposed) return;
    if (state.renderTimer) window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(tick, delay);
  }

  function tick() {
    state.renderTimer = 0;
    if (state.disposed) return;
    const chatId = readChatId();
    if (chatId !== state.activeChatId) {
      state.activeChatId = chatId;
      state.lastView = null;
      updateBar(null);
    }
    renderShell();
    if (chatId && chatId !== state.lastEnsuredChatId && !state.ensureInFlight.has(chatId)) {
      void ensure(chatId);
    } else if (chatId && Date.now() - state.lastRefreshAt > 1500) {
      void refreshView(chatId);
    }
    if (state.pollTimer) window.clearTimeout(state.pollTimer);
    state.pollTimer = window.setTimeout(tick, 2000);
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
      updateBar(view);
    } catch (error) {
      warn("state refresh failed", error);
      updateBar({ enabled: true, hidden: false, nextSpeaker: null, includePersonaCandidate: false, status: "unknown" });
    }
  }

  function renderShell() {
    if (!state.activeChatId) {
      document.getElementById(ROOT_ID)?.remove();
      return;
    }
    const target = findInputContainer();
    if (!target) return;

    const existing = document.getElementById(ROOT_ID);
    const root = existing || document.createElement("div");
    if (!existing) {
      root.id = ROOT_ID;
      root.innerHTML = [
        '<span class="gso-label">Next</span>',
        '<strong class="gso-next">Unknown</strong>',
        '<button type="button" class="gso-icon-button gso-persona" aria-label="Include persona candidate" title="Include persona candidate" aria-pressed="false">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>' +
        "</button>",
        '<button type="button" class="gso-icon-button gso-refresh" aria-label="Refresh next speaker" title="Refresh next speaker">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.36 6.36L4 16"/><path d="M4 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.36 5.64L20 8"/><path d="M20 3v5h-5"/></svg>' +
        "</button>",
      ].join("");
      root.querySelector(".gso-refresh")?.addEventListener("click", onRefreshClick);
      root.querySelector(".gso-persona")?.addEventListener("click", onPersonaToggle);
    }

    if (root.parentElement !== target || target.firstElementChild !== root) {
      target.insertBefore(root, target.firstChild);
    }
    updateBar(state.lastView);
  }

  async function onRefreshClick() {
    const chatId = state.activeChatId;
    if (!chatId) return;
    const button = document.getElementById(ROOT_ID)?.querySelector(".gso-refresh");
    if (button) button.disabled = true;
    try {
      const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/refresh`, { method: "POST", body: "{}" });
      if (chatId !== state.activeChatId) return;
      state.lastView = view;
      updateBar(view);
    } catch (error) {
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
      updateBar(view);
    } catch (error) {
      warn("settings update failed", error);
      await refreshView(chatId);
    }
  }

  function updateBar(view) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const shouldHide = !state.activeChatId || view?.enabled === false || view?.hidden === true;
    root.hidden = shouldHide;
    root.dataset.status = typeof view?.status === "string" ? view.status : "unknown";
    if (root.dataset.chatId !== (state.activeChatId || "")) root.dataset.chatId = state.activeChatId || "";
    root.querySelector(".gso-next").textContent = view?.nextSpeaker?.name || "Unknown";
    const personaButton = root.querySelector(".gso-persona");
    if (personaButton) personaButton.setAttribute("aria-pressed", view?.includePersonaCandidate === true ? "true" : "false");
  }

  function findInputContainer() {
    if (state.inputContainer?.isConnected) return state.inputContainer;
    const containers = Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .chat-input-container"));
    const visible = containers.find(isVisibleElement);
    if (visible) {
      state.inputContainer = visible;
      return visible;
    }

    const textarea = Array.from(document.querySelectorAll("textarea.mari-chat-input-textarea, textarea"))
      .filter(isVisibleElement)
      .at(-1);
    state.inputContainer = textarea?.closest(".mari-chat-input, .chat-input-container") || null;
    return state.inputContainer;
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) return false;
    if (!element.isConnected || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
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

  function readChatId() {
    for (const chatId of state.propsChatIds.values()) {
      if (chatId) return chatId;
    }

    const stores = [
      window.useChatStore?.getState?.(),
      window.__MARINARA_CHAT_STORE__?.getState?.(),
      window.__marinara?.chatStore?.getState?.(),
    ];
    for (const store of stores) {
      const id = store?.activeChatId || store?.currentChatId || store?.activeChat?.id || store?.chatId;
      if (typeof id === "string" && id.trim()) return id.trim();
    }

    const dataChatId = document.querySelector("[data-chat-id]")?.getAttribute("data-chat-id");
    if (dataChatId?.trim()) return dataChatId.trim();
    const storedChatId = localStorage.getItem("marinara-active-chat-id");
    if (storedChatId?.trim()) return storedChatId.trim();

    const url = new URL(window.location.href);
    const routeChatId = url.searchParams.get("chatId") || url.pathname.match(/\/chats?\/([^/?#]+)/u)?.[1] || "";
    return routeChatId ? decodeURIComponent(routeChatId) : "";
  }

  function patchHistoryMethod(method) {
    const original = history[method];
    if (original?.__groupSortOrderPatched) return;
    const patched = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      scheduleTick(0);
      return result;
    };
    patched.__groupSortOrderPatched = true;
    history[method] = patched;
  }

  function observeDom() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver(() => {
      const root = document.getElementById(ROOT_ID);
      if (root?.isConnected && state.inputContainer?.isConnected) return;
      state.inputContainer = null;
      scheduleTick(250);
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
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

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
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
    document.head.appendChild(style);
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
      window.clearTimeout(state.pollTimer);
      window.clearTimeout(state.renderTimer);
      state.observer?.disconnect();
      state.observer = null;
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
    },
  };
})();
