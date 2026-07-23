(() => {
  "use strict";
  // Shared runtime coordinator for bridge copies bundled by different packages.

  const MARI_BRIDGE_VERSION = "1.0.0";

  const MARI_BRIDGE_RUNTIME_KEY = "__mariBridgeRuntime";
  const DEFAULT_CAPABILITIES = [
    "runtime:newest-wins",
    "commands:register",
    "fetch:interceptors",
    "generation:lifecycle-events",
    "ui-slots:composer-above-input",
    "ui-slots:quick-actions-menu",
  ];

  // Returns the page-global Mari bridge runtime shared by every bundled bridge copy.
  function getMariBridgeRuntime() {
    const root = globalThis;
    const runtime = root[MARI_BRIDGE_RUNTIME_KEY] || {
      version: "0.0.0",
      capabilities: new Set(),
      subsystems: new Map(),
      warnings: [],
    };
    if (!(runtime.capabilities instanceof Set)) runtime.capabilities = new Set(runtime.capabilities || []);
    if (!(runtime.subsystems instanceof Map)) runtime.subsystems = new Map();
    if (!Array.isArray(runtime.warnings)) runtime.warnings = [];
    if (compareBridgeVersions(MARI_BRIDGE_VERSION, runtime.version) > 0) runtime.version = MARI_BRIDGE_VERSION;
    for (const capability of DEFAULT_CAPABILITIES) runtime.capabilities.add(capability);
    root[MARI_BRIDGE_RUNTIME_KEY] = runtime;
    return runtime;
  }

  // Claims a singleton bridge subsystem; newer bridge versions replace older owners.
  function claimBridgeSubsystem(name, definition = {}) {
    const runtime = getMariBridgeRuntime();
    const subsystem = String(name || "").trim();
    if (!subsystem) throw new Error("Bridge subsystem claim requires a name.");

    const version = String(definition.version || MARI_BRIDGE_VERSION);
    const ownerId = String(definition.ownerId || `${subsystem}@${version}`);
    const current = runtime.subsystems.get(subsystem) || null;
    const comparison = current ? compareBridgeVersions(version, current.version) : 1;

    if (current && comparison < 0) {
      warnBridgeRuntime(`Ignoring older ${subsystem} bridge ${version}; ${current.version} is already active.`);
      return { active: false, current, runtime, token: null };
    }

    if (current && comparison === 0 && current.installed) {
      return { active: false, current, runtime, token: current.token || null };
    }

    if (current?.cleanup) {
      try {
        current.cleanup();
      } catch (error) {
        warnBridgeRuntime(`Bridge subsystem ${subsystem} cleanup failed: ${errorMessage(error)}`);
      }
    }

    const token = Symbol(`mari-bridge:${subsystem}:${version}`);
    const next = {
      name: subsystem,
      version,
      ownerId,
      token,
      installed: false,
      installedAt: Date.now(),
      cleanup: null,
    };
    runtime.subsystems.set(subsystem, next);

    if (typeof definition.install === "function") {
      const cleanup = definition.install({ runtime, previous: current, token });
      if (typeof cleanup === "function") next.cleanup = cleanup;
    }
    next.installed = true;
    return { active: true, current: next, runtime, token };
  }

  // Checks whether a callback still belongs to the active owner of a subsystem.
  function isBridgeSubsystemOwner(name, token) {
    if (!token) return false;
    return getMariBridgeRuntime().subsystems.get(name)?.token === token;
  }

  // Registers package-neutral bridge capabilities for feature detection.
  function registerBridgeCapabilities(capabilities) {
    const runtime = getMariBridgeRuntime();
    for (const capability of Array.isArray(capabilities) ? capabilities : [capabilities]) {
      const normalized = String(capability || "").trim();
      if (normalized) runtime.capabilities.add(normalized);
    }
    return runtime;
  }

  function hasBridgeCapability(capability) {
    return getMariBridgeRuntime().capabilities.has(String(capability || "").trim());
  }

  function compareBridgeVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const delta = (a[index] || 0) - (b[index] || 0);
      if (delta !== 0) return delta > 0 ? 1 : -1;
    }
    return 0;
  }

  function warnBridgeRuntime(message) {
    const runtime = getMariBridgeRuntime();
    runtime.warnings.push({ message, at: Date.now() });
    if (runtime.warnings.length > 25) runtime.warnings.splice(0, runtime.warnings.length - 25);
    globalThis.console?.warn?.(`[mari-bridge] ${message}`);
  }

  function parseVersion(value) {
    return String(value || "0")
      .split(/[.-]/u)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
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

    const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/);
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


  // Upstream gap MB-010: packages do not yet have stable client DOM lifecycle,
  // style injection, or text-control helpers for package-owned UI surfaces.

  function createDomScope() {
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
  function injectStyle(id, cssText) {
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
  function isVisibleElement(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Updates a text input/textarea through native setters so React-like listeners fire.
  function setTextControlValue(control, value) {
    if (!control) return;
    const proto = control instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Resolves Marinara's active chat ID from URL, DOM markers, local storage, or known stores.
  function getActiveChatIdFromClient() {
    const fromUrl = readChatIdFromLocation();
    if (fromUrl) return fromUrl;
    const selected = document.querySelector('[data-chat-id][class*="sidebar-accent"], [data-chat-id][aria-current="true"]');
    if (selected) return selected.getAttribute("data-chat-id") || "";
    const firstDataChat = document.querySelector("[data-chat-id]");
    if (firstDataChat) return firstDataChat.getAttribute("data-chat-id") || "";
    const fromStore = localStorage.getItem("marinara-active-chat-id");
    if (fromStore) return fromStore;
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
  function watchActiveChatId(callback, options = {}) {
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



  // Upstream gap MB-001: packages cannot register Roleplay/Conversation slash commands.

  const COMMAND_BRIDGE_STATE_KEY = "__mariBridgeSlashCommandState";

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

  // Registers a browser-side package slash command or native-command augment.
  function registerBridgeSlashCommand(registration) {
    const normalized = normalizeBridgeCommandRegistration(registration);
    const state = getCommandBridgeState();
    state.registrations.set(normalized.key, normalized);
    ensureSlashCommandBridge();
    return () => {
      const current = state.registrations.get(normalized.key);
      if (current === normalized) state.registrations.delete(normalized.key);
    };
  }

  // Installs the bridge-owned composer interception runtime.
  function ensureSlashCommandBridge(options = {}) {
    const state = getCommandBridgeState();
    if (typeof options.resolveContext === "function") state.resolveContext = options.resolveContext;
    if (typeof options.onFeedback === "function") state.onFeedback = options.onFeedback;
    claimBridgeSubsystem("slash-commands", {
      version: MARI_BRIDGE_VERSION,
      ownerId: "mari-bridge:slash-commands",
      install: ({ token }) => {
        state.ownerToken = token;
        const start = () => installSlashCommandListeners(token);
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", start, { once: true });
          return () => document.removeEventListener("DOMContentLoaded", start);
        }
        return start();
      },
    });
    return state;
  }

  // Pure helper for tests and packages that want to inspect registered commands.
  function listBridgeSlashCommands() {
    return sortedBridgeRegistrations(getCommandBridgeState());
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

  function getCommandBridgeState() {
    if (!window[COMMAND_BRIDGE_STATE_KEY]) {
      window[COMMAND_BRIDGE_STATE_KEY] = {
        started: false,
        registrations: new Map(),
        resolveContext: null,
        onFeedback: null,
        ownerToken: null,
      };
    }
    const state = window[COMMAND_BRIDGE_STATE_KEY];
    if (!(state.registrations instanceof Map)) state.registrations = new Map();
    if (!("ownerToken" in state)) state.ownerToken = null;
    return state;
  }

  function installSlashCommandListeners(token) {
    const onKeyDown = (event) => {
      if (isBridgeSubsystemOwner("slash-commands", token)) onComposerKeyDownCapture(event);
    };
    const onSubmit = (event) => {
      if (isBridgeSubsystemOwner("slash-commands", token)) onComposerSubmitCapture(event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("submit", onSubmit, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("submit", onSubmit, true);
    };
  }

  async function onComposerKeyDownCapture(event) {
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return;
    await maybeHandleBridgeSlashCommand(event, target);
  }

  async function onComposerSubmitCapture(event) {
    if (event.defaultPrevented) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const field = form.querySelector("textarea, input[type='text']");
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      await maybeHandleBridgeSlashCommand(event, field);
    }
  }

  async function maybeHandleBridgeSlashCommand(event, field) {
    const raw = String(field.value || "").trim();
    if (!raw.startsWith("/")) return;
    const state = getCommandBridgeState();
    const match = matchSlashCommand(raw, sortedBridgeRegistrations(state));
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const context = await resolveCommandContext(state, { raw, field, match });
    try {
      const result = await match.registration.handler({ ...match, context });
      if (result?.clearInput !== false) setTextControlValue(field, "");
      publishCommandFeedback(state, {
        ok: true,
        packageId: match.registration.packageId,
        id: match.registration.id,
        command: match.command,
        result,
      });
    } catch (error) {
      publishCommandFeedback(state, {
        ok: false,
        packageId: match.registration.packageId,
        id: match.registration.id,
        command: match.command,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function resolveCommandContext(state, base) {
    const context = {
      chatId: getActiveChatIdFromClient(),
      field: base.field,
      raw: base.raw,
      match: base.match,
    };
    if (typeof state.resolveContext !== "function") return context;
    const extra = await state.resolveContext(context);
    return extra && typeof extra === "object" ? { ...context, ...extra } : context;
  }

  function publishCommandFeedback(state, detail) {
    state.onFeedback?.(detail);
    window.dispatchEvent(new CustomEvent("mari-bridge:slash-command-feedback", { detail }));
  }

  function sortedBridgeRegistrations(state) {
    return [...state.registrations.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  }

  function normalizeBridgeCommandRegistration(registration) {
    const packageId = String(registration?.packageId || "").trim();
    if (!packageId) throw new Error("Bridge slash command registration requires packageId.");
    const normalized = normalizeRegistration(registration);
    const localId = String(registration.id || normalized.id).trim();
    return {
      ...normalized,
      id: localId,
      key: `${packageId}:${localId}`,
      packageId,
      kind: registration.kind === "augment" ? "augment" : "command",
      priority: Number.isFinite(Number(registration.priority)) ? Number(registration.priority) : 100,
    };
  }



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

})();
