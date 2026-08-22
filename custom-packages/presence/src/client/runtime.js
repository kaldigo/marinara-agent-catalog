import { activateClientWithMariBridge } from "../../bridge-sdk/client.js";
import {
  escapeMariBridgeSettingsHtml,
  setMariBridgeNativeSettingsHtml,
} from "../../bridge-sdk/settings.js";
import { createHideCommandOwner } from "../../bridge-sdk/ranges.js";

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
    mount.dataset.presenceDetailView = view === "detail" ? "true" : "false";
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
  setPresenceNativeSettings(mount, `loading:${mount.dataset.chatId || ""}`, {
    sections: [{ html: '<p class="mari-native-settings-muted">Loading Presence settings...</p>' }],
  });
  bindPresenceChromeActions(mount);
}

function renderPresenceSettingsNotice(mount, message) {
  setPresenceNativeSettings(mount, `notice:${message}`, {
    sections: [{ html: `<p class="mari-native-settings-muted">${escapeMariBridgeSettingsHtml(message)}</p>` }],
  });
  bindPresenceChromeActions(mount);
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
  const changed = setPresenceNativeSettings(mount, renderKey, {
    sections: [
      {
        title: "Always present",
        description: "Selected characters see every non-globally-hidden message, even while inactive. Use this for narrators or other cards that should always know the full scene.",
        badge: activeCount > 0 ? { label: `${activeCount} selected` } : null,
        fields: [
          {
            type: "chips",
            optionAttribute: "data-presence-always-character-id",
            emptyText: "No characters in this chat.",
            options: data.roster.map((character) => ({
              value: character.id,
              label: character.name,
              avatarUrl: character.avatarUrl,
              selected: alwaysPresent.has(character.id),
            })),
          },
        ],
      },
    ],
  });
  if (!changed) return;
  bindPresenceChromeActions(mount);
  for (const button of mount.querySelectorAll("[data-presence-always-character-id]")) {
    button.addEventListener("click", () => {
      const characterId = button.getAttribute("data-presence-always-character-id");
      if (!characterId) return;
      toggleAlwaysPresentCharacter(data.chatId, characterId);
    });
  }
}

function bindPresenceChromeActions(mount) {
  mount.querySelector('[data-mari-native-action="back"]')?.addEventListener("click", () => mount.parentElement?.capabilityProps?.onClose?.());
  mount.querySelector('[data-mari-native-action="toggle-agent"]')?.addEventListener("click", async () => {
    const element = mount.parentElement;
    const next = element?.capabilityProps?.enabledForChat !== true;
    const button = mount.querySelector('[data-mari-native-action="toggle-agent"]');
    if (button) button.disabled = true;
    try {
      await element?.capabilityProps?.onEnabledForChatChange?.(next);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

function setPresenceNativeSettings(mount, renderKey, descriptor) {
  const host = mount.parentElement;
  const chatName = host?.capabilityProps?.chatName || "Current chat";
  const enabled = host?.capabilityProps?.enabledForChat === true;
  return setMariBridgeNativeSettingsHtml(mount, renderKey, {
    surface: mount.dataset.presenceDetailView === "true" ? "detail" : "chat",
    title: "Presence",
    subtitle: chatName,
    iconText: "PR",
    activation: mount.dataset.presenceDetailView === "true" ? {
      enabled,
      description: "Presence only tracks chats where this agent is enabled.",
    } : null,
    ...descriptor,
  });
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

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))];
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
