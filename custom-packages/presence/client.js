(async () => {
  "use strict";
  const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 1 });
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
    const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/u);
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
    const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/gu;
    for (const match of String(text || "").matchAll(pattern)) {
      tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/gu, "$1"));
    }
    return tokens;
  }

  function looksLikeNativeMessageRange(value) {
    const text = String(value || "").trim().toLowerCase();
    return text === "all" || /^last\s+\d+$/u.test(text) || /^from\s+\d+\s+to\s+\d+$/u.test(text) || /^\d+(?:\s*-\s*\d+)?$/u.test(text);
  }

  function createHideCommandOwner() {
    return ({ tokens }) => Boolean(tokens?.[0]) && !looksLikeNativeMessageRange(tokens[0]);
  }


  const MARI_BRIDGE_SETTINGS_STYLE_ID = "mari-bridge-sdk-settings-style";

  function ensureMariBridgeSettingsStyles() {
    if (!globalThis.document || document.getElementById(MARI_BRIDGE_SETTINGS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MARI_BRIDGE_SETTINGS_STYLE_ID;
    style.textContent = `
      .mari-sdk-settings { display:flex; flex-direction:column; gap:.75rem; color:var(--foreground); }
      .mari-sdk-settings[aria-busy="true"] { opacity:.72; }
      .mari-sdk-settings-group { display:flex; flex-direction:column; gap:.55rem; border-top:1px solid color-mix(in srgb,var(--border) 60%,transparent); padding-top:.7rem; }
      .mari-sdk-settings-group:first-child { border-top:0; padding-top:0; }
      .mari-sdk-settings-heading { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
      .mari-sdk-settings-title { margin:0; font-size:.75rem; font-weight:600; line-height:1.35; }
      .mari-sdk-settings-description,.mari-sdk-settings-help,.mari-sdk-settings-status { margin:0; color:var(--muted-foreground); font-size:.6875rem; line-height:1.4; }
      .mari-sdk-settings-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.65rem; }
      .mari-sdk-settings-field { display:flex; min-width:0; flex-direction:column; gap:.3rem; }
      .mari-sdk-settings-label { font-size:.6875rem; font-weight:600; line-height:1.35; }
      .mari-sdk-settings-input,.mari-sdk-settings-select,.mari-sdk-settings-textarea { width:100%; box-sizing:border-box; border:0; border-radius:.5rem; background:color-mix(in srgb,var(--secondary) 70%,transparent); color:var(--foreground); font:inherit; font-size:.75rem; outline:none; padding:.45rem .6rem; box-shadow:0 0 0 1px var(--border); }
      .mari-sdk-settings-textarea { min-height:5rem; resize:vertical; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; line-height:1.45; }
      .mari-sdk-settings-input:focus,.mari-sdk-settings-select:focus,.mari-sdk-settings-textarea:focus { box-shadow:0 0 0 2px color-mix(in srgb,var(--ring) 70%,transparent); }
      .mari-sdk-settings-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:.4rem; }
      .mari-sdk-settings-button { border:0; border-radius:.45rem; background:var(--secondary); color:var(--foreground); cursor:pointer; font-size:.6875rem; font-weight:600; padding:.4rem .65rem; box-shadow:0 0 0 1px var(--border); }
      .mari-sdk-settings-button[data-variant="primary"] { background:var(--primary); color:var(--primary-foreground); box-shadow:none; }
      .mari-sdk-settings-button:disabled { cursor:default; opacity:.55; }
      .mari-sdk-settings-switch { display:flex; align-items:flex-start; justify-content:space-between; gap:.75rem; border-radius:.45rem; padding:.35rem .15rem; }
      .mari-sdk-settings-switch-copy { display:flex; min-width:0; flex-direction:column; gap:.1rem; }
      .mari-sdk-settings-switch input { width:1rem; height:1rem; margin:.1rem 0 0; accent-color:var(--primary); }
      .mari-sdk-settings-chip-list { display:flex; flex-wrap:wrap; gap:.5rem; }
      .mari-sdk-settings-chip { display:flex; flex-direction:column; align-items:center; gap:.25rem; width:3.75rem; border:0; background:transparent; color:var(--foreground); cursor:pointer; padding:0; }
      .mari-sdk-settings-chip-avatar { display:grid; place-items:center; width:2.25rem; height:2.25rem; overflow:hidden; border-radius:999px; background:var(--secondary); box-shadow:0 0 0 1px var(--border); }
      .mari-sdk-settings-chip-avatar img { width:100%; height:100%; object-fit:cover; }
      .mari-sdk-settings-chip[aria-checked="true"] .mari-sdk-settings-chip-avatar { box-shadow:0 0 0 2px var(--primary); }
      .mari-sdk-settings-chip-label { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.625rem; }
      .mari-sdk-settings-detail { min-height:0; overflow:auto; padding:1rem; }
      @media (max-width:640px) { .mari-sdk-settings-grid { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  function prepareMariBridgeSettingsRoot(root, options = {}) {
    if (!(root instanceof Element)) throw new TypeError("Mari Bridge settings root must be an Element");
    ensureMariBridgeSettingsStyles();
    root.classList.add("mari-sdk-settings");
    root.classList.toggle("mari-sdk-settings-detail", options.surface === "detail");
    return root;
  }

  function setMariBridgeSettingsHtml(root, renderKey, html) {
    prepareMariBridgeSettingsRoot(root);
    const key = String(renderKey ?? "");
    if (root.dataset.mariBridgeSettingsRenderKey === key) return false;
    root.dataset.mariBridgeSettingsRenderKey = key;
    root.innerHTML = String(html ?? "");
    return true;
  }

  function escapeMariBridgeSettingsHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }



  function readyClientRuntime() {
    const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
    return runtime?.status === "ready" && typeof runtime.registerConsumer === "function" ? runtime : null;
  }

  async function waitForClientRuntime(timeoutMs) {
    const timeout = Math.max(0, Math.min(30_000, Number(timeoutMs) || 0));
    const deadline = Date.now() + timeout;
    let runtime = readyClientRuntime();
    while (!runtime && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
      runtime = readyClientRuntime();
    }
    return runtime;
  }

  async function activateClientWithMariBridge(input, activateConsumer) {
    if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
    const requirements = normalizeBridgeRequirements(input);
    const runtime = readyClientRuntime() ?? await waitForClientRuntime(input?.waitForBridgeMs ?? 5_000);
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



  const cleanupPresenceClient = await activateClientWithMariBridge(
    {
      consumerId: "presence",
      api: { major: 1, minMinor: 0 },
      require: ["chat.active", "client.bridge-first", "commands", "consumer.sessions", "runtime.health", "ui.chat-settings"],
    },
    async (bridgeSession) => {

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
      const view = this.getAttribute("view");
      if (view !== "settings" && view !== "detail") {
        this.hidden = true;
        this.setAttribute("aria-hidden", "true");
        this.replaceChildren();
        return;
      }
      this.hidden = false;
      this.removeAttribute("aria-hidden");
      const mount = getSettingsRenderRoot(this);
      prepareMariBridgeSettingsRoot(mount, { surface: view === "detail" ? "detail" : "chat" });
      const chatId = getChatIdFromCapabilityProps(this.capabilityProps) || getActiveChatId();
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
          if (this.isConnected && ["settings", "detail"].includes(this.getAttribute("view")) && this.dataset.chatId === chatId) this.render();
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
    state.chatSettingsDisposer = bridgeSession.ui.register({
      id: "presence.settings",
      slot: "chat.settings",
      view: "settings",
      props: () => ({ enabledForChat: true }),
    });
  }

  function startChatLifecycleDetection() {
    state.chatWatcherCleanup = bridgeSession.chat.active.subscribe(({ chatId }) => scheduleEnsureActiveChat(chatId));
  }

  function getActiveChatId() {
    return bridgeSession.chat.active.getSnapshot().chatId || "";
  }

  function scheduleEnsureActiveChat(chatId = getActiveChatId()) {
    state.pendingChatId = chatId || "";
    if (state.ensureTimer) window.clearTimeout(state.ensureTimer);
    state.ensureTimer = window.setTimeout(ensureActiveChat, 150);
    scheduleRenderPresenceSettings();
  }

  async function ensureActiveChat() {
    state.ensureTimer = 0;
    const chatId = state.pendingChatId || getActiveChatId();
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
            avatarUrl: typeof character.avatarUrl === "string" && character.avatarUrl.trim() ? character.avatarUrl.trim() : null,
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
    setPresenceSettingsHtml(mount, `loading:${mount.dataset.chatId || ""}`, '<p class="mari-sdk-settings-status">Loading Presence settings...</p>');
  }

  function renderPresenceSettingsNotice(mount, message) {
    setPresenceSettingsHtml(mount, `notice:${message}`, `<p class="mari-sdk-settings-status">${escapeMariBridgeSettingsHtml(message)}</p>`);
  }

  function renderPresenceSettingsSection(mount, data) {
    if (data.error) {
      mount.hidden = false;
      renderPresenceSettingsNotice(mount, `Presence settings could not load: ${data.error}`);
      return;
    }
    mount.hidden = false;
    const alwaysPresent = new Set(uniqueStrings(data.state?.alwaysPresentCharacterIds));
    const renderKey = JSON.stringify({
      chatId: data.chatId,
      roster: data.roster.map((character) => [character.id, character.name, character.avatarUrl]),
      alwaysPresent: [...alwaysPresent].sort(),
    });
    const activeCount = alwaysPresent.size;
    const items = data.roster.map((character) => {
      const selected = alwaysPresent.has(character.id);
      const avatar = character.avatarUrl
        ? `<img src="${escapeAttribute(character.avatarUrl)}" alt="" aria-hidden="true" loading="lazy">`
        : `<span aria-hidden="true">${escapeHtml(character.name.trim().charAt(0).toUpperCase() || "?")}</span>`;
      return `
        <button type="button" class="mari-sdk-settings-chip" data-presence-always-character-id="${escapeAttribute(character.id)}" role="checkbox" aria-checked="${selected ? "true" : "false"}" aria-label="${selected ? "Remove" : "Add"} ${escapeAttribute(character.name)} as always present" title="${escapeAttribute(character.name)}">
          <span class="mari-sdk-settings-chip-avatar">${avatar}</span>
          <span class="mari-sdk-settings-chip-label">${escapeHtml(character.name)}</span>
        </button>
      `;
    }).join("");
    const changed = setPresenceSettingsHtml(mount, renderKey, `
        <section class="mari-sdk-settings-group">
          <div class="mari-sdk-settings-heading">
            <h3 class="mari-sdk-settings-title">Always present</h3>
            ${activeCount > 0 ? `<span class="mari-presence-count">${activeCount} selected</span>` : ""}
          </div>
          <p class="mari-sdk-settings-description">
            Selected characters see every non-globally-hidden message, even while inactive. Use this for narrators or other cards that should always know the full scene.
          </p>
          <div class="mari-sdk-settings-chip-list" role="group" aria-label="Always present characters">
            ${items || '<p class="mari-sdk-settings-status">No characters in this chat.</p>'}
          </div>
        </section>
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
    return setMariBridgeSettingsHtml(mount, renderKey, html);
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
      .mari-presence-character-picker {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        padding: 0.25rem 0.125rem 0;
      }
      .mari-presence-character-choice {
        align-items: center;
        background: transparent;
        border: 0;
        color: var(--foreground);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0;
        width: 3.5rem;
      }
      .mari-presence-character-avatar {
        align-items: center;
        background: var(--marinara-chat-chrome-highlight-bg, var(--accent));
        border: 2px solid transparent;
        border-radius: 999px;
        color: var(--marinara-chat-chrome-highlight-text, var(--accent-foreground));
        display: flex;
        font-size: 0.75rem;
        font-weight: 700;
        height: 2.5rem;
        justify-content: center;
        opacity: 0.55;
        overflow: hidden;
        transition: opacity 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
        width: 2.5rem;
      }
      .mari-presence-character-avatar img {
        height: 100%;
        object-fit: cover;
        width: 100%;
      }
      .mari-presence-character-choice:hover .mari-presence-character-avatar {
        opacity: 1;
        transform: translateY(-1px);
      }
      .mari-presence-character-choice:focus-visible {
        outline: none;
      }
      .mari-presence-character-choice:focus-visible .mari-presence-character-avatar {
        box-shadow: 0 0 0 2px var(--marinara-chat-chrome-focus-ring, var(--ring));
        opacity: 1;
      }
      .mari-presence-character-choice.is-selected .mari-presence-character-avatar {
        border-color: var(--marinara-chat-chrome-button-border-active, var(--primary));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 25%, transparent);
        opacity: 1;
      }
      .mari-presence-character-label {
        display: block;
        font-size: 0.59375rem;
        line-height: 1.2;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
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
    const chatId = context?.chatId || getActiveChatId();
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
    state.commandDisposers.push(
      bridgeSession.commands.register({
        id: "presence.command",
        commands: ["/presence"],
        description: "Show or update character presence for this chat",
        usage: "/presence [status or character]",
        handler: ({ raw, context }) => runServerCommand(raw, context),
      }),
    );
    state.commandDisposers.push(
      bridgeSession.commands.register({
        id: "hide-from-ai.augment",
        hijacks: ["/hide", "/unhide"],
        owns: createHideCommandOwner(),
        handler: ({ raw, context }) => runServerCommand(raw, context),
      }),
    );
  }

  return async () => {
    if (state.ensureTimer) window.clearTimeout(state.ensureTimer);
    if (state.settingsTimer) window.clearTimeout(state.settingsTimer);
    state.chatWatcherCleanup?.();
    state.chatWatcherCleanup = null;
    state.chatSettingsDisposer?.();
    state.chatSettingsDisposer = null;
    for (const dispose of state.commandDisposers.splice(0)) dispose();
    state.initialized = false;
  };
    },
  );

  void cleanupPresenceClient;

})();
