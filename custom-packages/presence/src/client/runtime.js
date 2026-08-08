import { createHideHijackOwner, ensureSlashCommandBridge, registerBridgeSlashCommand } from "../../bridge/commands.js";
import { registerCapabilityChatSettingsContribution } from "../../bridge/chat-settings.js";
import { getActiveChatIdFromClient, watchActiveChatId } from "../../bridge/composer-dom.js";

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
