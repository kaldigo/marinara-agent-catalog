// Upstream gap MB-010: packages do not yet have stable client DOM lifecycle,
// style injection, or text-control helpers for package-owned UI surfaces.

export function createDomScope() {
  const cleanups = [];
  const timers = new Set();

  function cleanup(fn) {
    if (typeof fn === "function") cleanups.push(fn);
    return fn;
  }

  function on(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== "function") return () => {};
    target.addEventListener(type, handler, options);
    return cleanup(() => target.removeEventListener(type, handler, options));
  }

  function observe(target, handler, options) {
    if (!target || typeof MutationObserver !== "function") return null;
    const observer = new MutationObserver(handler);
    observer.observe(target, options);
    cleanup(() => observer.disconnect());
    return observer;
  }

  function timeout(handler, ms) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      handler();
    }, ms);
    timers.add(id);
    return id;
  }

  function clearTimer(id) {
    if (!id) return;
    timers.delete(id);
    window.clearTimeout(id);
  }

  function destroy() {
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    while (cleanups.length) {
      try {
        cleanups.pop()?.();
      } catch {}
    }
  }

  return { cleanup, on, observe, timeout, clearTimer, destroy };
}

// Injects or updates package-owned CSS with a stable style element ID.
export function injectStyle(id, cssText) {
  const existing = document.getElementById(id);
  if (existing) {
    existing.textContent = cssText;
    return existing;
  }
  const style = document.createElement("style");
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
  return style;
}

// Checks whether a DOM element is currently visible in layout.
export function isVisibleElement(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Updates a text input/textarea through native setters so React-like listeners fire.
export function setTextControlValue(control, value) {
  if (!control) return;
  const proto = control instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

// Resolves Marinara's active chat ID from URL, DOM markers, local storage, or known stores.
export function getActiveChatIdFromClient() {
  const fromUrl = readChatIdFromLocation();
  if (fromUrl) return fromUrl;
  const fromStoreApi = readChatIdFromKnownStores();
  if (fromStoreApi) return fromStoreApi;
  const fromLocalStorage = readStoredActiveChatId();
  if (fromLocalStorage) return fromLocalStorage;
  const selected = document.querySelector('[data-chat-id][class*="sidebar-accent"], [data-chat-id][aria-current="true"]');
  if (selected) return selected.getAttribute("data-chat-id") || "";
  const firstDataChat = document.querySelector("[data-chat-id]");
  if (firstDataChat) return firstDataChat.getAttribute("data-chat-id") || "";
  return "";
}

function readStoredActiveChatId() {
  try {
    return localStorage.getItem("marinara-active-chat-id") || "";
  } catch {
    return "";
  }
}

function readChatIdFromKnownStores() {
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

// Watches active chat changes caused by routing, focus/visibility, DOM, or store updates.
export function watchActiveChatId(callback, options = {}) {
  if (typeof callback !== "function") throw new Error("watchActiveChatId requires a callback.");
  const scope = createDomScope();
  const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 2_000;
  const debounceMs = Number.isFinite(Number(options.debounceMs)) ? Number(options.debounceMs) : 150;
  let activeChatId = "";
  let timer = 0;

  function emitIfChanged() {
    timer = 0;
    const chatId = getActiveChatIdFromClient();
    if (chatId === activeChatId) return;
    activeChatId = chatId;
    callback(chatId);
  }

  function schedule(delayMs = debounceMs) {
    if (timer) scope.clearTimer(timer);
    timer = scope.timeout(emitIfChanged, delayMs);
  }

  scope.cleanup(subscribeHistoryForChatWatcher("pushState", schedule));
  scope.cleanup(subscribeHistoryForChatWatcher("replaceState", schedule));
  scope.on(window, "popstate", () => schedule(0));
  scope.on(window, "focus", () => schedule());
  scope.on(document, "visibilitychange", () => {
    if (!document.hidden) schedule();
  });
  if (document.body) {
    scope.observe(document.body, () => schedule(), {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-chat-id", "aria-current", "class"],
    });
  }
  if (intervalMs > 0) {
    const intervalId = window.setInterval(() => schedule(), intervalMs);
    scope.cleanup(() => window.clearInterval(intervalId));
  }
  if (options.emitInitial !== false) schedule(0);
  return () => scope.destroy();
}

function readChatIdFromLocation() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get("chatId") || url.pathname.match(/\/chats?\/([^/?#]+)/)?.[1] || "";
  } catch {
    return "";
  }
}

function subscribeHistoryForChatWatcher(method, schedule) {
  const state = getChatWatcherHistoryState();
  state.watchers[method].add(schedule);
  const original = history[method];
  if (original && !state.patched[method]) {
    state.original[method] = original;
    history[method] = function patchedHistoryMethod(...args) {
      const result = state.original[method].apply(this, args);
      for (const watcher of [...state.watchers[method]]) watcher();
      return result;
    };
    state.patched[method] = true;
  }
  return () => state.watchers[method].delete(schedule);
}

function getChatWatcherHistoryState() {
  const key = "__mariBridgeChatWatcherHistoryState";
  if (!window[key]) {
    window[key] = {
      original: {},
      patched: {},
      watchers: {
        pushState: new Set(),
        replaceState: new Set(),
      },
    };
  }
  return window[key];
}
