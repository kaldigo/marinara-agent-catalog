import { createPresenceCommandRouter } from "./command-handler.js";

const PACKAGE_ID = "presence";
const TAG_NAME = "marinara-capability-presence";
const state = window.__marinaraPresencePackageRuntime || {
  initialized: false,
  router: null,
};
window.__marinaraPresencePackageRuntime = state;

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
  state.router = createPresenceCommandRouter({
    runPresenceCommand: ({ raw, context }) => runServerCommand(raw, context),
    runScopedHideCommand: ({ raw, context }) => runServerCommand(raw, context),
  });
  exposeConsoleApi();
  document.addEventListener("keydown", onKeyDownCapture, true);
  document.addEventListener("submit", onSubmitCapture, true);
}

function exposeConsoleApi() {
  const api = window.marinaraPresence || {};
  window.marinaraPresence = {
    ...api,
    migrateCurrentChat: async () => {
      const chatId = resolveActiveChatId();
      if (!chatId) throw new Error("No active chat detected.");
      const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/migrate-extension`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
      return data;
    },
  };
}

async function onKeyDownCapture(event) {
  if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return;
  await maybeHandleComposerCommand(event, target);
}

async function onSubmitCapture(event) {
  if (event.defaultPrevented) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const field = form.querySelector("textarea, input[type='text']");
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    await maybeHandleComposerCommand(event, field);
  }
}

async function maybeHandleComposerCommand(event, field) {
  const raw = String(field.value || "").trim();
  const chatId = resolveActiveChatId();
  if (!chatId || !state.router?.match(raw)) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    const result = await state.router.run(raw, { chatId });
    if (!result.handled) return;
    field.value = "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    window.dispatchEvent(
      new CustomEvent("marinara-presence-feedback", {
        detail: result.result,
      }),
    );
  } catch (error) {
    console.warn("[Presence] command failed", error);
    window.dispatchEvent(
      new CustomEvent("marinara-presence-feedback", {
        detail: { ok: false, error: error instanceof Error ? error.message : String(error) },
      }),
    );
  }
}

async function runServerCommand(raw, context) {
  const chatId = context?.chatId || resolveActiveChatId();
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

function resolveActiveChatId() {
  const url = new URL(window.location.href);
  const routeChatId =
    url.searchParams.get("chatId") ||
    url.pathname.match(/\/chats?\/([^/?#]+)/)?.[1] ||
    document.querySelector("[data-chat-id]")?.getAttribute("data-chat-id");
  if (routeChatId) return routeChatId;
  const stores = [
    window.useChatStore?.getState?.(),
    window.__MARINARA_CHAT_STORE__?.getState?.(),
    window.__marinara?.chatStore?.getState?.(),
  ];
  for (const store of stores) {
    const id = store?.activeChatId || store?.currentChatId || store?.chatId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return "";
}
