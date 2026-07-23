const PACKAGE_ID = "presence";
const TAG_NAME = "marinara-capability-presence";
const state = window.__marinaraPresencePackageRuntime || {
  initialized: false,
  router: null,
  activeChatId: "",
  ensureTimer: 0,
  ensureInFlight: new Set(),
  lastEnsureAttemptAt: 0,
  lastEnsureAttemptChatId: "",
};
window.__marinaraPresencePackageRuntime = state;
state.activeChatId = typeof state.activeChatId === "string" ? state.activeChatId : "";
state.ensureTimer = Number(state.ensureTimer) || 0;
state.ensureInFlight = state.ensureInFlight instanceof Set ? state.ensureInFlight : new Set();
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
  state.router = createPresenceCommandRouter({
    runPresenceCommand: ({ raw, context }) => runServerCommand(raw, context),
    runScopedHideCommand: ({ raw, context }) => runServerCommand(raw, context),
  });
  startChatLifecycleDetection();
  document.addEventListener("keydown", onKeyDownCapture, true);
  document.addEventListener("submit", onSubmitCapture, true);
}

function startChatLifecycleDetection() {
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");
  window.addEventListener("popstate", scheduleEnsureActiveChat);
  window.addEventListener("focus", scheduleEnsureActiveChat);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleEnsureActiveChat();
  });
  setInterval(scheduleEnsureActiveChat, 2_000);
  scheduleEnsureActiveChat();
}

function patchHistoryMethod(method) {
  const original = history[method];
  if (original?.__presencePatched) return;
  const patched = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);
    scheduleEnsureActiveChat();
    return result;
  };
  patched.__presencePatched = true;
  history[method] = patched;
}

function scheduleEnsureActiveChat() {
  if (state.ensureTimer) window.clearTimeout(state.ensureTimer);
  state.ensureTimer = window.setTimeout(ensureActiveChat, 150);
}

async function ensureActiveChat() {
  state.ensureTimer = 0;
  const chatId = resolveActiveChatId();
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
    document.querySelector("[data-chat-id]")?.getAttribute("data-chat-id") ||
    localStorage.getItem("marinara-active-chat-id");
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

function createPresenceCommandRouter({ runPresenceCommand, runScopedHideCommand }) {
  const router = createSlashCommandRouter();
  router.register({
    id: "presence-command",
    commands: ["/presence"],
    handler: ({ raw, tokens, context }) => runPresenceCommand({ raw, tokens, context }),
  });
  router.register({
    id: "presence-hide-hijack",
    hijacks: ["/hide", "/unhide"],
    owns: createHideHijackOwner(),
    handler: ({ command, raw, tokens, context }) =>
      runScopedHideCommand({
        raw,
        tokens,
        hidden: command.toLowerCase() === "/hide",
        context,
      }),
  });
  return router;
}

function createSlashCommandRouter() {
  const registrations = new Map();
  return {
    register(registration) {
      const normalized = normalizeRegistration(registration);
      registrations.set(normalized.id, normalized);
      return () => registrations.delete(normalized.id);
    },
    match(rawText) {
      return matchSlashCommand(rawText, [...registrations.values()]);
    },
    async run(rawText, context = {}) {
      const match = matchSlashCommand(rawText, [...registrations.values()]);
      if (!match) return { handled: false };
      const result = await match.registration.handler({ ...match, context });
      return { handled: true, result };
    },
  };
}

function matchSlashCommand(rawText, registrations) {
  const raw = String(rawText || "").trim();
  if (!raw.startsWith("/")) return null;
  for (const registration of registrations || []) {
    const match = matchOne(raw, normalizeRegistration(registration));
    if (match) return match;
  }
  return null;
}

function normalizeRegistration(registration) {
  if (!registration?.id) throw new Error("Slash command registration requires an id.");
  if (typeof registration.handler !== "function") {
    throw new Error(`Slash command ${registration.id} requires a handler.`);
  }
  return {
    id: String(registration.id),
    commands: normalizeCommandNames(registration.commands || registration.command || registration.name),
    hijacks: normalizeCommandNames(registration.hijacks || []),
    owns: typeof registration.owns === "function" ? registration.owns : () => true,
    handler: registration.handler,
  };
}

function normalizeCommandNames(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter(Boolean)
    .map((item) => String(item).trim().toLowerCase())
    .map((item) => (item.startsWith("/") ? item : `/${item}`));
}

function matchOne(raw, registration) {
  const lower = raw.toLowerCase();
  const direct = registration.commands.find((command) => lower === command || lower.startsWith(`${command} `));
  if (direct) {
    const tail = raw.slice(direct.length).trim();
    const tokens = tokenizeCommandTail(tail);
    if (!registration.owns({ raw, command: direct, tail, tokens, hijacked: false })) return null;
    return { registration, raw, command: direct, tail, tokens, hijacked: false };
  }

  for (const hijack of registration.hijacks) {
    if (lower !== hijack && !lower.startsWith(`${hijack} `)) continue;
    const tail = raw.slice(hijack.length).trim();
    const tokens = tokenizeCommandTail(tail);
    if (!tokens.length) continue;
    if (looksLikeNativeMessageRange(tail)) continue;
    if (!registration.owns({ raw, command: hijack, tail, tokens, hijacked: true })) continue;
    return { registration, raw, command: hijack, tail, tokens, hijacked: true };
  }

  return null;
}

function createHideHijackOwner() {
  return ({ tokens }) => {
    const first = tokens[0] || "";
    return Boolean(first) && !looksLikeNativeMessageRange(first);
  };
}

function tokenizeCommandTail(text) {
  const tokens = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(text || "")))) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1"));
  }
  return tokens;
}

function looksLikeNativeMessageRange(value) {
  const text = String(value || "").trim().toLowerCase();
  return (
    text === "all" ||
    /^last\s+\d+$/u.test(text) ||
    /^from\s+\d+\s+to\s+\d+$/u.test(text) ||
    /^\d+(?:\s*-\s*\d+)?$/u.test(text)
  );
}
