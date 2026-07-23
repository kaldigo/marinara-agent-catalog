import { createHideHijackOwner, ensureSlashCommandBridge, registerBridgeSlashCommand } from "../../bridge/commands.js";
import { getActiveChatIdFromClient, watchActiveChatId } from "../../bridge/composer-dom.js";

const PACKAGE_ID = "presence";
const TAG_NAME = "marinara-capability-presence";
const state = window.__marinaraPresencePackageRuntime || {
  initialized: false,
  commandDisposers: [],
  activeChatId: "",
  pendingChatId: "",
  chatWatcherCleanup: null,
  ensureTimer: 0,
  ensureInFlight: new Set(),
  lastEnsureAttemptAt: 0,
  lastEnsureAttemptChatId: "",
};
window.__marinaraPresencePackageRuntime = state;
state.activeChatId = typeof state.activeChatId === "string" ? state.activeChatId : "";
state.pendingChatId = typeof state.pendingChatId === "string" ? state.pendingChatId : "";
state.chatWatcherCleanup = typeof state.chatWatcherCleanup === "function" ? state.chatWatcherCleanup : null;
state.ensureTimer = Number(state.ensureTimer) || 0;
state.ensureInFlight = state.ensureInFlight instanceof Set ? state.ensureInFlight : new Set();
state.commandDisposers = Array.isArray(state.commandDisposers) ? state.commandDisposers : [];
state.lastEnsureAttemptAt = Number(state.lastEnsureAttemptAt) || 0;
state.lastEnsureAttemptChatId = typeof state.lastEnsureAttemptChatId === "string" ? state.lastEnsureAttemptChatId : "";

class PresenceCapabilityElement extends HTMLElement {
  connectedCallback() {
    this.hidden = true;
    this.setAttribute("aria-hidden", "true");
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, PresenceCapabilityElement);
}

if (!state.initialized) {
  state.initialized = true;
  registerPresenceCommands();
}
if (!state.chatWatcherCleanup) startChatLifecycleDetection();

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
