import { getActiveChatIdFromClient, injectStyle } from "../../../_mari-bridge/src/composer-dom.js";
import { ensureSlashCommandBridge, registerBridgeSlashCommand } from "../../../_mari-bridge/src/commands.js";
import {
  registerMessageActionContribution,
  scheduleMessageActionRender,
} from "../../../_mari-bridge/src/message-actions.js";

const PACKAGE_ID = "persona-reapply";
const TAG_NAME = "marinara-capability-persona-reapply";
const STYLE_ID = "persona-reapply-styles";
const state = window.__marinaraPersonaReapplyRuntime || {
  initialized: false,
  overrides: new Map(),
  disposers: [],
  toastTimer: 0,
};
window.__marinaraPersonaReapplyRuntime = state;
state.overrides = state.overrides instanceof Map ? state.overrides : new Map();
state.disposers = Array.isArray(state.disposers) ? state.disposers : [];

class PersonaReapplyElement extends HTMLElement {
  constructor() {
    super();
    this.onCapabilityProps = () => this.render();
    this.onClick = () => this.reapply();
    this.busy = false;
  }

  connectedCallback() {
    this.addEventListener("marinara-capability-props", this.onCapabilityProps);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("marinara-capability-props", this.onCapabilityProps);
  }

  render() {
    if (this.getAttribute("view") !== "message-actions" || this.capabilityProps?.role !== "user") {
      this.replaceChildren();
      this.hidden = true;
      return;
    }
    this.hidden = false;
    let button = this.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "persona-reapply-message-button";
      button.addEventListener("click", this.onClick);
      this.replaceChildren(button);
    }
    button.disabled = this.busy;
    button.replaceChildren();
    const icon = document.createElement("span");
    icon.className = "persona-reapply-message-icon";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.classList.toggle("persona-reapply-message-button--busy", this.busy);
    button.title = "Reapply this message's persona colours";
    button.setAttribute("aria-label", button.title);

    const key = overrideKey(this.capabilityProps?.chatId, this.capabilityProps?.messageId);
    const update = state.overrides.get(key);
    if (update) applyUpdateToVisibleMessage(update);
  }

  async reapply() {
    const chatId = this.capabilityProps?.chatId || getActiveChatIdFromClient();
    const messageId = this.capabilityProps?.messageId;
    if (!chatId || !messageId || this.busy) return;
    this.busy = true;
    this.render();
    try {
      const data = await fetchJson(
        `/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
        { method: "POST" },
      );
      const update = data.update;
      rememberAndApplyUpdate(chatId, update);
      showToast("Persona colours reapplied.", true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), false);
    } finally {
      this.busy = false;
      this.render();
      scheduleMessageActionRender(0);
    }
  }
}

if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, PersonaReapplyElement);

if (!state.initialized) {
  state.initialized = true;
  injectStyle(STYLE_ID, STYLES);
  registerMessageAction();
  registerSlashCommand();
}

function registerMessageAction() {
  state.disposers.push(
    registerMessageActionContribution({
      packageId: PACKAGE_ID,
      id: "reapply-colours",
      title: "Reapply persona colours",
      priority: 72,
      shouldShow: ({ chatId, role }) => Boolean(chatId) && role === "user",
    }),
  );
}

function registerSlashCommand() {
  ensureSlashCommandBridge();
  state.disposers.push(
    registerBridgeSlashCommand({
      packageId: PACKAGE_ID,
      id: "reapply-persona",
      commands: ["/reapply-persona"],
      priority: 72,
      async handler({ context }) {
        const chatId = context?.chatId || getActiveChatIdFromClient();
        if (!chatId) throw new Error("Open a chat before using /reapply-persona.");
        const confirmed = window.confirm(
          "Reapply the latest saved colours from each persona to every user message in this chat?",
        );
        if (!confirmed) {
          showToast("Persona colour refresh cancelled.", false);
          return { cancelled: true };
        }
        const data = await fetchJson(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/all`, {
          method: "POST",
        });
        for (const update of data.updates || []) rememberAndApplyUpdate(chatId, update);
        const summary = data.skipped
          ? `Updated ${data.updated} messages; skipped ${data.skipped}.`
          : `Updated ${data.updated} persona messages.`;
        showToast(summary, data.updated > 0);
        scheduleMessageActionRender(0);
        return data;
      },
    }),
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
  return data;
}

function rememberAndApplyUpdate(chatId, update) {
  if (!update?.messageId || !update?.personaSnapshot) return;
  state.overrides.set(overrideKey(chatId, update.messageId), update);
  applyUpdateToVisibleMessage(update);
}

function overrideKey(chatId, messageId) {
  return `${String(chatId || "")}:${String(messageId || "")}`;
}

function applyUpdateToVisibleMessage(update) {
  const messageId = String(update?.messageId || "");
  if (!messageId) return;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(messageId) : cssAttributeValue(messageId);
  const node = document.querySelector(`[data-message-id="${escaped}"]`);
  if (!(node instanceof HTMLElement)) return;
  const next = update.personaSnapshot || {};
  const previous = update.previousSnapshot || {};
  applyNameColor(node, next.nameColor);
  const chatMode = node.closest("[data-chat-mode]")?.getAttribute("data-chat-mode") || "";
  if (chatMode === "conversation") return;
  applyBoxColor(node, next.boxColor);
  applyDialogueColor(node, previous.dialogueColor, next.dialogueColor);
}

function applyNameColor(node, color) {
  const name = node.querySelector(".mari-message-name");
  if (!(name instanceof HTMLElement)) return;
  clearGradientStyles(name);
  for (const child of name.querySelectorAll(":scope > span[style]")) clearGradientStyles(child);
  const value = String(color || "").trim();
  if (!value) {
    name.style.removeProperty("color");
    name.style.removeProperty("-webkit-text-fill-color");
    return;
  }
  if (/gradient\(/i.test(value)) {
    name.style.backgroundImage = value;
    name.style.backgroundRepeat = "no-repeat";
    name.style.backgroundSize = "100% 100%";
    name.style.setProperty("-webkit-background-clip", "text");
    name.style.backgroundClip = "text";
    name.style.setProperty("-webkit-text-fill-color", "transparent");
    name.style.color = "transparent";
    return;
  }
  name.style.color = value;
  name.style.setProperty("-webkit-text-fill-color", value);
}

function clearGradientStyles(element) {
  if (!(element instanceof HTMLElement)) return;
  element.style.removeProperty("background-image");
  element.style.removeProperty("background-repeat");
  element.style.removeProperty("background-size");
  element.style.removeProperty("background-clip");
  element.style.removeProperty("-webkit-background-clip");
  element.style.removeProperty("-webkit-text-fill-color");
  element.style.removeProperty("display");
  if (element !== element.closest(".mari-message-name")) element.style.removeProperty("color");
}

function applyBoxColor(node, color) {
  const bubble = node.querySelector(".mari-message-bubble");
  if (!(bubble instanceof HTMLElement)) return;
  const value = String(color || "").trim();
  if (value) {
    bubble.style.setProperty("--mari-rp-bubble-bg", value);
    bubble.style.backgroundColor = value;
  } else {
    if (bubble.classList.contains("mari-rp-bubble")) {
      const opacity = readChatFontOpacity();
      bubble.style.setProperty(
        "--mari-rp-bubble-bg",
        opacity <= 0
          ? "transparent"
          : `color-mix(in srgb, var(--marinara-chat-chrome-panel-bg) ${opacity.toFixed(2)}%, transparent)`,
      );
    } else {
      bubble.style.removeProperty("--mari-rp-bubble-bg");
    }
    bubble.style.removeProperty("background-color");
  }
}

function readChatFontOpacity() {
  try {
    const stored = JSON.parse(localStorage.getItem("marinara-engine-ui") || "{}");
    const value = Number(stored?.state?.chatFontOpacity);
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  } catch {
    // Fall back to Marinara's default below.
  }
  return 90;
}

function applyDialogueColor(node, oldColor, newColor) {
  const oldValue = normalizeCssColor(oldColor);
  const newValue = String(newColor || "").trim();
  for (const element of node.querySelectorAll(".mari-message-content strong, .mari-message-content span")) {
    if (!(element instanceof HTMLElement)) continue;
    const current = normalizeCssColor(element.style.color);
    if ((oldValue && current === oldValue) || looksLikeDialogueElement(element)) {
      if (newValue) element.style.color = newValue;
      else element.style.removeProperty("color");
    }
  }
}

function normalizeCssColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const probe = document.createElement("span");
  probe.style.color = raw;
  return probe.style.color.toLowerCase();
}

function looksLikeDialogueElement(element) {
  const text = String(element.textContent || "").trim();
  if (text.length < 2) return false;
  const pairs = { '"': '"', "“": "”", "«": "»", "「": "」", "『": "』", "‹": "›" };
  return pairs[text[0]] === text[text.length - 1];
}

function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function showToast(message, ok) {
  let toast = document.querySelector(".persona-reapply-toast");
  if (!(toast instanceof HTMLElement)) {
    toast = document.createElement("div");
    toast.className = "persona-reapply-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("persona-reapply-toast--ok", ok);
  toast.classList.remove("persona-reapply-toast--out");
  if (state.toastTimer) window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.add("persona-reapply-toast--out"), 2800);
}

const STYLES = `
${TAG_NAME}[view="message-actions"] {
  display: inline-flex;
}

.persona-reapply-message-button {
  display: inline-flex;
  min-width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  color: var(--marinara-chat-chrome-button-text, var(--muted-foreground));
  font-size: 0.875rem;
  line-height: 1;
  transition: background-color 150ms ease, color 150ms ease, opacity 150ms ease;
}

.persona-reapply-message-button:hover {
  background: var(--marinara-chat-chrome-button-bg-hover, var(--accent));
  color: var(--marinara-chat-chrome-button-text-hover, var(--foreground));
}

.persona-reapply-message-button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.persona-reapply-message-icon {
  display: block;
  width: 0.9rem;
  height: 0.9rem;
  background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21a8 8 0 0 1 16 0z'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21a8 8 0 0 1 16 0z'/%3E%3C/svg%3E") center / contain no-repeat;
}

.persona-reapply-message-button--busy .persona-reapply-message-icon {
  animation: persona-reapply-pulse 750ms ease-in-out infinite alternate;
}

@keyframes persona-reapply-pulse {
  to { opacity: 0.35; transform: scale(0.88); }
}

.persona-reapply-toast {
  position: fixed;
  left: 50%;
  bottom: 5.5rem;
  z-index: 99999;
  max-width: min(90vw, 40rem);
  transform: translateX(-50%);
  border-radius: 0.625rem;
  background: rgba(15, 23, 42, 0.96);
  color: white;
  padding: 0.55rem 0.8rem;
  text-align: center;
  font: 700 0.75rem/1.3 system-ui, sans-serif;
  box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.42);
  transition: opacity 180ms ease;
}

.persona-reapply-toast--ok {
  background: linear-gradient(135deg, #059669, #0d9488);
}

.persona-reapply-toast--out {
  opacity: 0;
  pointer-events: none;
}
`;
