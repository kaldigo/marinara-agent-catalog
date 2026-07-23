// Generated from packages branch source by the catalog rebuild workflow.
const PACKAGE_ID = "impersonate-button-extension";
const TAG_NAME = "marinara-capability-impersonate-button-extension";
const LEGACY_CSS = ".mari-si-root {\n  position: relative;\n  display: inline-flex;\n  user-select: none;\n  -webkit-user-select: none;\n  -webkit-touch-callout: none;\n  -webkit-user-drag: none;\n  -webkit-tap-highlight-color: transparent;\n  height: 2.25rem;\n  width: 2.25rem;\n  flex-shrink: 0;\n  align-items: center;\n  justify-content: center;\n}\n\n.mari-si-root,\n.mari-si-root * {\n  user-select: none;\n  -webkit-user-select: none;\n  -webkit-touch-callout: none;\n  -webkit-user-drag: none;\n  -webkit-tap-highlight-color: transparent;\n}\n\n@media (min-width: 640px) {\n  .mari-si-root {\n    height: 2rem;\n    width: 2rem;\n  }\n}\n\n.mari-si-button {\n  display: flex;\n  height: 2.25rem;\n  width: 2.25rem;\n  flex-shrink: 0;\n  align-items: center;\n  justify-content: center;\n  border-radius: 999px;\n  border: 0;\n  background: transparent;\n  color: color-mix(in srgb, currentColor 75%, transparent);\n  cursor: pointer;\n  touch-action: manipulation;\n  user-select: none;\n  -webkit-user-select: none;\n  -webkit-touch-callout: none;\n  -webkit-user-drag: none;\n  transition: all 160ms ease;\n}\n\n@media (min-width: 640px) {\n  .mari-si-button {\n    height: 2rem;\n    width: 2rem;\n  }\n}\n\n.mari-si-button:hover:not(:disabled),\n.mari-si-button.mari-si-active {\n  background: color-mix(in srgb, currentColor 10%, transparent);\n  color: currentColor;\n}\n\n.mari-si-button:active:not(:disabled) {\n  transform: scale(0.9);\n}\n\n.mari-si-button:disabled {\n  cursor: not-allowed;\n  opacity: 0.5;\n  color: color-mix(in srgb, currentColor 25%, transparent);\n}\n\n.mari-si-button svg {\n  width: 1rem;\n  height: 1rem;\n  pointer-events: none;\n}\n\n.mari-si-native-stop {\n  position: relative;\n}\n\n.mari-si-native-stop > svg {\n  width: 1rem;\n  height: 1rem;\n  flex-shrink: 0;\n  pointer-events: none;\n  opacity: 0;\n}\n\n.mari-si-native-stop::before {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 1rem;\n  height: 1rem;\n  transform: translate(-50%, -50%);\n  background: currentColor;\n  pointer-events: none;\n  -webkit-mask: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1'/%3E%3C/svg%3E\") center / contain no-repeat;\n  mask: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1'/%3E%3C/svg%3E\") center / contain no-repeat;\n}\n\n.mari-si-menu {\n  position: absolute;\n  left: 50%;\n  bottom: calc(100% + 0.5rem);\n  z-index: 60;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 0.375rem;\n  transform: translateX(-50%) translateY(0.75rem) scale(0.75);\n  opacity: 0;\n  pointer-events: none;\n  filter: blur(2px);\n  transition: opacity 140ms ease, transform 160ms ease, filter 160ms ease;\n}\n\n.mari-si-menu.mari-si-menu-open {\n  transform: translateX(-50%) translateY(0) scale(1);\n  opacity: 1;\n  pointer-events: auto;\n  filter: blur(0);\n}\n\n.mari-si-menu-action {\n  position: relative;\n  display: flex;\n  height: 2.75rem;\n  width: 2.75rem;\n  align-items: center;\n  justify-content: center;\n  border-radius: 999px;\n  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);\n  background: var(--card, color-mix(in srgb, canvas 92%, currentColor 8%));\n  color: color-mix(in srgb, currentColor 65%, transparent);\n  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.35);\n  cursor: pointer;\n  touch-action: manipulation;\n  user-select: none;\n  -webkit-user-select: none;\n  -webkit-touch-callout: none;\n  -webkit-user-drag: none;\n  outline: none;\n  transition: background 120ms ease, color 120ms ease, transform 120ms ease;\n}\n\n.mari-si-menu-action:hover:not(:disabled) {\n  background: color-mix(in srgb, currentColor 10%, var(--card, transparent));\n  color: currentColor;\n}\n\n.mari-si-menu-action:active:not(:disabled) {\n  transform: scale(0.95);\n}\n\n.mari-si-menu-action span {\n  display: flex;\n  height: 2rem;\n  width: 2rem;\n  align-items: center;\n  justify-content: center;\n  border-radius: 999px;\n  background: color-mix(in srgb, currentColor 10%, transparent);\n}\n\n.mari-si-menu-action svg {\n  width: 1rem;\n  height: 1rem;\n  pointer-events: none;\n}\n\n.mari-si-menu-action-mobile-main {\n  display: none;\n}\n\n.mari-si-picker-actions {\n  position: fixed;\n  z-index: 10000;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 0.375rem;\n  transform: translateX(-50%);\n  user-select: none;\n  -webkit-user-select: none;\n  -webkit-touch-callout: none;\n  -webkit-user-drag: none;\n  -webkit-tap-highlight-color: transparent;\n}\n\n.mari-si-picker-action {\n  display: flex;\n  height: 2.5rem;\n  width: 2.5rem;\n  align-items: center;\n  justify-content: center;\n  border-radius: 999px;\n  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);\n  background: var(--card, color-mix(in srgb, canvas 92%, currentColor 8%));\n  color: color-mix(in srgb, currentColor 65%, transparent);\n  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);\n  cursor: pointer;\n  touch-action: manipulation;\n  user-select: none;\n  -webkit-user-select: none;\n  -webkit-touch-callout: none;\n  -webkit-user-drag: none;\n  transition: background 120ms ease, color 120ms ease, transform 120ms ease;\n}\n\n.mari-si-picker-action:hover:not(:disabled) {\n  background: color-mix(in srgb, currentColor 10%, var(--card, transparent));\n  color: currentColor;\n}\n\n.mari-si-picker-action:active:not(:disabled) {\n  transform: scale(0.95);\n}\n\n.mari-si-picker-action span {\n  display: flex;\n  height: 1.75rem;\n  width: 1.75rem;\n  align-items: center;\n  justify-content: center;\n  border-radius: 999px;\n  background: color-mix(in srgb, currentColor 10%, transparent);\n}\n\n.mari-si-picker-action svg {\n  width: 0.9375rem;\n  height: 0.9375rem;\n  pointer-events: none;\n}\n\n@media (max-width: 639.98px) {\n  .mari-si-root.mari-si-mobile-root-hidden,\n  .mari-si-quick-replies-hidden {\n    display: none !important;\n  }\n\n  .mari-si-menu-action-mobile-main {\n    display: flex;\n  }\n}\n\n.mari-si-toast {\n  position: fixed;\n  left: 50%;\n  bottom: 86px;\n  z-index: 99999;\n  max-width: min(90vw, 640px);\n  transform: translateX(-50%);\n  border-radius: 10px;\n  background: rgba(0, 0, 0, 0.85);\n  color: #fff;\n  padding: 8px 12px;\n  text-align: center;\n  font: 700 12px/1.2 system-ui, Segoe UI, Roboto, Helvetica, Arial;\n  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);\n  transition: opacity 220ms ease;\n}\n\n.mari-si-toast-ok {\n  background: linear-gradient(135deg, #10b981, #14b8a6);\n}\n\n.mari-si-toast-out {\n  opacity: 0;\n}\n";


function defineCapabilityElement(tagName) {
  if (customElements.get(tagName)) return;
  customElements.define(tagName, class extends HTMLElement {
    connectedCallback() {
      this.hidden = true;
      this.setAttribute("aria-hidden", "true");
    }
  });
}

function ensureLegacyMarinaraBridge() {
  const existing = window.__marinaraLegacyCapabilityBridge;
  if (existing?.api) {
    if (!window.marinara) window.marinara = existing.api;
    return existing;
  }

  const runtime = {
    cleanupStack: [],
    globalCleanups: [],
    styles: new Map(),
  };

  function activeCleanups() {
    return runtime.cleanupStack[runtime.cleanupStack.length - 1] || runtime.globalCleanups;
  }

  function track(cleanup) {
    activeCleanups().push(cleanup);
    return cleanup;
  }

  function normalizeApiPath(path) {
    const value = String(path || "");
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/api/") || value === "/api") return value;
    return "/api" + (value.startsWith("/") ? value : "/" + value);
  }

  const api = {
    on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      track(() => target.removeEventListener(type, handler, options));
    },
    onCleanup(cleanup) {
      if (typeof cleanup === "function") track(cleanup);
    },
    observe(target, callback, options) {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      track(() => observer.disconnect());
      return observer;
    },
    setTimeout(handler, timeout, ...args) {
      const id = window.setTimeout(handler, timeout, ...args);
      track(() => window.clearTimeout(id));
      return id;
    },
    setInterval(handler, timeout, ...args) {
      const id = window.setInterval(handler, timeout, ...args);
      track(() => window.clearInterval(id));
      return id;
    },
    addStyle(css) {
      const key = createStyleKey(css);
      let record = runtime.styles.get(key);
      if (!record) {
        const style = document.createElement("style");
        style.textContent = css;
        style.dataset.marinaraLegacyCapabilityStyle = key;
        document.head.appendChild(style);
        record = { style, refs: 0 };
        runtime.styles.set(key, record);
      }
      record.refs += 1;
      track(() => {
        record.refs -= 1;
        if (record.refs <= 0) {
          record.style.remove();
          runtime.styles.delete(key);
        }
      });
      return record.style;
    },
    async apiFetch(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (typeof options.body === "string" && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const response = await fetch(normalizeApiPath(path), {
        cache: "no-store",
        ...options,
        headers,
      });
      if (response.status === 204) return {};
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const error = new Error(data?.error || response.status + " " + response.statusText);
        error.status = response.status;
        error.body = data;
        throw error;
      }
      return data;
    },
  };

  function createStyleKey(css) {
    let hash = 0;
    for (let index = 0; index < css.length; index += 1) {
      hash = (hash * 31 + css.charCodeAt(index)) >>> 0;
    }
    return css.length + "-" + hash.toString(36);
  }

  runtime.api = api;
  runtime.withCleanups = (cleanups, callback) => {
    runtime.cleanupStack.push(cleanups);
    try {
      return callback();
    } finally {
      runtime.cleanupStack.pop();
    }
  };
  window.__marinaraLegacyCapabilityBridge = runtime;
  if (!window.marinara) window.marinara = api;
  return runtime;
}


defineCapabilityElement(TAG_NAME);

const installedPorts = window.__marinaraLegacyCapabilityPorts || {};
window.__marinaraLegacyCapabilityPorts = installedPorts;

if (!installedPorts[PACKAGE_ID]) {
  const bridge = ensureLegacyMarinaraBridge();
  const cleanups = [];
  const port = {
    cleanups,
    uninstall() {
      while (cleanups.length) {
        const cleanup = cleanups.pop();
        try {
          cleanup?.();
        } catch (error) {
          console.warn("[Marinara legacy capability]", PACKAGE_ID, "cleanup failed", error);
        }
      }
      if (installedPorts[PACKAGE_ID] === port) delete installedPorts[PACKAGE_ID];
    },
  };
  installedPorts[PACKAGE_ID] = port;
  bridge.withCleanups(cleanups, () => {
    if (LEGACY_CSS) bridge.api.addStyle(LEGACY_CSS);

(() => {
  "use strict";

  // src/al-dente-factory/constants.js
  const FACTORY_KEY = "alDenteFactory";
  const READY_EVENT = "al-dente:factory-ready";
  const FACTORY_ISSUE_EVENT = "al-dente:factory-issue";
  const WAKE_HOLD_EVENT = "al-dente:wake-lock:hold";
  const WAKE_RELEASE_EVENT = "al-dente:wake-lock:release";
  const VERSION = "1.0.1";
  const MAJOR_VERSION = Number(VERSION.split(".")[0]) || 0;
  const REQUEST_BACKOFF_MS = 5000;

  // src/al-dente-factory/events.js
  function eventType(type) {
    const text = String(type || "").trim();
    return text.startsWith("al-dente:") ? text : `al-dente:${text}`;
  }
  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(eventType(type), { detail }));
  }
  function notifyFactoryIssue(type, detail) {
    const payload = { type, ...detail };
    console.warn("[alDenteFactory]", type, detail);
    window.dispatchEvent(new CustomEvent(FACTORY_ISSUE_EVENT, { detail: payload }));
    document.documentElement?.setAttribute?.("data-al-dente-factory-issue", type);
  }
  function createEventBus() {
    function on(type, handler, options) {
      if (typeof handler !== "function") return () => false;
      const wrapped = (event) => handler(event.detail, event);
      window.addEventListener(eventType(type), wrapped, options);
      return () => {
        window.removeEventListener(eventType(type), wrapped, options);
        return true;
      };
    }

    function once(type, handler, options) {
      if (typeof handler !== "function") return () => false;
      return on(type, handler, { ...(options || {}), once: true });
    }

    return Object.freeze({
      on,
      once,
      off: (type, wrapped, options) => {
        window.removeEventListener(eventType(type), wrapped, options);
        return true;
      },
      emit,
    });
  }

  // src/al-dente-factory/strings.js
  function toCleanString(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }
  function normalizeId(value, fallback = "") {
    return toCleanString(value, fallback)
      .toLowerCase()
      .replace(/[^a-z0-9_.:-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // src/al-dente-factory/fetch-hub.js
  function methodOf(input, init) {
    return String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
  }

  function parseJsonBody(init) {
    if (typeof init?.body !== "string") return null;
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }

  function cloneInitWithBody(input, init, body) {
    const nextInit = { ...(init || {}) };
    nextInit.method = String(nextInit.method || (typeof input !== "string" ? input?.method : "") || "POST");
    nextInit.body = JSON.stringify(body);
    const headers = new Headers(nextInit.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    nextInit.headers = headers;
    return nextInit;
  }

  function interceptorMatches(record, context) {
    if (typeof record.match === "function") return record.match(context) === true;
    if (record.route) return record.route === context.route.route || record.route === context.route.kind;
    return true;
  }
  function createFetchHub(state, routes) {
    const wasInstalled = state.fetchInstalled === true;
    state.fetchInstalled = false;

    function baseFetch(input, init) {
      const fetchFn = typeof state.originalFetch === "function" ? state.originalFetch : window.fetch.bind(window);
      return fetchFn(input, init);
    }

    function orderedInterceptors() {
      return Array.from(state.fetchInterceptors.values()).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    }

    async function runPipeline(input, init = {}) {
      const route = routes.classify(input);
      const context = {
        input,
        init,
        method: methodOf(input, init),
        route,
        body: parseJsonBody(init),
        cloneInitWithBody: (body) => cloneInitWithBody(input, init, body),
        fetchOriginal: baseFetch,
      };
      const stack = orderedInterceptors().filter((record) => interceptorMatches(record, context));

      const buildContext = (previous, nextInput, nextInit) => ({
        ...previous,
        input: nextInput,
        init: nextInit,
        method: methodOf(nextInput, nextInit),
        route: routes.classify(nextInput),
        body: parseJsonBody(nextInit),
        cloneInitWithBody: (body) => cloneInitWithBody(nextInput, nextInit, body),
      });

      const dispatch = async (index, currentContext) => {
        const record = stack[index];
        if (!record) return baseFetch(currentContext.input, currentContext.init);
        let called = false;
        const next = async (nextInput = currentContext.input, nextInit = currentContext.init) => {
          if (called) throw new Error(`Fetch interceptor "${record.id}" called next() more than once.`);
          called = true;
          const nextContext = nextInput === currentContext.input && nextInit === currentContext.init
            ? currentContext
            : buildContext(currentContext, nextInput, nextInit);
          return dispatch(index + 1, nextContext);
        };
        return record.handler(currentContext, next);
      };

      return dispatch(0, context);
    }

    function install() {
      if (state.fetchInstalled && state.fetchHandler && window.fetch === state.fetchHandler) return true;
      if (typeof state.originalFetch !== "function") state.originalFetch = window.fetch.bind(window);
      state.fetchHandler = (input, init = {}) => runPipeline(input, init);
      window.fetch = state.fetchHandler;
      state.fetchInstalled = true;
      emit("fetch:installed", {});
      return true;
    }

    function uninstall() {
      if (!state.fetchInstalled || !state.originalFetch) return false;
      window.fetch = state.originalFetch;
      state.originalFetch = null;
      state.fetchHandler = null;
      state.fetchInstalled = false;
      emit("fetch:uninstalled", {});
      return true;
    }

    function register(definition = {}) {
      const id = normalizeId(definition.id, "");
      if (!id) throw new Error("alDenteFactory.marinara.fetch.intercepts.register requires an id.");
      if (typeof definition.handler !== "function") throw new Error(`Fetch interceptor "${id}" requires a handler.`);

      const record = {
        id,
        route: definition.route || "",
        priority: Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : 100,
        match: typeof definition.match === "function" ? definition.match : null,
        handler: definition.handler,
        registeredAt: new Date().toISOString(),
      };
      state.fetchInterceptors.set(id, record);
      if (definition.install !== false) install();
      emit("fetch:interceptor-registered", { id, route: record.route, priority: record.priority });

      return Object.freeze({
        id,
        unregister: () => unregister(id, definition.handler),
      });
    }

    function unregister(id, expectedHandler) {
      const key = normalizeId(id, "");
      const record = state.fetchInterceptors.get(key);
      if (!record) return false;
      if (expectedHandler && record.handler !== expectedHandler) return false;
      state.fetchInterceptors.delete(key);
      emit("fetch:interceptor-unregistered", { id: key });
      return true;
    }

    const surface = Object.freeze({
      install,
      uninstall,
      isInstalled: () => state.fetchInstalled === true,
      intercepts: Object.freeze({
        register,
        unregister,
        list: () => orderedInterceptors().map(({ id, route, priority, registeredAt }) => ({ id, route, priority, registeredAt })),
      }),
      cloneInitWithBody,
      fetchOriginal: baseFetch,
    });

    if (wasInstalled) install();
    return surface;
  }

  // src/al-dente-factory/extensions.js
  function publicExtensionRecord(record) {
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      capabilities: [...record.capabilities],
      registeredAt: record.registeredAt,
      updatedAt: record.updatedAt,
    };
  }
  function createExtensionRegistry(state) {
    function registerExtension(definition = {}) {
      const id = normalizeId(definition.id, definition.name || "");
      if (!id) throw new Error("alDenteFactory.registerExtension requires an id or name.");

      const now = new Date().toISOString();
      const existingRecord = state.extensions.get(id);
      const record = {
        id,
        name: toCleanString(definition.name, existingRecord?.name || id),
        version: toCleanString(definition.version, existingRecord?.version || ""),
        capabilities: new Set(Array.isArray(definition.capabilities) ? definition.capabilities.map(String) : existingRecord?.capabilities || []),
        openOptions: typeof definition.openOptions === "function" ? definition.openOptions : existingRecord?.openOptions || null,
        registeredAt: existingRecord?.registeredAt || now,
        updatedAt: now,
      };

      state.extensions.set(id, record);
      emit("extension-registered", { extension: publicExtensionRecord(record) });

      return Object.freeze({
        id,
        update: (patch = {}) => registerExtension({ ...definition, ...patch, id }),
        unregister: () => {
          const current = state.extensions.get(id);
          if (current !== record) return false;
          state.extensions.delete(id);
          emit("extension-unregistered", { id });
          return true;
        },
        openOptions: (context = {}) => openOptions(id, context),
      });
    }

    function listExtensions() {
      return Array.from(state.extensions.values()).map(publicExtensionRecord);
    }

    function getExtension(id) {
      const record = state.extensions.get(normalizeId(id, ""));
      return record ? publicExtensionRecord(record) : null;
    }

    function openOptions(id, context = {}) {
      const extensionId = normalizeId(id, "");
      const record = state.extensions.get(extensionId);
      if (!record) return false;

      emit("open-options", { id: extensionId, context });
      if (typeof record.openOptions !== "function") return false;
      record.openOptions(context);
      return true;
    }

    return {
      registerExtension,
      listExtensions,
      getExtension,
      openOptions,
    };
  }

  // src/al-dente-factory/api.js
  function normalizeApiPath(path) {
    return String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
  }

  async function parseResponse(response) {
    if (response.status === 204) return {};
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(json?.error || `${response.status} ${response.statusText}`);
      error.status = response.status;
      error.body = json;
      throw error;
    }
    return json;
  }
  function createApiClient(state) {
    function baseFetch() {
      return typeof state.originalFetch === "function" ? state.originalFetch : window.fetch.bind(window);
    }

    async function request(path, options = {}) {
      const response = await baseFetch()(`/api${normalizeApiPath(path)}`, {
        ...options,
        headers: {
          ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
        cache: options.cache || "no-store",
      });
      return parseResponse(response);
    }

    return Object.freeze({
      request,
      get: (path, options) => request(path, { ...(options || {}), method: "GET" }),
      post: (path, body, options = {}) => request(path, { ...options, method: "POST", body: JSON.stringify(body ?? {}) }),
      patch: (path, body, options = {}) => request(path, { ...options, method: "PATCH", body: JSON.stringify(body ?? {}) }),
      delete: (path, options) => request(path, { ...(options || {}), method: "DELETE" }),
    });
  }

  // src/al-dente-factory/commands.js
  function commandNameFromText(text) {
    const match = String(text || "").trim().match(/^\/([A-Za-z][\w:-]*)(?:\s|$)/);
    return match ? match[1].toLowerCase() : "";
  }

  function parseTokens(text) {
    const tokens = [];
    const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
    let match;
    while ((match = re.exec(String(text || "")))) {
      tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1"));
    }
    return tokens;
  }

  function findInputRoot() {
    return Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input"))
      .filter((el) => el instanceof HTMLElement && el.querySelector("textarea.mari-chat-input-textarea, textarea"))
      .find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) || null;
  }

  function findTextarea() {
    return findInputRoot()?.querySelector("textarea.mari-chat-input-textarea, textarea") || null;
  }

  function isSendButton(target) {
    return Boolean(
      target instanceof Element &&
        target.closest("button.mari-chat-send-btn, button[title='Send'], button[aria-label='Send']"),
    );
  }

  function setTextareaValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    try {
      textarea.style.height = "auto";
    } catch {}
    try {
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
    } catch {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function publicCommandRecord(record) {
    return {
      id: record.id,
      names: [...record.names],
      source: record.source,
      description: record.description,
      registeredAt: record.registeredAt,
    };
  }

  function removeCommandListeners(state) {
    const cleanups = Array.isArray(state.commandCleanups) ? state.commandCleanups.splice(0) : [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {}
    }
    state.commandsInstalled = false;
  }
  function createCommandSurface(state) {
    if (state.commandsInstalled) removeCommandListeners(state);

    function orderedCommands() {
      return Array.from(state.commands.values()).sort((a, b) => a.id.localeCompare(b.id));
    }

    function findCommand(name) {
      const normalized = String(name || "").toLowerCase();
      return orderedCommands().find((record) => record.names.has(normalized)) || null;
    }

    function clearInput(textarea) {
      if (textarea instanceof HTMLTextAreaElement) setTextareaValue(textarea, "");
    }

    async function run(raw, context = {}) {
      const trimmed = String(raw || "").trim();
      const name = commandNameFromText(trimmed);
      if (!name) return false;
      const record = findCommand(name);
      if (!record) return false;

      const argText = trimmed.replace(/^\/[A-Za-z][\w:-]*(?:\s|$)/, "").trim();
      const detail = {
        id: record.id,
        name,
        raw: trimmed,
        argText,
        tokens: parseTokens(argText),
        context,
      };
      emit("command:start", detail);
      try {
        await record.handler(detail);
        emit("command:finish", detail);
      } catch (error) {
        emit("command:error", { ...detail, error });
        throw error;
      }
      return true;
    }

    function consume(textarea, event, source) {
      const raw = textarea?.value || "";
      if (!commandNameFromText(raw)) return false;
      if (!findCommand(commandNameFromText(raw))) return false;

      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      const commandText = String(raw || "").trim();
      clearInput(textarea);
      run(commandText, { textarea, event, source, clearInput }).catch((error) => {
        console.warn("[alDenteFactory commands] command failed", error);
      });
      return true;
    }

    function install() {
      if (state.commandsInstalled) return;
      const keyHandler = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement)) return;
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
        consume(target, event, "keyboard");
      };
      const clickHandler = (event) => {
        if (!isSendButton(event.target)) return;
        const textarea = findTextarea();
        if (textarea) consume(textarea, event, "send-button");
      };
      document.addEventListener("keydown", keyHandler, true);
      document.addEventListener("click", clickHandler, true);
      state.commandCleanups.push(() => document.removeEventListener("keydown", keyHandler, true));
      state.commandCleanups.push(() => document.removeEventListener("click", clickHandler, true));
      state.commandsInstalled = true;
      emit("commands:installed", {});
    }

    function register(definition = {}) {
      const id = normalizeId(definition.id, "");
      if (!id) throw new Error("alDenteFactory.marinara.commands.register requires an id.");
      if (typeof definition.handler !== "function") throw new Error(`Command "${id}" requires a handler.`);

      const names = new Set(
        [definition.name, ...(Array.isArray(definition.names) ? definition.names : [])]
          .map((name) => String(name || "").replace(/^\//, "").toLowerCase().trim())
          .filter(Boolean),
      );
      if (!names.size) throw new Error(`Command "${id}" requires at least one name.`);

      const record = {
        id,
        names,
        source: String(definition.source || ""),
        description: String(definition.description || ""),
        handler: definition.handler,
        registeredAt: new Date().toISOString(),
      };
      state.commands.set(id, record);
      install();
      emit("command:registered", { command: publicCommandRecord(record) });

      return Object.freeze({
        id,
        unregister: () => unregister(id, definition.handler),
      });
    }

    function unregister(id, expectedHandler) {
      const key = normalizeId(id, "");
      const record = state.commands.get(key);
      if (!record) return false;
      if (expectedHandler && record.handler !== expectedHandler) return false;
      state.commands.delete(key);
      emit("command:unregistered", { id: key });
      return true;
    }

    if (state.commands.size > 0) install();

    return Object.freeze({
      register,
      unregister,
      run,
      parseTokens,
      list: () => orderedCommands().map(publicCommandRecord),
      has: (name) => Boolean(findCommand(name)),
    });
  }

  // src/al-dente-factory/generation.js
  function createRunId(state, route, chatId) {
    state.generationSeq += 1;
    return `${route || "generation"}:${chatId || "unknown"}:${state.generationSeq}`;
  }

  function publicRun(run) {
    return {
      id: run.id,
      chatId: run.chatId,
      route: run.route,
      source: run.source,
      status: run.status,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      body: run.body,
    };
  }
  function createGenerationTracker(state, sse, messages) {
    function start(options = {}) {
      const now = new Date().toISOString();
      const route = options.route || "generate";
      const chatId = options.chatId || options.body?.chatId || "";
      const id = options.id || createRunId(state, route, chatId);
      const run = {
        id,
        chatId,
        route,
        source: options.source || "",
        status: "running",
        startedAt: now,
        updatedAt: now,
        finishedAt: "",
        body: options.body || null,
      };
      state.generationRuns.set(id, run);
      emit("generation:start", { generation: publicRun(run) });
      return Object.freeze({
        id,
        status: () => publicRun(run),
        event: (event) => handleEvent(run, event),
        finish: (detail) => finish(run, "done", detail),
        fail: (error) => finish(run, "error", { error }),
        abort: (detail) => finish(run, "abort", detail),
        wrapResponse: (response, handlers = {}) => wrapResponse(response, run, handlers),
      });
    }

    function handleEvent(run, event) {
      emit("generation:event", { generation: publicRun(run), event });
      messages.handleSseEvent(run.chatId, event, { generationId: run.id, route: run.route });
      if (event?.type === "done") finish(run, "done");
      if (event?.type === "aborted") finish(run, "abort");
      if (event?.type === "error") finish(run, "error", { event });
    }

    function finish(run, status, detail = {}) {
      if (!state.generationRuns.has(run.id)) return publicRun(run);
      run.status = status;
      run.updatedAt = new Date().toISOString();
      run.finishedAt = run.updatedAt;
      state.generationRuns.delete(run.id);
      const generation = publicRun(run);
      emit(status === "error" ? "generation:error" : status === "abort" ? "generation:abort" : "generation:done", { generation, detail });
      return generation;
    }

    function wrapResponse(response, run, handlers = {}) {
      if (!sse.isSseResponse(response)) {
        finish(run, response?.ok === false ? "error" : "done", { nonStreaming: true, status: response?.status });
        return response;
      }
      return sse.wrapResponse(response, {
        onPayload: (payload, event) => {
          if (event) handleEvent(run, event);
          handlers.onPayload?.(payload, event);
        },
        onDone: (type, value) => {
          if (type === "done") finish(run, "done");
          else if (type === "cancel") finish(run, "abort", { reason: value });
          else if (type === "error") finish(run, "error", { error: value });
          handlers.onDone?.(type, value);
        },
        onError: handlers.onError,
        onCancel: handlers.onCancel,
      });
    }

    return Object.freeze({
      start,
      get: (id) => {
        const run = state.generationRuns.get(id);
        return run ? publicRun(run) : null;
      },
      list: () => Array.from(state.generationRuns.values()).map(publicRun),
      wrapResponse: (response, options = {}, handlers = {}) => start(options).wrapResponse(response, handlers),
    });
  }

  // src/al-dente-factory/parsers.js
  function maybeJson(value, fallback = null) {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  function recordOrEmpty(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function chatMetadata(chat) {
    return recordOrEmpty(maybeJson(chat?.metadata, chat?.metadata || {}));
  }
  function messageExtra(message) {
    return recordOrEmpty(maybeJson(message?.extra, message?.extra || {}));
  }
  function characterData(character) {
    return recordOrEmpty(maybeJson(character?.data, character?.data || {}));
  }
  function messageContent(message) {
    return String(message?.content ?? message?.mes ?? message?.message ?? "");
  }
  function readCharacterName(character, fallback = "") {
    const data = characterData(character);
    return String(character?.name || data?.name || fallback || character?.id || "Character").trim();
  }
  function readCharacterDescription(character) {
    const data = characterData(character);
    const extensions = recordOrEmpty(maybeJson(data?.extensions, data?.extensions || {}));
    return String(
      [character?.description, data?.description, extensions?.backstory]
        .find((value) => typeof value === "string" && value.trim()) || "",
    );
  }
  function getCharacterIds(chat) {
    const ids = maybeJson(chat?.characterIds, []);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.trim()).map(String) : [];
  }
  function getInactiveCharacterIds(chat) {
    const inactive = chatMetadata(chat).inactiveCharacterIds;
    return Array.isArray(inactive) ? inactive.filter((id) => typeof id === "string" && id.trim()).map(String) : [];
  }
  function activeCharacterIdsForChat(chat, rosterIds = getCharacterIds(chat)) {
    const inactive = new Set(getInactiveCharacterIds(chat));
    const active = rosterIds.filter((id) => !inactive.has(id));
    return active.length ? active : rosterIds;
  }
  function normalizeName(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }
  function normalizeEntityId(value) {
    return normalizeId(value, "");
  }
  function createParsersSurface() {
    return Object.freeze({
      maybeJson,
      recordOrEmpty,
      chatMetadata,
      messageExtra,
      characterData,
      messageContent,
      readCharacterName,
      readCharacterDescription,
      getCharacterIds,
      getInactiveCharacterIds,
      activeCharacterIdsForChat,
      normalizeName,
      normalizeEntityId,
    });
  }

  // src/al-dente-factory/identity.js
  const CACHE_TTL_MS = 5000;

  function cacheGet(cache, key) {
    const hit = cache.get(key);
    if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
    return hit.value;
  }

  function cacheSet(cache, key, value) {
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  function readPersonaName(persona, fallback = "") {
    const data = characterData(persona);
    return String(persona?.name || data?.name || fallback || persona?.id || "Persona").trim();
  }

  function addNameIndex(map, name, value) {
    const normalized = normalizeName(name);
    if (normalized && !map.has(normalized)) map.set(normalized, value);
  }
  function createIdentityService(state, api, parsers) {
    function readActiveChatId() {
      const stored = localStorage.getItem("marinara-active-chat-id");
      if (stored) return stored;
      const selected = document.querySelector('[data-chat-id][aria-current="true"], [data-chat-id][class*="sidebar-accent"]');
      return selected?.getAttribute("data-chat-id") || "";
    }

    async function getChat(chatId = readActiveChatId()) {
      if (!chatId) return null;
      const key = String(chatId);
      const cached = cacheGet(state.caches.chats, key);
      if (cached) return cached;
      const chat = await api.get(`/chats/${encodeURIComponent(key)}`);
      return cacheSet(state.caches.chats, key, chat);
    }

    async function getMessages(chatId = readActiveChatId()) {
      if (!chatId) return [];
      const key = String(chatId);
      const cached = cacheGet(state.caches.messages, key);
      if (cached) return cached;
      const res = await api.get(`/chats/${encodeURIComponent(key)}/messages`);
      const messages = Array.isArray(res) ? res : res?.messages || res?.data || [];
      return cacheSet(state.caches.messages, key, messages);
    }

    async function getCharacter(characterId) {
      if (!characterId) return null;
      const key = String(characterId);
      const cached = cacheGet(state.caches.characters, key);
      if (cached) return cached;
      const character = await api.get(`/characters/${encodeURIComponent(key)}`).catch(() => null);
      const normalized = character ? { ...character, id: character.id || key, name: readCharacterName(character, key) } : null;
      return cacheSet(state.caches.characters, key, normalized);
    }

    async function getPersona(personaId) {
      if (!personaId) return null;
      const key = String(personaId);
      const cached = cacheGet(state.caches.personas, key);
      if (cached) return cached;
      const persona = await api.get(`/characters/personas/${encodeURIComponent(key)}`).catch(() => null);
      const normalized = persona ? { ...persona, id: persona.id || key, name: readPersonaName(persona, key) } : null;
      return cacheSet(state.caches.personas, key, normalized);
    }

    async function getActivePersona(chatId = readActiveChatId()) {
      const chat = chatId ? await getChat(chatId).catch(() => null) : null;
      const personaId = typeof chat?.personaId === "string" && chat.personaId.trim() ? chat.personaId.trim() : "";
      if (personaId) {
        const persona = await getPersona(personaId);
        if (persona) return persona;
      }
      const active = await api.get("/characters/personas/active").catch(() => null);
      return active ? { ...active, id: active.id || personaId || "active", name: readPersonaName(active, "Persona") } : null;
    }

    async function getRoster(chatId = readActiveChatId()) {
      const chat = await getChat(chatId);
      if (!chat) return null;
      const ids = getCharacterIds(chat);
      const characters = [];
      for (const id of ids) {
        const character = await getCharacter(id);
        characters.push(character || { id, name: id });
      }
      const persona = await getActivePersona(chatId);
      const charactersById = new Map(characters.map((character) => [character.id, character]));
      const charactersByName = new Map();
      for (const character of characters) {
        addNameIndex(charactersByName, character.name, character);
        const data = characterData(character);
        if (Array.isArray(data?.aliases)) {
          for (const alias of data.aliases) addNameIndex(charactersByName, alias, character);
        }
      }
      const personaNames = new Map();
      if (persona) {
        addNameIndex(personaNames, persona.name, persona);
        addNameIndex(personaNames, "{{user}}", persona);
      }

      return {
        chatId,
        chat,
        persona,
        characters,
        characterIds: ids,
        activeCharacterIds: activeCharacterIdsForChat(chat, ids),
        charactersById,
        charactersByName,
        personaNames,
      };
    }

    function matchCharacter(value, roster) {
      if (!value || !roster) return null;
      const raw = String(value).trim();
      return roster.charactersById?.get(raw) || roster.charactersByName?.get(normalizeName(raw)) || null;
    }

    async function resolveSpeaker(message, chatId = readActiveChatId()) {
      const roster = await getRoster(chatId).catch(() => null);
      const characterId = typeof message?.characterId === "string" ? message.characterId.trim() : "";
      if (characterId && roster?.charactersById?.has(characterId)) {
        return { type: "character", character: roster.charactersById.get(characterId), name: roster.charactersById.get(characterId).name };
      }
      if (message?.role === "user" && roster?.persona) {
        return { type: "persona", persona: roster.persona, name: roster.persona.name };
      }
      return { type: message?.role || "unknown", name: messageContent(message).split(":")[0] || "" };
    }

    function clearCache(scope = "all") {
      if (scope === "all" || scope === "chats") state.caches.chats.clear();
      if (scope === "all" || scope === "messages") state.caches.messages.clear();
      if (scope === "all" || scope === "characters") state.caches.characters.clear();
      if (scope === "all" || scope === "personas") state.caches.personas.clear();
    }

    return Object.freeze({
      readActiveChatId,
      getChat,
      getMessages,
      getCharacter,
      getPersona,
      getActivePersona,
      getRoster,
      resolveSpeaker,
      matchCharacter,
      normalizeName,
      clearCache,
      parsers,
    });
  }

  // src/al-dente-factory/messages.js
  function messageIdFromSavedEvent(event) {
    return event?.data?.id || event?.data?.messageId || "";
  }

  function messageFromCreateResponse(json) {
    return json?.message || json?.data || json || null;
  }
  function createMessageTracker(state) {
    function emitCreated(chatId, message, context = {}) {
      const messageId = message?.id || message?.messageId || "";
      if (!chatId || !messageId) return null;
      const detail = { chatId, messageId: String(messageId), message, context };
      emit("message:created", detail);
      return detail;
    }

    function emitSaved(chatId, event, context = {}) {
      const messageId = messageIdFromSavedEvent(event);
      if (!chatId || !messageId) return null;
      const detail = { chatId, messageId: String(messageId), event, message: event?.data || null, context };
      emit("message:saved", detail);
      return detail;
    }

    async function trackCreateResponse(chatId, response, context = {}) {
      if (!response?.ok) return response;
      let json = null;
      try {
        json = await response.clone().json();
      } catch {
        json = null;
      }
      const message = messageFromCreateResponse(json);
      if (message) emitCreated(chatId, message, context);
      return response;
    }

    function handleSseEvent(chatId, event, context = {}) {
      if (event?.type === "message_saved") return emitSaved(chatId, event, context);
      return null;
    }

    return Object.freeze({
      emitCreated,
      emitSaved,
      trackCreateResponse,
      handleSseEvent,
    });
  }

  // src/al-dente-factory/operations.js
  function publicOperationRecord(record) {
    return {
      id: record.id,
      source: record.source,
      kind: record.kind,
      label: record.label,
      reason: record.reason,
      status: record.status,
      detail: record.detail,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      finishedAt: record.finishedAt,
      error: record.error,
      wakeLock: Boolean(record.wakeLease),
    };
  }
  function createOperationTracker(state, wakeLock) {
    function start(options = {}) {
      const source = toCleanString(options.source, "unknown");
      const id = normalizeId(options.id, `${normalizeId(source, "operation")}:${++state.operationSeq}`);
      const now = new Date().toISOString();
      const wakeLockOptions = options.wakeLock === true
        ? { id: `operation:${id}`, source, reason: options.reason || options.kind || "operation" }
        : options.wakeLock && typeof options.wakeLock === "object"
          ? { source, reason: options.reason || options.kind || "operation", ...options.wakeLock }
          : null;

      const record = {
        id,
        source,
        kind: toCleanString(options.kind, "operation"),
        label: toCleanString(options.label, ""),
        reason: toCleanString(options.reason, ""),
        status: "running",
        detail: options.detail || null,
        startedAt: now,
        updatedAt: now,
        finishedAt: "",
        error: null,
        wakeLease: wakeLockOptions ? wakeLock.hold(wakeLockOptions) : null,
      };

      state.operations.set(id, record);
      emit("operation:start", { operation: publicOperationRecord(record) });

      let closed = false;
      function close(status, patch = {}) {
        if (closed) return publicOperationRecord(record);
        closed = true;
        record.status = status;
        record.updatedAt = new Date().toISOString();
        record.finishedAt = record.updatedAt;
        if (patch.detail !== undefined) record.detail = patch.detail;
        if (patch.error !== undefined) record.error = patch.error;
        try {
          record.wakeLease?.release?.();
        } finally {
          record.wakeLease = null;
          state.operations.delete(id);
        }
        const operation = publicOperationRecord(record);
        emit(status === "failed" ? "operation:error" : "operation:finish", { operation });
        return operation;
      }

      return Object.freeze({
        id,
        update: (patch = {}) => {
          if (closed) return publicOperationRecord(record);
          if (patch.detail !== undefined) record.detail = patch.detail;
          if (patch.label !== undefined) record.label = toCleanString(patch.label, record.label);
          if (patch.reason !== undefined) record.reason = toCleanString(patch.reason, record.reason);
          record.updatedAt = new Date().toISOString();
          const operation = publicOperationRecord(record);
          emit("operation:update", { operation });
          return operation;
        },
        finish: (detail) => close("finished", detail === undefined ? {} : { detail }),
        fail: (error, detail) => close("failed", {
          error: error instanceof Error ? { message: error.message, name: error.name } : error || null,
          ...(detail === undefined ? {} : { detail }),
        }),
        cancel: (detail) => close("cancelled", detail === undefined ? {} : { detail }),
        status: () => publicOperationRecord(record),
      });
    }

    return Object.freeze({
      start,
      get: (id) => {
        const record = state.operations.get(normalizeId(id, ""));
        return record ? publicOperationRecord(record) : null;
      },
      list: () => Array.from(state.operations.values()).map(publicOperationRecord),
    });
  }

  // src/al-dente-factory/routes.js
  function pathnameOf(input) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      return new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return "";
    }
  }
  function createRoutesSurface() {
    function isGenerateUrl(input) {
      return pathnameOf(input) === "/api/generate";
    }

    function isDryRunGenerateUrl(input) {
      return pathnameOf(input) === "/api/generate/dryRun";
    }

    function isRawGenerateUrl(input) {
      return pathnameOf(input) === "/api/generate/raw";
    }

    function parseCreateMessageUrl(input) {
      const match = pathnameOf(input).match(/^\/api\/chats\/([^/]+)\/messages$/);
      return match ? decodeURIComponent(match[1]) : "";
    }

    function classify(input) {
      if (isGenerateUrl(input)) return { kind: "generate", route: "generate", pathname: pathnameOf(input) };
      if (isDryRunGenerateUrl(input)) return { kind: "generate", route: "generate:dry-run", pathname: pathnameOf(input) };
      if (isRawGenerateUrl(input)) return { kind: "generate", route: "generate:raw", pathname: pathnameOf(input) };
      const createMessageChatId = parseCreateMessageUrl(input);
      if (createMessageChatId) return { kind: "message:create", route: "message:create", chatId: createMessageChatId, pathname: pathnameOf(input) };
      return { kind: "other", route: "other", pathname: pathnameOf(input) };
    }

    return Object.freeze({
      pathnameOf,
      isGenerateUrl,
      isDryRunGenerateUrl,
      isRawGenerateUrl,
      parseCreateMessageUrl,
      classify,
    });
  }

  // src/al-dente-factory/services.js
  function publicServiceRecord(record) {
    return {
      id: record.id,
      version: record.version,
      owner: record.owner,
      registeredAt: record.registeredAt,
      updatedAt: record.updatedAt,
      capabilities: [...record.capabilities],
    };
  }
  function createServiceRegistry(state) {
    function register(id, service, options = {}) {
      const serviceId = normalizeId(id, "");
      if (!serviceId) throw new Error("alDenteFactory.services.register requires an id.");
      if (service == null) throw new Error(`alDenteFactory service "${serviceId}" cannot be null.`);

      const now = new Date().toISOString();
      const existing = state.services.get(serviceId);
      const record = {
        id: serviceId,
        service,
        owner: toCleanString(options.owner, existing?.owner || ""),
        version: toCleanString(options.version, existing?.version || ""),
        capabilities: new Set(Array.isArray(options.capabilities) ? options.capabilities.map(String) : existing?.capabilities || []),
        registeredAt: existing?.registeredAt || now,
        updatedAt: now,
      };

      state.services.set(serviceId, record);
      emit("service-registered", { service: publicServiceRecord(record) });

      return Object.freeze({
        id: serviceId,
        unregister: () => unregister(serviceId, service),
        update: (nextService, nextOptions = {}) => register(serviceId, nextService, { ...options, ...nextOptions }),
      });
    }

    function unregister(id, expectedService) {
      const serviceId = normalizeId(id, "");
      const record = state.services.get(serviceId);
      if (!record) return false;
      if (expectedService !== undefined && record.service !== expectedService) return false;
      state.services.delete(serviceId);
      emit("service-unregistered", { id: serviceId });
      return true;
    }

    function get(id) {
      return state.services.get(normalizeId(id, ""))?.service || null;
    }

    function getRecord(id) {
      const record = state.services.get(normalizeId(id, ""));
      return record ? publicServiceRecord(record) : null;
    }

    return Object.freeze({
      register,
      unregister,
      get,
      getRecord,
      has: (id) => state.services.has(normalizeId(id, "")),
      list: () => Array.from(state.services.values()).map(publicServiceRecord),
    });
  }

  // src/al-dente-factory/sse.js
  function parseSsePayloads(text, final = false) {
    const parts = String(text || "").split(/\n\n/);
    const rest = final ? "" : parts.pop() || "";
    return {
      rest,
      payloads: parts
        .map((frame) =>
          frame
            .split(/\r?\n/)
            .map((line) => (line.startsWith("data:") ? line.slice(5).trimStart() : ""))
            .filter(Boolean)
            .join("\n"),
        )
        .filter(Boolean),
    };
  }
  function parseSseEventPayload(payload) {
    if (!payload) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  function isSseResponse(response) {
    return Boolean(response?.body && String(response.headers?.get?.("content-type") || "").includes("text/event-stream"));
  }
  function wrapSseResponse(response, handlers = {}) {
    if (!isSseResponse(response)) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let cleaned = false;

    const cleanupOnce = (type, value) => {
      if (cleaned) return;
      cleaned = true;
      handlers.onDone?.(type, value);
    };

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            const parsed = parseSsePayloads(buffer, true);
            for (const payload of parsed.payloads) handlers.onPayload?.(payload, parseSseEventPayload(payload));
            cleanupOnce("done");
            controller.close();
            return;
          }
          const text = decoder.decode(value, { stream: true });
          buffer += text;
          const parsed = parseSsePayloads(buffer);
          buffer = parsed.rest;
          for (const payload of parsed.payloads) handlers.onPayload?.(payload, parseSseEventPayload(payload));
          controller.enqueue(value);
        } catch (error) {
          cleanupOnce("error", error);
          handlers.onError?.(error);
          controller.error(error);
        }
      },
      cancel(reason) {
        cleanupOnce("cancel", reason);
        handlers.onCancel?.(reason);
        return reader.cancel(reason);
      },
    });

    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  function createSseSurface() {
    return Object.freeze({
      parsePayloads: parseSsePayloads,
      parseEventPayload: parseSseEventPayload,
      isSseResponse,
      wrapResponse: wrapSseResponse,
    });
  }

  // src/al-dente-factory/version.js
  function parseVersion(value) {
    const parts = String(value || "")
      .split(".")
      .map((part) => Number.parseInt(part, 10));
    return {
      major: Number.isFinite(parts[0]) ? parts[0] : 0,
      minor: Number.isFinite(parts[1]) ? parts[1] : 0,
      patch: Number.isFinite(parts[2]) ? parts[2] : 0,
      raw: String(value || ""),
    };
  }
  function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (const key of ["major", "minor", "patch"]) {
      if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
    }
    return 0;
  }

  // src/al-dente-factory/wake-lock.js
  function wakeLockSupported() {
    return Boolean(navigator.wakeLock && typeof navigator.wakeLock.request === "function");
  }

  function setWakeStatus(status, error = "") {
    const root = document.documentElement;
    if (!root) return;

    if (status) root.dataset.alDenteWakeLock = status;
    else delete root.dataset.alDenteWakeLock;

    if (error) root.dataset.alDenteWakeLockError = String(error).slice(0, 160);
    else delete root.dataset.alDenteWakeLockError;

    // Legacy status hooks kept for the first PWA Helper build.
    if (status) root.dataset.mariPwaHelperWakeLock = status;
    else delete root.dataset.mariPwaHelperWakeLock;

    if (error) root.dataset.mariPwaHelperWakeLockError = String(error).slice(0, 160);
    else delete root.dataset.mariPwaHelperWakeLockError;
  }

  function removeWakeListeners(state) {
    const cleanups = Array.isArray(state.wakeListenerCleanups) ? state.wakeListenerCleanups.splice(0) : [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {}
    }
    state.wakeListenersInstalled = false;
  }
  function createWakeLockController(state) {
    if (state.wakeListenersInstalled) removeWakeListeners(state);

    function wakeStatus() {
      const activeLeases = Array.from(state.wakeLeases.values()).map((lease) => ({
        id: lease.id,
        source: lease.source,
        reason: lease.reason,
        createdAt: lease.createdAt,
        updatedAt: lease.updatedAt,
      }));

      return {
        active: activeLeases.length > 0,
        supported: wakeLockSupported(),
        held: Boolean(state.wakeLock),
        status: document.documentElement?.dataset?.alDenteWakeLock || "",
        error: state.lastWakeLockError,
        activeLeases,
      };
    }

    async function releaseWakeLockIfIdle() {
      if (state.wakeLeases.size > 0) return;
      const lock = state.wakeLock;
      state.wakeLock = null;
      state.lastWakeLockError = "";
      setWakeStatus("", "");
      if (!lock) return;
      try {
        await lock.release();
      } catch {
        // Browsers can revoke wake locks independently on visibility changes.
      }
    }

    async function syncWakeLock() {
      if (state.wakeLeases.size <= 0) {
        await releaseWakeLockIfIdle();
        return;
      }

      if (state.wakeLock) {
        setWakeStatus("active", "");
        return;
      }

      if (document.visibilityState !== "visible") {
        setWakeStatus("pending-visible", "");
        return;
      }

      if (!wakeLockSupported()) {
        state.lastWakeLockError = "Screen Wake Lock API is unavailable.";
        setWakeStatus("unsupported", state.lastWakeLockError);
        return;
      }

      const now = Date.now();
      if (state.lastWakeLockRequestFailedAt && now - state.lastWakeLockRequestFailedAt < REQUEST_BACKOFF_MS) return;

      try {
        const lock = await navigator.wakeLock.request("screen");
        state.wakeLock = lock;
        state.lastWakeLockError = "";
        setWakeStatus("active", "");
        lock.addEventListener("release", () => {
          if (state.wakeLock === lock) state.wakeLock = null;
          if (state.wakeLeases.size > 0) void syncWakeLock();
          else setWakeStatus("", "");
        }, { once: true });
        emit("wake-lock:changed", wakeStatus());
      } catch (error) {
        state.lastWakeLockRequestFailedAt = Date.now();
        state.lastWakeLockError = error?.message || "Wake lock request failed.";
        setWakeStatus("error", state.lastWakeLockError);
        emit("wake-lock:changed", wakeStatus());
      }
    }

    function holdWakeLock(options = {}) {
      const source = toCleanString(options.source, "unknown");
      const reason = toCleanString(options.reason, "");
      const requestedId = normalizeId(options.id, "");
      const id = requestedId || `${normalizeId(source, "source")}:${++state.wakeLeaseSeq}`;
      const now = new Date().toISOString();
      const existingLease = state.wakeLeases.get(id);
      const leaseRecord = {
        id,
        source,
        reason,
        createdAt: existingLease?.createdAt || now,
        updatedAt: now,
      };

      state.wakeLeases.set(id, leaseRecord);
      void syncWakeLock();
      emit("wake-lock:changed", wakeStatus());

      let released = false;
      return Object.freeze({
        id,
        release: () => {
          if (released) return false;
          released = true;
          return releaseWakeLock(id);
        },
      });
    }

    function releaseWakeLock(id) {
      const leaseId = normalizeId(id, "");
      if (!leaseId || !state.wakeLeases.has(leaseId)) return false;
      state.wakeLeases.delete(leaseId);
      void syncWakeLock();
      emit("wake-lock:changed", wakeStatus());
      return true;
    }

    function onWakeHoldEvent(event) {
      const detail = event?.detail || {};
      const id = normalizeId(detail.id, "");
      if (!id) return;
      holdWakeLock({ ...detail, id });
    }

    function onWakeReleaseEvent(event) {
      releaseWakeLock(event?.detail?.id);
    }

    function installWakeListeners() {
      if (state.wakeListenersInstalled) return;
      const visibilityHandler = () => void syncWakeLock();
      const pageshowHandler = () => void syncWakeLock();
      const focusHandler = () => void syncWakeLock();

      document.addEventListener("visibilitychange", visibilityHandler);
      window.addEventListener("pageshow", pageshowHandler);
      window.addEventListener("focus", focusHandler);
      window.addEventListener(WAKE_HOLD_EVENT, onWakeHoldEvent);
      window.addEventListener(WAKE_RELEASE_EVENT, onWakeReleaseEvent);
      state.wakeListenerCleanups.push(() => document.removeEventListener("visibilitychange", visibilityHandler));
      state.wakeListenerCleanups.push(() => window.removeEventListener("pageshow", pageshowHandler));
      state.wakeListenerCleanups.push(() => window.removeEventListener("focus", focusHandler));
      state.wakeListenerCleanups.push(() => window.removeEventListener(WAKE_HOLD_EVENT, onWakeHoldEvent));
      state.wakeListenerCleanups.push(() => window.removeEventListener(WAKE_RELEASE_EVENT, onWakeReleaseEvent));
      state.wakeListenersInstalled = true;
    }

    installWakeListeners();
    void syncWakeLock();

    return Object.freeze({
      hold: holdWakeLock,
      release: releaseWakeLock,
      activeLeases: () => wakeStatus().activeLeases,
      status: wakeStatus,
    });
  }

  // src/al-dente-factory/index.js
  function createRuntimeState(existingRuntime) {
    const state = existingRuntime?.state && typeof existingRuntime.state === "object" ? existingRuntime.state : {};
    state.createdAt ||= new Date().toISOString();
    state.extensions ||= new Map();
    state.services ||= new Map();
    state.operations ||= new Map();
    state.operationSeq = Number(state.operationSeq || 0);
    state.generationRuns ||= new Map();
    state.generationSeq = Number(state.generationSeq || 0);
    state.fetchInterceptors ||= new Map();
    state.fetchInstalled = state.fetchInstalled === true;
    state.fetchHandler ||= null;
    state.originalFetch ||= null;
    state.commands ||= new Map();
    state.commandsInstalled = state.commandsInstalled === true;
    if (!Array.isArray(state.commandCleanups)) state.commandCleanups = [];
    state.caches ||= {
      chats: new Map(),
      messages: new Map(),
      characters: new Map(),
      personas: new Map(),
    };
    state.caches.chats ||= new Map();
    state.caches.messages ||= new Map();
    state.caches.characters ||= new Map();
    state.caches.personas ||= new Map();
    state.wakeLock ||= null;
    state.wakeLeases ||= new Map();
    state.wakeLeaseSeq = Number(state.wakeLeaseSeq || 0);
    state.wakeListenersInstalled = state.wakeListenersInstalled === true;
    if (!Array.isArray(state.wakeListenerCleanups)) state.wakeListenerCleanups = [];
    state.lastWakeLockError ||= "";
    state.lastWakeLockRequestFailedAt = Number(state.lastWakeLockRequestFailedAt || 0);
    return state;
  }

  function installAlDenteFactory() {
    const existing = window[FACTORY_KEY];
    const existingRuntime = existing?.__alDenteRuntime;
    const existingVersion = existingRuntime?.version || "";
    const existingMajor = Number(existingRuntime?.majorVersion ?? parseVersion(existingVersion).major);

    if (existingRuntime && existingMajor !== MAJOR_VERSION) {
      notifyFactoryIssue("incompatible-major-version", {
        existingVersion,
        packagedVersion: VERSION,
        message: "Disable older Al Dente extensions and update them to matching factory major versions.",
      });
      window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { factory: existing, incompatible: true } }));
      return;
    }

    if (existingRuntime && compareVersions(existingVersion, VERSION) >= 0) {
      window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { factory: existing } }));
      return;
    }

    const state = createRuntimeState(existingRuntime);
    if (existingRuntime && compareVersions(existingVersion, VERSION) < 0) {
      notifyFactoryIssue("upgraded-compatible-runtime", {
        existingVersion,
        packagedVersion: VERSION,
        message: "A newer compatible alDenteFactory runtime replaced the older shared surface.",
      });
    }

    const events = createEventBus();
    const extensionRegistry = createExtensionRegistry(state);
    const services = createServiceRegistry(state);
    const wakeLock = createWakeLockController(state);
    const operations = createOperationTracker(state, wakeLock);
    const parsers = createParsersSurface();
    const api = createApiClient(state);
    const identity = createIdentityService(state, api, parsers);
    const routes = createRoutesSurface();
    const fetch = createFetchHub(state, routes);
    const commands = createCommandSurface(state);
    const sse = createSseSurface();
    const messages = createMessageTracker(state);
    const generation = createGenerationTracker(state, sse, messages);
    const marinara = Object.freeze({
      api,
      commands,
      fetch,
      generation,
      identity,
      messages,
      parsers,
      routes,
      sse,
    });

    const factory = Object.freeze({
      version: VERSION,
      events,
      registerExtension: extensionRegistry.registerExtension,
      listExtensions: extensionRegistry.listExtensions,
      getExtension: extensionRegistry.getExtension,
      openOptions: extensionRegistry.openOptions,
      extensions: Object.freeze(extensionRegistry),
      services,
      operations,
      wakeLock,
      marinara,
      __alDenteRuntime: Object.freeze({
        version: VERSION,
        majorVersion: MAJOR_VERSION,
        createdAt: state.createdAt,
        state,
      }),
    });

    window[FACTORY_KEY] = factory;
    window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { factory } }));
  }

  installAlDenteFactory();
})();


(() => {
  const ROOT_CLASS = "mari-si-root";
  const BUTTON_CLASS = "mari-si-button";
  const MENU_CLASS = "mari-si-menu";
  const QUICK_REPLY_HIDDEN_CLASS = "mari-si-quick-replies-hidden";
  const MOBILE_ROOT_HIDDEN_CLASS = "mari-si-mobile-root-hidden";
  const PICKER_ACTIONS_CLASS = "mari-si-picker-actions";
  const PICKER_ACTION_CLASS = "mari-si-picker-action";
  const MOBILE_MEDIA_QUERY = "(max-width: 639.98px)";
  const HOLD_MS = 450;
  const STORAGE_PREFIX = "mari-si-guidance:";

  let rootEl = null;
  let mainButton = null;
  let menuEl = null;
  let activeRun = null;
  let holdTimer = null;
  let suppressNextClick = false;
  let menuDocPointerHandler = null;
  let menuDocKeyHandler = null;
  let mountRetryTimer = null;
  let mountAttempts = 0;
  let mountObserver = null;
  let observedMountHost = null;
  let stateObservers = [];
  let observedStateTargetsKey = "";
  let observedTextareaTarget = null;
  let observedSendButtonTarget = null;
  let hijackedSendButton = null;
  let extensionRegistration = null;
  let mobileMedia = null;
  let mobileSyncTimer = null;
  let hiddenQuickReplyShell = null;
  let pickerActionsEl = null;
  const listenedSendButtons = new WeakSet();

  const userCheckSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <polyline points="16 11 18 13 22 9"></polyline>
    </svg>
  `;

  const continueSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12h11"></path>
      <path d="m12 8 4 4-4 4"></path>
      <path d="M19 5v14"></path>
    </svg>
  `;

  const restoreSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7"></path>
      <path d="M3 4v6h6"></path>
    </svg>
  `;

  const innerStateSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 5a3 3 0 0 0-5.1-2.1A3 3 0 0 0 4 6a3 3 0 0 0 .8 2A3 3 0 0 0 4 14a3 3 0 0 0 2.9 3.1A3 3 0 0 0 12 19"></path>
      <path d="M12 5a3 3 0 0 1 5.1-2.1A3 3 0 0 1 20 6a3 3 0 0 1-.8 2A3 3 0 0 1 20 14a3 3 0 0 1-2.9 3.1A3 3 0 0 1 12 19"></path>
      <path d="M12 5v14"></path>
    </svg>
  `;

  const postOnlySvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
      <path d="M8 13h8"></path>
      <path d="M8 17h5"></path>
    </svg>
  `;

  const guidedSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m15 4 5 5"></path>
      <path d="M14.5 9.5 4 20"></path>
      <path d="M19 13v6"></path>
      <path d="M22 16h-6"></path>
      <path d="M5 3v4"></path>
      <path d="M7 5H3"></path>
    </svg>
  `;

  function on(target, type, handler, options) {
    if (options == null && marinara.on) {
      marinara.on(target, type, handler);
      return;
    }
    target.addEventListener(type, handler, options);
    marinara.onCleanup(() => target.removeEventListener(type, handler, options));
  }

  function alDente() {
    return window.alDenteFactory || null;
  }

  function factoryApi() {
    return alDente()?.marinara?.api || null;
  }

  function factoryIdentity() {
    return alDente()?.marinara?.identity || null;
  }

  function factoryParsers() {
    return alDente()?.marinara?.parsers || null;
  }

  function factorySse() {
    return alDente()?.marinara?.sse || null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findChatRoot() {
    return Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input"))
      .find(isVisible) || null;
  }

  function findTextarea(root) {
    return root?.querySelector("textarea.mari-chat-input-textarea, textarea") || null;
  }

  function findSendButton(root) {
    return root?.querySelector("button.mari-chat-send-btn, button[title='Send']") || null;
  }

  function isMobileViewport() {
    if (!mobileMedia && typeof window.matchMedia === "function") {
      mobileMedia = window.matchMedia(MOBILE_MEDIA_QUERY);
    }
    return !!mobileMedia?.matches;
  }

  function findTriggerResponseButton(root) {
    return Array.from(root?.querySelectorAll("button[title^='Trigger character response']") || [])
      .find(isVisible) || null;
  }

  function findQuickReplyControl(root) {
    const selector = [
      "button[aria-label='Quick replies']",
      "button[title='Quick replies']",
      "button[aria-label^='Post only:']",
      "button[title^='Post only:']",
      "button[aria-label^='Guide reply:']",
      "button[title^='Guide reply:']",
      "button[aria-label^='Impersonate:']",
      "button[title^='Impersonate:']",
    ].join(",");
    return Array.from(root?.querySelectorAll(selector) || [])
      .find((button) => !button.closest(`.${ROOT_CLASS}`)) || null;
  }

  function findQuickReplyShell(button) {
    if (!button) return null;
    const label = button.getAttribute("aria-label") || "";
    const title = button.getAttribute("title") || "";
    if (label === "Quick replies" || title === "Quick replies") return button.parentElement || button;
    return button;
  }

  function clearHiddenQuickReplies() {
    if (hiddenQuickReplyShell) {
      hiddenQuickReplyShell.classList.remove(QUICK_REPLY_HIDDEN_CLASS);
      hiddenQuickReplyShell = null;
    }
  }

  function setQuickRepliesHidden(root, hidden) {
    if (!hidden) {
      clearHiddenQuickReplies();
      return;
    }

    const shell = findQuickReplyShell(findQuickReplyControl(root));
    if (hiddenQuickReplyShell && hiddenQuickReplyShell !== shell) clearHiddenQuickReplies();
    hiddenQuickReplyShell = shell;
    if (hiddenQuickReplyShell) hiddenQuickReplyShell.classList.add(QUICK_REPLY_HIDDEN_CLASS);
  }

  function findQuickReplyActionButton(label) {
    const prefix = `${label}:`;
    return Array.from(document.querySelectorAll("button[aria-label], button[title]")).find((button) => {
      if (button.closest(`.${ROOT_CLASS}`) || button.closest(`.${PICKER_ACTIONS_CLASS}`)) return false;
      const aria = button.getAttribute("aria-label") || "";
      const title = button.getAttribute("title") || "";
      return aria.startsWith(prefix) || title.startsWith(prefix);
    }) || null;
  }

  function findQuickReplyTrigger(root) {
    return root?.querySelector("button[aria-label='Quick replies'], button[title='Quick replies']") || null;
  }

  function waitForQuickReplyRender() {
    return new Promise((resolve) => {
      marinara.setTimeout(resolve, 70);
    });
  }

  async function invokeQuickReplyAction(label) {
    const root = findChatRoot();
    const trigger = findQuickReplyTrigger(root);
    let action = findQuickReplyActionButton(label);

    if (!action && trigger && !trigger.disabled) {
      trigger.click();
      await waitForQuickReplyRender();
      action = findQuickReplyActionButton(label);
    }

    if (!action) {
      toast(`${label} is not available here.`, false);
      return;
    }
    if (action.disabled || action.getAttribute("aria-disabled") === "true") {
      toast(action.getAttribute("title") || `${label} is disabled.`, false);
      return;
    }

    action.click();
  }

  function runPostOnly() {
    void invokeQuickReplyAction("Post only");
  }

  function runGuidedGeneration() {
    void invokeQuickReplyAction("Guide reply");
  }

  function findTriggerPickerMenu() {
    const candidates = Array.from(document.querySelectorAll("div.fixed"));
    return candidates.find((el) => {
      if (!isVisible(el) || el.classList.contains(PICKER_ACTIONS_CLASS)) return false;
      const header = Array.from(el.children).find((child) => child.textContent?.trim() === "Trigger Response");
      return !!header && !!el.querySelector("button");
    }) || null;
  }

  function getChatId() {
    const factoryChatId = factoryIdentity()?.readActiveChatId?.();
    if (factoryChatId) return factoryChatId;
    const fromStore = localStorage.getItem("marinara-active-chat-id");
    if (fromStore) return fromStore;
    const selected = document.querySelector('[data-chat-id][class*="sidebar-accent"], [data-chat-id][aria-current="true"]');
    return selected ? selected.getAttribute("data-chat-id") : null;
  }

  function setTextareaValue(textarea, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setAttr(el, name, value) {
    if (value == null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function toast(message, ok) {
    const t = document.createElement("div");
    t.textContent = message;
    t.className = ok ? "mari-si-toast mari-si-toast-ok" : "mari-si-toast";
    document.body.appendChild(t);
    marinara.setTimeout(() => {
      t.classList.add("mari-si-toast-out");
      marinara.setTimeout(() => t.remove(), 220);
    }, 2600);
  }

  function savedGuidanceKey(chatId) {
    return STORAGE_PREFIX + chatId;
  }

  function saveGuidance(chatId, text) {
    const value = String(text || "").trim();
    if (!chatId || !value) return;
    try { localStorage.setItem(savedGuidanceKey(chatId), text); } catch {}
  }

  function loadGuidance(chatId) {
    if (!chatId) return "";
    try { return localStorage.getItem(savedGuidanceKey(chatId)) || ""; } catch { return ""; }
  }

  async function readChat(chatId) {
    if (!chatId) return null;
    const api = factoryApi();
    try {
      if (api?.get) return await api.get(`/chats/${encodeURIComponent(chatId)}`);
    } catch {}
    if (marinara.apiFetch) {
      try {
        return await marinara.apiFetch(`/chats/${encodeURIComponent(chatId)}`);
      } catch {}
    }
    return null;
  }

  async function readPersonaName(chatId) {
    const identity = factoryIdentity();
    if (identity?.getActivePersona) {
      try {
        const persona = await identity.getActivePersona(chatId);
        if (typeof persona?.name === "string" && persona.name.trim()) return persona.name.trim();
      } catch {}
    }

    const chat = await readChat(chatId);
    const personaId = typeof chat?.personaId === "string" && chat.personaId.trim() ? chat.personaId.trim() : "";
    if (personaId && marinara.apiFetch) {
      try {
        const persona = await marinara.apiFetch(`/characters/personas/${encodeURIComponent(personaId)}`);
        if (typeof persona?.name === "string" && persona.name.trim()) return persona.name.trim();
      } catch {}
    }

    if (marinara.apiFetch) {
      try {
        const persona = await marinara.apiFetch("/characters/personas/active");
        if (typeof persona?.name === "string" && persona.name.trim()) return persona.name.trim();
      } catch {}
    }

    return "";
  }

  function stripTemplateUserPrefix(value) {
    return String(value || "").trim().replace(/^\{\{user\}\}\s*:\s*/i, "").trim();
  }

  function escapeRegExp(value) {
    const specials = new Set(["\\", "^", "$", ".", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}"]);
    return Array.from(String(value), (ch) => specials.has(ch) ? "\\" + ch : ch).join("");
  }

  function stripImpersonateSpeakerPrefix(text, personaName) {
    let next = String(text || "");
    const cleanedPersonaName = stripTemplateUserPrefix(personaName);
    const labels = ["{{user}}", cleanedPersonaName].filter(Boolean);

    for (let pass = 0; pass < 2; pass += 1) {
      const before = next;
      for (const label of labels) {
        const pattern = new RegExp("^\\s*" + escapeRegExp(label) + "\\s*:\\s*", "i");
        next = next.replace(pattern, "");
      }
      if (next === before) break;
    }

    return next;
  }
  function readImpersonateSettings() {
    const fallback = {
      impersonatePromptTemplate: "",
      impersonatePresetId: null,
      impersonateConnectionId: null,
      impersonateBlockAgents: false,
    };

    try {
      const raw = localStorage.getItem("marinara-engine-ui");
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      const state = parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object"
        ? parsed.state
        : parsed;

      return {
        impersonatePromptTemplate: typeof state.impersonatePromptTemplate === "string" ? state.impersonatePromptTemplate : "",
        impersonatePresetId: typeof state.impersonatePresetId === "string" && state.impersonatePresetId.trim() ? state.impersonatePresetId.trim() : null,
        impersonateConnectionId: typeof state.impersonateConnectionId === "string" && state.impersonateConnectionId.trim() ? state.impersonateConnectionId.trim() : null,
        impersonateBlockAgents: state.impersonateBlockAgents === true,
      };
    } catch {
      return fallback;
    }
  }

  const TRIM_ONLY_PROMPT_RE = /^\{\{\s*trim\s*\}\}$/i;

  function normalizeImpersonatePromptTemplate(value) {
    const template = String(value || "").trim();
    return {
      template,
      trimOnly: TRIM_ONLY_PROMPT_RE.test(template),
    };
  }

  function buildModeGenerationGuide(mode, originalInput) {
    const input = String(originalInput || "").trim();
    if (!input) return "";
    if (mode === "inner_state") {
      return [
        "Private inner state for {{user}}:",
        input,
        "",
        "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
        "Let this ground the response in {{user}}'s feelings rather than force an outcome."
      ].join("\n");
    }
    if (mode !== "continue") {
      return [
        "Guidance for {{user}}'s next in-character response:",
        input,
        "",
        "Use this as a suggestion for the generated response, not as dialogue or chat history.",
        "Do not quote or rush to fulfill the suggestion; let it guide you naturally."
      ].join("\n");
    }
    return [
      "Continue the current in-character draft.",
      "The draft so far is:",
      input,
      "",
      "Treat the draft as text to continue, not as dialogue or chat history to answer.",
      "Return only the continuation text.",
      "Do not restart the draft.",
      "Do not repeat any part of the draft.",
      "Do not explain."
    ].join("\n");
  }

  function buildInnerStateTemplate(baseTemplate) {
    const base = String(baseTemplate || "").trim();
    const innerStateBlock = [
      "Private inner state for {{user}}:",
      "{{impersonate_direction}}",
      "",
      "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
      "Let this ground the response in {{user}}'s feelings rather than force an outcome."
    ].join("\n");
    return base ? `${base}\n\n${innerStateBlock}` : innerStateBlock;
  }

  async function readChatImpersonatePrompt(chatId) {
    const chat = await readChat(chatId);
    if (!chat) return "";
    try {
      const metadata = readChatMetadata(chat);
      return typeof metadata.impersonatePrompt === "string" ? metadata.impersonatePrompt.trim() : "";
    } catch {
      return "";
    }
  }

  function parseJsonArray(value) {
    const parsedByFactory = factoryParsers()?.maybeJson?.(value, null);
    if (Array.isArray(parsedByFactory)) return parsedByFactory;
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function readChatMetadata(chat) {
    const metadata = factoryParsers()?.chatMetadata?.(chat);
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) return metadata;
    try {
      return typeof chat?.metadata === "string" ? JSON.parse(chat.metadata || "{}") : (chat?.metadata || {});
    } catch {
      return {};
    }
  }

  function readScopedRegexMode(chat) {
    const mode = readChatMetadata(chat).scopedRegexMode;
    return mode === "exclusive" || mode === "chat" ? mode : "disabled";
  }

  function readChatCharacterIds(chat) {
    const ids = factoryParsers()?.getCharacterIds?.(chat);
    if (Array.isArray(ids)) return ids.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim());
    return parseJsonArray(chat?.characterIds).filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim());
  }

  async function readPrimaryCharacterName(chat) {
    const characterId = readChatCharacterIds(chat)[0];
    if (!characterId) return "";
    const identity = factoryIdentity();
    if (identity?.getCharacter) {
      try {
        const character = await identity.getCharacter(characterId);
        if (typeof character?.name === "string" && character.name.trim()) return character.name.trim();
      } catch {}
    }
    if (!marinara.apiFetch) return "";
    try {
      const character = await marinara.apiFetch(`/characters/${encodeURIComponent(characterId)}`);
      const data = typeof character?.data === "string" ? JSON.parse(character.data || "{}") : character?.data;
      return typeof data?.name === "string" ? data.name.trim() : "";
    } catch {
      return "";
    }
  }

  async function readRegexScripts() {
    const api = factoryApi();
    try {
      if (api?.get) {
        const scripts = await api.get("/regex-scripts");
        return Array.isArray(scripts) ? scripts : [];
      }
    } catch {}
    if (!marinara.apiFetch) return [];
    try {
      const scripts = await marinara.apiFetch("/regex-scripts");
      return Array.isArray(scripts) ? scripts : [];
    } catch {
      return [];
    }
  }

  function isRegexEnabled(value) {
    return value === true || value === "true";
  }

  function readRegexApplyMode(script) {
    return script?.applyMode === "prompt" || script?.applyMode === "display" || script?.applyMode === "both"
      ? script.applyMode
      : script?.promptOnly === true || script?.promptOnly === "true"
        ? "prompt"
        : "display";
  }

  function readRegexStrings(value) {
    return parseJsonArray(value).filter((entry) => typeof entry === "string");
  }

  function readRegexPlacements(value) {
    return readRegexStrings(value).filter((entry) => entry === "ai_output" || entry === "user_input");
  }

  function resolveRegexMacros(value, regexContext) {
    return String(value || "")
      .replace(/\{\{\s*user\s*\}\}/gi, regexContext.personaName || "User")
      .replace(/\{\{\s*char\s*\}\}/gi, regexContext.characterName || "Character")
      .replace(/\{\{\s*noop\s*\}\}/gi, "")
      .replace(/\{\{\s*trim\s*\}\}/gi, "");
  }

  function resolveRegexPattern(value, regexContext) {
    return String(value || "").replace(/\{\{[\s\S]*?\}\}/g, (macro) => escapeRegExp(resolveRegexMacros(macro, regexContext)));
  }

  function expandRegexReplacement(replacement, matchArgs) {
    const match = String(matchArgs[0] ?? "");
    const maybeGroups = matchArgs[matchArgs.length - 1];
    const hasGroups = maybeGroups && typeof maybeGroups === "object";
    const input = String(matchArgs[matchArgs.length - (hasGroups ? 2 : 1)] ?? "");
    const offset = Number(matchArgs[matchArgs.length - (hasGroups ? 3 : 2)] ?? 0);
    const captures = matchArgs.slice(1, hasGroups ? -3 : -2).map((capture) => capture == null ? "" : String(capture));
    const groups = hasGroups ? maybeGroups : null;
    let result = "";
    let caseMode = "";
    let oneShot = "";

    const applyCase = (value) => {
      let next = caseMode === "upper" ? value.toUpperCase() : caseMode === "lower" ? value.toLowerCase() : value;
      if (oneShot && next) {
        next = oneShot === "upper" ? next.charAt(0).toUpperCase() + next.slice(1) : next.charAt(0).toLowerCase() + next.slice(1);
        oneShot = "";
      }
      return next;
    };

    for (let i = 0; i < replacement.length; i += 1) {
      const ch = replacement[i];
      const next = replacement[i + 1];
      if (ch === "\\" && next && "ULEul".includes(next)) {
        if (next === "U") caseMode = "upper";
        else if (next === "L") caseMode = "lower";
        else if (next === "E") caseMode = "";
        else if (next === "u") oneShot = "upper";
        else if (next === "l") oneShot = "lower";
        i += 1;
        continue;
      }
      if (ch !== "$") {
        result += applyCase(ch || "");
        continue;
      }

      if (next === "$") {
        result += applyCase("$");
        i += 1;
      } else if (next === "&") {
        result += applyCase(match);
        i += 1;
      } else if (next === "`") {
        result += applyCase(input.slice(0, offset));
        i += 1;
      } else if (next === "'") {
        result += applyCase(input.slice(offset + match.length));
        i += 1;
      } else if (next === "<") {
        const close = replacement.indexOf(">", i + 2);
        if (close > i) {
          const name = replacement.slice(i + 2, close);
          result += applyCase(groups && Object.prototype.hasOwnProperty.call(groups, name) ? String(groups[name] ?? "") : "");
          i = close;
        } else {
          result += applyCase("$");
        }
      } else if (/\d/.test(next || "")) {
        const two = replacement.slice(i + 1, i + 3);
        if (/^\d{2}$/.test(two) && Number(two) >= 1 && Number(two) <= captures.length) {
          result += applyCase(captures[Number(two) - 1] || "");
          i += 2;
        } else {
          const index = Number(next);
          result += applyCase(index >= 1 && index <= captures.length ? captures[index - 1] || "" : "$" + next);
          i += 1;
        }
      } else {
        result += applyCase("$");
      }
    }

    return result;
  }

  function applyRegexReplacementCompat(text, regex, replacement) {
    return text.replace(regex, (...args) => expandRegexReplacement(replacement, args));
  }

  function applyActiveAiOutputRegex(text, regexContext) {
    if (!regexContext?.scripts?.length) return text;
    let result = String(text || "");
    for (const script of regexContext.scripts) {
      if (!isRegexEnabled(script.enabled)) continue;
      const applyMode = readRegexApplyMode(script);
      if (applyMode !== "display" && applyMode !== "both") continue;
      if (!readRegexPlacements(script.placement).includes("ai_output")) continue;

      const targetCharacterIds = readRegexStrings(script.targetCharacterIds);
      if (targetCharacterIds.length > 0) {
        if (regexContext.scopedRegexMode === "disabled") continue;
        if (regexContext.scopedRegexMode === "exclusive") continue;
      }

      if (typeof script.minDepth === "number" && 0 < script.minDepth) continue;
      if (typeof script.maxDepth === "number" && 0 > script.maxDepth) continue;

      try {
        const findRegex = resolveRegexPattern(script.findRegex, regexContext);
        if (!findRegex) continue;
        const regex = new RegExp(findRegex, typeof script.flags === "string" ? script.flags : "");
        const replacement = resolveRegexMacros(script.replaceString, regexContext);
        result = applyRegexReplacementCompat(result, regex, replacement);
        for (const trim of readRegexStrings(script.trimStrings)) {
          const resolvedTrim = resolveRegexMacros(trim, regexContext);
          if (resolvedTrim) result = result.split(resolvedTrim).join("");
        }
      } catch {
        // Invalid or unsupported regex rows are skipped, matching Marinara's display hook posture.
      }
    }
    return result;
  }

  function renderGeneratedText(text, personaName, regexContext) {
    return stripImpersonateSpeakerPrefix(applyActiveAiOutputRegex(text, regexContext), personaName);
  }

  async function readRegexContext(chat, personaName) {
    const [scripts, characterName] = await Promise.all([
      readRegexScripts(),
      readPrimaryCharacterName(chat),
    ]);
    return {
      scripts,
      personaName,
      characterName,
      scopedRegexMode: readScopedRegexMode(chat),
    };
  }

  function getDisabledReason(root, textarea) {
    if (!root || !textarea) return "Select or create a chat first.";
    if (textarea.disabled && !activeRun) return "Wait for the current generation to finish.";
    return "";
  }

  function updateMainButtonIdleState() {
    if (!mainButton || activeRun) return;
    const root = findChatRoot();
    const textarea = findTextarea(root);
    const reason = getDisabledReason(root, textarea);
    const mobileTitle = isMobileViewport() ? "Impersonate actions" : "Impersonate. Hold or right-click for more.";
    mainButton.disabled = Boolean(reason);
    mainButton.title = reason || mobileTitle;
    mainButton.setAttribute("aria-label", reason || "Impersonate");
    mainButton.innerHTML = userCheckSvg;
  }

  function syncMobileUi(root = findChatRoot()) {
    if (!rootEl) return;

    if (!isMobileViewport()) {
      rootEl.classList.remove(MOBILE_ROOT_HIDDEN_CLASS);
      setQuickRepliesHidden(root, false);
      closePickerActions();
      updateMainButtonIdleState();
      return;
    }

    const triggerVisible = !!findTriggerResponseButton(root);
    rootEl.classList.toggle(MOBILE_ROOT_HIDDEN_CLASS, triggerVisible);
    setQuickRepliesHidden(root, true);
    syncPickerActions(root);
    updateMainButtonIdleState();
  }

  function scheduleMobileUiSync() {
    if (mobileSyncTimer) return;
    mobileSyncTimer = marinara.setTimeout(() => {
      mobileSyncTimer = null;
      syncMobileUi();
    }, 80);
  }

  function setupMobileMediaListener() {
    if (!mobileMedia && typeof window.matchMedia === "function") {
      mobileMedia = window.matchMedia(MOBILE_MEDIA_QUERY);
    }
    if (!mobileMedia) return;
    on(mobileMedia, "change", scheduleMobileUiSync);
  }

  function detachSendButtonStop(run) {
    const sendButton = hijackedSendButton;
    hijackedSendButton = null;

    if (!sendButton || !run) return;
    sendButton.classList.remove("mari-si-native-stop");
    sendButton.disabled = run.originalSendDisabled ?? false;
    setAttr(sendButton, "aria-disabled", run.originalSendAriaDisabled);
    setAttr(sendButton, "title", run.originalSendTitle);
    setAttr(sendButton, "aria-label", run.originalSendAriaLabel);
  }

  function ensureSendButtonStopListener(sendButton) {
    if (!sendButton) return;
    if (listenedSendButtons.has(sendButton)) return;
    listenedSendButtons.add(sendButton);
    marinara.on(sendButton, "click", (event) => {
      if (!activeRun || hijackedSendButton !== sendButton) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      stopRun();
    });
  }

  function attachSendButtonStop(sendButton) {
    if (!sendButton) return;
    if (hijackedSendButton && hijackedSendButton !== sendButton) detachSendButtonStop(null);
    ensureSendButtonStopListener(sendButton);
    hijackedSendButton = sendButton;
  }

  function setSendButtonStopUi(sendButton) {
    if (!sendButton) return;
    attachSendButtonStop(sendButton);
    if (sendButton.disabled) sendButton.disabled = false;
    if (sendButton.hasAttribute("aria-disabled")) sendButton.removeAttribute("aria-disabled");
    if (sendButton.title !== "Stop generating") sendButton.title = "Stop generating";
    if (sendButton.getAttribute("aria-label") !== "Stop generating") {
      sendButton.setAttribute("aria-label", "Stop generating");
    }
    sendButton.classList.add("mari-si-native-stop");
  }

  function setRunUi(active, run) {
    const root = findChatRoot();
    const textarea = findTextarea(root);
    const sendButton = findSendButton(root);

    if (active) {
      if (textarea) textarea.disabled = true;
      if (sendButton) setSendButtonStopUi(sendButton);
      if (mainButton) {
        if (!mainButton.disabled) mainButton.disabled = true;
        if (mainButton.title !== "Impersonate generation is running.") {
          mainButton.title = "Impersonate generation is running.";
        }
        if (mainButton.getAttribute("aria-label") !== "Impersonate generation running") {
          mainButton.setAttribute("aria-label", "Impersonate generation running");
        }
        if (!mainButton.classList.contains("mari-si-active")) mainButton.innerHTML = userCheckSvg;
        mainButton.classList.add("mari-si-active");
      }
      closeMenu();
      return;
    }

    if (textarea) textarea.disabled = run?.originalTextareaDisabled ?? false;
    detachSendButtonStop(run);
    if (mainButton) {
      mainButton.disabled = false;
      mainButton.classList.remove("mari-si-active");
    }
    updateMainButtonIdleState();
  }

  function isCurrentRun(run) {
    return !!activeRun && !!run && activeRun.clientRunId === run.clientRunId;
  }

  function stopRun() {
    const run = activeRun;
    if (!run) return;

    activeRun = null;
    finishRunOperation(run, "cancelled");

    if (!run.hasStartedText && (run.mode === "impersonate" || run.mode === "inner_state")) {
      const root = findChatRoot();
      const textarea = findTextarea(root);
      if (textarea) setTextareaValue(textarea, run.originalInput);
    }

    setRunUi(false, run);

    try { run.abortController?.abort(); } catch {}

    if (run.serverRunId) {
      fetch("/api/generate/dryRun/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: run.chatId, runId: run.serverRunId }),
      }).catch(() => {});
    }
  }

  function startRunOperation(run) {
    const operations = alDente()?.operations;
    if (!operations?.start || !run) return null;
    try {
      return operations.start({
        id: `impersonate-button:dry-run:${run.clientRunId}`,
        source: "Impersonate Button",
        kind: "generation",
        label: run.mode === "continue"
          ? "Continue draft"
          : run.mode === "inner_state"
            ? "Inner State"
            : "Impersonate",
        reason: "dry-run-generation",
        detail: {
          chatId: run.chatId,
          mode: run.mode,
        },
        wakeLock: {
          id: `impersonate-button:dry-run:${run.clientRunId}`,
          source: "Impersonate Button",
          reason: "dry-run-generation",
        },
      });
    } catch {
      return null;
    }
  }

  function finishRunOperation(run, status, error) {
    const operation = run?.operation;
    if (!operation) return;
    run.operation = null;

    try {
      if (status === "failed") operation.fail?.(error);
      else if (status === "cancelled") operation.cancel?.();
      else operation.finish?.();
    } catch {}
  }

  function joiner(left, right) {
    if (!left || !right) return "";
    if (/[\s\"'([{]$/.test(left)) return "";
    if (/^[\s.,!?;:)\"'\]}]/.test(right)) return "";
    return " ";
  }

  function parseSseBlocks(raw, carry) {
    const sse = factorySse();
    if (sse?.parsePayloads) {
      const parsed = sse.parsePayloads(`${carry || ""}${raw || ""}`);
      return { blocks: parsed.payloads || [], carry: parsed.rest || "" };
    }
    const text = carry + raw;
    const parts = text.split(/\n\n/);
    return { blocks: parts.slice(0, -1), carry: parts[parts.length - 1] || "" };
  }

  function parseSseEvent(block) {
    const parsedByFactory = factorySse()?.parseEventPayload?.(block);
    if (parsedByFactory) return parsedByFactory;
    const dataLines = [];
    for (const line of block.split(/\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return null;
    const payload = dataLines.join("\n").trim();
    if (!payload) return null;
    try { return JSON.parse(payload); } catch { return null; }
  }

  async function streamDryRun(params, run, handlers) {
    const response = await fetch("/api/generate/dryRun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: run.abortController.signal,
    });

    if (!response.ok) {
      let text = "";
      try { text = await response.text(); } catch {}
      throw new Error(text || `Dry run failed (${response.status})`);
    }

    if (!response.body) throw new Error("Dry run returned no stream body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let carry = "";

    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!isCurrentRun(run)) return;

      const decoded = decoder.decode(next.value, { stream: true });
      const parsed = parseSseBlocks(decoded, carry);
      carry = parsed.carry;

      for (const block of parsed.blocks) {
        if (!isCurrentRun(run)) return;
        const event = parseSseEvent(block);
        if (!event || !event.type) continue;

        if (event.type === "dryrun_started") {
          handlers.onStart?.(event.data?.runId || "");
        } else if (event.type === "token") {
          handlers.onToken?.(String(event.data || ""));
        } else if (event.type === "result") {
          handlers.onResult?.(String(event.data?.content || ""));
        } else if (event.type === "content_replace") {
          handlers.onResult?.(String(event.data || ""));
        } else if (event.type === "text_rewrite") {
          if (event.data?.editedText) handlers.onResult?.(String(event.data.editedText));
        } else if (event.type === "aborted") {
          handlers.onAbort?.();
          return;
        } else if (event.type === "error") {
          throw new Error(String(event.data || "Dry run failed."));
        } else if (event.type === "done") {
          return;
        }
      }
    }
  }

  function buildContinueTemplate(baseTemplate) {
    const base = String(baseTemplate || "").trim();
    const continueBlock = [
      "Continue {{user}}'s current in-character draft.",
      "The draft so far is:",
      "{{impersonate_direction}}",
      "",
      "Return only the continuation text.",
      "Do not restart the draft.",
      "Do not repeat any part of the draft.",
      "Do not explain."
    ].join("\n");
    return base ? `${base}\n\n${continueBlock}` : continueBlock;
  }

  async function startDryRun(requestedMode) {
    if (activeRun) {
      stopRun();
      return;
    }

    const root = findChatRoot();
    const textarea = findTextarea(root);
    const sendButton = findSendButton(root);
    const chatId = getChatId();
    if (!root || !textarea || !sendButton || !chatId) {
      toast("No active chat detected.", false);
      return;
    }
    if (textarea.disabled) return;

    let mode = requestedMode === "continue" ? "continue" : requestedMode === "inner_state" ? "inner_state" : "impersonate";
    const originalInput = textarea.value || "";
    if (mode === "continue" && !originalInput.trim()) mode = "impersonate";

    if (mode === "impersonate" || mode === "inner_state") saveGuidance(chatId, originalInput);

    const run = {
      clientRunId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      serverRunId: null,
      abortController: new AbortController(),
      chatId,
      mode,
      originalInput,
      originalSendDisabled: sendButton.disabled,
      originalSendAriaDisabled: sendButton.getAttribute("aria-disabled"),
      originalSendTitle: sendButton.getAttribute("title"),
      originalSendAriaLabel: sendButton.getAttribute("aria-label"),
      originalTextareaDisabled: textarea.disabled,
      hasStartedText: false,
      operation: null,
    };
    activeRun = run;
    run.operation = startRunOperation(run);

    let buffer = "";
    let continuation = "";

    if (mode === "impersonate" || mode === "inner_state") {
      setTextareaValue(textarea, "Generating...");
    }
    setRunUi(true, run);

    const settings = readImpersonateSettings();
    const chat = await readChat(chatId);
    const personaName = await readPersonaName(chatId);
    const regexContext = await readRegexContext(chat, personaName);
    const renderContinuation = (value) => {
      const cleanedValue = renderGeneratedText(value, personaName, regexContext);
      setTextareaValue(textarea, originalInput + joiner(originalInput, cleanedValue) + cleanedValue);
    };
    const promptTemplate = normalizeImpersonatePromptTemplate(settings.impersonatePromptTemplate);
    const useRegularPresetDryRun = promptTemplate.trimOnly && !!settings.impersonatePresetId;
    const params = useRegularPresetDryRun
      ? {
        chatId,
        presetId: settings.impersonatePresetId,
        streaming: true,
      }
      : {
        chatId,
        userMessage: mode === "continue" || mode === "inner_state" ? originalInput.trim() : (originalInput.trim() || null),
        impersonate: true,
        streaming: true,
        impersonateBlockAgents: settings.impersonateBlockAgents,
      };

    if (useRegularPresetDryRun) {
      if (settings.impersonateConnectionId) params.connectionId = settings.impersonateConnectionId;
      const generationGuide = buildModeGenerationGuide(mode, originalInput);
      if (generationGuide) {
        params.generationGuide = generationGuide;
        params.generationGuideSource = "guide";
      }
    } else {
      if (settings.impersonatePresetId) params.impersonatePresetId = settings.impersonatePresetId;
      if (settings.impersonateConnectionId) params.impersonateConnectionId = settings.impersonateConnectionId;

      if (mode === "continue") {
        const baseTemplate = promptTemplate.template || await readChatImpersonatePrompt(chatId);
        params.impersonatePromptTemplate = buildContinueTemplate(baseTemplate);
      } else if (mode === "inner_state") {
        const baseTemplate = promptTemplate.trimOnly ? "" : promptTemplate.template || await readChatImpersonatePrompt(chatId);
        params.impersonatePromptTemplate = buildInnerStateTemplate(baseTemplate);
      } else if (promptTemplate.template) {
        params.impersonatePromptTemplate = promptTemplate.template;
      }
    }

    try {
      await streamDryRun(params, run, {
        onStart: (serverRunId) => {
          if (!isCurrentRun(run)) return;
          run.serverRunId = serverRunId || null;
        },
        onToken: (token) => {
          if (!isCurrentRun(run)) return;
          run.hasStartedText = true;
          if (mode === "continue") {
            continuation += token;
            renderContinuation(continuation);
          } else {
            buffer += token;
            setTextareaValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
          }
        },
        onResult: (content) => {
          if (!isCurrentRun(run)) return;
          run.hasStartedText = true;
          const cleaned = String(content || "").trimEnd();
          if (mode === "continue") {
            continuation = cleaned;
            renderContinuation(continuation);
          } else {
            buffer = cleaned;
            setTextareaValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
          }
        },
        onAbort: () => {
          // Server acknowledged abort. UI cleanup is local and immediate in stopRun/finally.
        },
      });
    } catch (error) {
      if (isCurrentRun(run)) {
        if (!run.hasStartedText && (mode === "impersonate" || mode === "inner_state")) setTextareaValue(textarea, originalInput);
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          finishRunOperation(run, "failed", error);
          toast(error?.message || "Silent impersonate failed.", false);
        }
      }
    } finally {
      if (isCurrentRun(run)) {
        finishRunOperation(run, "finished");
        activeRun = null;
        setRunUi(false, run);
      }
    }
  }

  function detachMenuDocumentListeners() {
    if (menuDocPointerHandler) {
      document.removeEventListener("pointerdown", menuDocPointerHandler, true);
      menuDocPointerHandler = null;
    }
    if (menuDocKeyHandler) {
      document.removeEventListener("keydown", menuDocKeyHandler, true);
      menuDocKeyHandler = null;
    }
  }

  function attachMenuDocumentListeners() {
    if (menuDocPointerHandler || menuDocKeyHandler) return;

    menuDocPointerHandler = (event) => {
      if (!rootEl || rootEl.contains(event.target)) return;
      closeMenu();
    };

    menuDocKeyHandler = (event) => {
      if (event.key === "Escape") closeMenu();
    };

    // Only listen globally while the menu is actually open.
    document.addEventListener("pointerdown", menuDocPointerHandler, true);
    document.addEventListener("keydown", menuDocKeyHandler, true);
  }

  function closeMenu() {
    if (menuEl) menuEl.classList.remove("mari-si-menu-open");
    detachMenuDocumentListeners();
  }

  function openMenu() {
    if (activeRun || !menuEl) return;
    menuEl.classList.add("mari-si-menu-open");
    attachMenuDocumentListeners();
  }

  function toggleMenu() {
    if (activeRun || !menuEl) return;
    if (menuEl.classList.contains("mari-si-menu-open")) closeMenu();
    else openMenu();
  }

  function extensionActions() {
    return [
      {
        id: "post-only",
        label: "Post only",
        title: "Add your message without a reply",
        icon: postOnlySvg,
        handler: runPostOnly,
        surfaces: ["mobile-main", "mobile-picker"],
      },
      {
        id: "guided",
        label: "Guided generation",
        title: "Send as guided direction",
        icon: guidedSvg,
        handler: runGuidedGeneration,
        surfaces: ["mobile-main"],
      },
      {
        id: "impersonate",
        label: "Impersonate",
        title: "Generate as your persona using this extension",
        icon: userCheckSvg,
        handler: () => startDryRun("impersonate"),
        surfaces: ["mobile-main", "mobile-picker"],
      },
      {
        id: "continue",
        label: "Continue draft",
        title: "Continue the current draft",
        icon: continueSvg,
        handler: () => startDryRun("continue"),
        surfaces: ["desktop-menu", "mobile-picker"],
      },
      {
        id: "inner-state",
        label: "Inner State",
        title: "Use the current text as private thoughts or feelings",
        icon: innerStateSvg,
        handler: () => startDryRun("inner_state"),
        surfaces: ["desktop-menu", "mobile-picker"],
      },
      {
        id: "restore-guidance",
        label: "Restore guidance",
        title: "Restore the last guidance text",
        icon: restoreSvg,
        handler: restoreGuidance,
        surfaces: ["desktop-menu", "mobile-picker"],
      },
    ];
  }

  function createMenuAction(label, title, icon, handler, extraClass) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = extraClass ? `mari-si-menu-action ${extraClass}` : "mari-si-menu-action";
    btn.title = `${label}: ${title}`;
    btn.setAttribute("aria-label", `${label}: ${title}`);
    btn.innerHTML = `<span>${icon}</span>`;
    on(btn, "pointerdown", (event) => event.preventDefault());
    on(btn, "dragstart", (event) => event.preventDefault());
    on(btn, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      handler();
    });
    return btn;
  }

  function createPickerAction(action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = PICKER_ACTION_CLASS;
    btn.title = `${action.label}: ${action.title}`;
    btn.setAttribute("aria-label", `${action.label}: ${action.title}`);
    btn.innerHTML = `<span>${action.icon}</span>`;
    on(btn, "pointerdown", (event) => event.preventDefault());
    on(btn, "dragstart", (event) => event.preventDefault());
    on(btn, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closePickerActions();
      action.handler();
    });
    return btn;
  }

  function ensurePickerActions() {
    if (pickerActionsEl) return pickerActionsEl;
    pickerActionsEl = document.createElement("div");
    pickerActionsEl.className = PICKER_ACTIONS_CLASS;
    pickerActionsEl.setAttribute("role", "menu");
    pickerActionsEl.setAttribute("aria-label", "Impersonate quick actions");
    for (const action of extensionActions().filter((item) => item.surfaces.includes("mobile-picker"))) {
      pickerActionsEl.appendChild(createPickerAction(action));
    }
    marinara.onCleanup(() => pickerActionsEl?.remove());
    return pickerActionsEl;
  }

  function closePickerActions() {
    if (pickerActionsEl) pickerActionsEl.remove();
  }

  function positionPickerActions(actionsEl, pickerMenu) {
    const rect = pickerMenu.getBoundingClientRect();
    actionsEl.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    actionsEl.style.top = `${Math.max(8, Math.round(rect.top - actionsEl.offsetHeight - 8))}px`;
  }

  function syncPickerActions(root) {
    if (!isMobileViewport() || !findTriggerResponseButton(root)) {
      closePickerActions();
      return;
    }

    const pickerMenu = findTriggerPickerMenu();
    if (!pickerMenu) {
      closePickerActions();
      return;
    }

    const actionsEl = ensurePickerActions();
    if (!actionsEl.parentElement) document.body.appendChild(actionsEl);
    positionPickerActions(actionsEl, pickerMenu);
  }

  function restoreGuidance() {
    const root = findChatRoot();
    const textarea = findTextarea(root);
    const chatId = getChatId();
    if (!textarea || !chatId) return;
    const saved = loadGuidance(chatId);
    if (!saved.trim()) {
      toast("No saved guidance for this chat.", false);
      return;
    }
    setTextareaValue(textarea, saved);
    textarea.focus();
  }

  function createRoot() {
    const root = document.createElement("span");
    root.className = ROOT_CLASS;
    on(root, "selectstart", (event) => event.preventDefault());
    on(root, "dragstart", (event) => event.preventDefault());

    menuEl = document.createElement("span");
    menuEl.className = MENU_CLASS;
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-label", "Impersonate actions");

    for (const action of extensionActions()) {
      const mobileOnly = action.surfaces.includes("mobile-main") && !action.surfaces.includes("desktop-menu");
      const desktopOnly = action.surfaces.includes("desktop-menu") && !action.surfaces.includes("mobile-main");
      const classes = [
        mobileOnly ? "mari-si-menu-action-mobile-main" : "",
        desktopOnly ? "mari-si-menu-action-desktop" : "",
      ].filter(Boolean).join(" ");
      if (action.surfaces.includes("mobile-main") || action.surfaces.includes("desktop-menu")) {
        menuEl.appendChild(createMenuAction(action.label, action.title, action.icon, action.handler, classes));
      }
    }

    mainButton = document.createElement("button");
    mainButton.type = "button";
    mainButton.className = BUTTON_CLASS;
    mainButton.draggable = false;
    mainButton.innerHTML = userCheckSvg;
    mainButton.title = "Impersonate. Hold or right-click for more.";
    mainButton.setAttribute("aria-label", "Impersonate");

    on(mainButton, "pointerdown", (event) => {
      if (activeRun || event.button !== 0) return;
      event.preventDefault();
      clearTimeout(holdTimer);
      suppressNextClick = false;
      holdTimer = setTimeout(() => {
        suppressNextClick = true;
        openMenu();
      }, HOLD_MS);
    });
    on(mainButton, "pointerup", () => {
      clearTimeout(holdTimer);
    });
    on(mainButton, "pointercancel", () => {
      clearTimeout(holdTimer);
    });
    on(mainButton, "pointerleave", () => {
      clearTimeout(holdTimer);
    });
    on(mainButton, "contextmenu", (event) => {
      event.preventDefault();
      if (!activeRun) openMenu();
    });
    on(mainButton, "click", (event) => {
      event.preventDefault();
      if (activeRun) return;
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      if (isMobileViewport()) {
        openMenu();
      } else if (event.shiftKey) {
        startDryRun("continue");
      } else {
        startDryRun("impersonate");
      }
    });

    root.appendChild(menuEl);
    root.appendChild(mainButton);
    marinara.onCleanup(() => root.remove());
    marinara.onCleanup(disconnectStateObservers);
    return root;
  }

  function disconnectStateObservers() {
    for (const observer of stateObservers) {
      if (observer && typeof observer.disconnect === "function") {
        try { observer.disconnect(); } catch {}
      }
    }
    stateObservers = [];
    observedStateTargetsKey = "";
    observedTextareaTarget = null;
    observedSendButtonTarget = null;
  }

  function setupInputStateObservers(root) {
    if (!root || !mainButton) return;
    const textarea = findTextarea(root);
    const sendButton = findSendButton(root);
    const key = [textarea ? "textarea" : "", sendButton ? "send" : "", rootEl ? "button" : ""].join(":");
    if (
      key === observedStateTargetsKey &&
      observedTextareaTarget === textarea &&
      observedSendButtonTarget === sendButton &&
      stateObservers.length > 0
    ) {
      return;
    }

    disconnectStateObservers();
    observedStateTargetsKey = key;
    observedTextareaTarget = textarea || null;
    observedSendButtonTarget = sendButton || null;

    const scheduleIdleSync = () => {
      if (activeRun) return;
      if (mountRetryTimer) return;
      mountRetryTimer = marinara.setTimeout(() => {
        mountRetryTimer = null;
        updateMainButtonIdleState();
      }, 40);
    };

    const options = { attributes: true, attributeFilter: ["disabled", "aria-disabled", "class"] };
    if (textarea) stateObservers.push(marinara.observe(textarea, scheduleIdleSync, options));
    if (sendButton) stateObservers.push(marinara.observe(sendButton, scheduleIdleSync, options));
  }

  function disconnectMountObserver() {
    if (mountObserver && typeof mountObserver.disconnect === "function") {
      try { mountObserver.disconnect(); } catch {}
    }
    mountObserver = null;
    observedMountHost = null;
  }

  function setupScopedMountObserver() {
    if (observedMountHost === document.body) return;
    if (!document.body) return;

    observedMountHost = document.body;
    mountObserver = marinara.observe(document.body, () => {
      if (mountRetryTimer) return;
      mountRetryTimer = marinara.setTimeout(() => {
        mountRetryTimer = null;
        const currentRoot = findChatRoot();
        const missingButton = !!currentRoot && !currentRoot.querySelector(`.${ROOT_CLASS}`);
        const detachedButton = !!rootEl && !document.documentElement.contains(rootEl);
        if (missingButton || detachedButton) {
          mountAttempts = 0;
          mount();
        } else if (currentRoot) {
          setupInputStateObservers(currentRoot);
          syncMobileUi(currentRoot);
          if (activeRun) {
            const sendButton = findSendButton(currentRoot);
            if (
              sendButton &&
              (sendButton !== hijackedSendButton || !sendButton.classList.contains("mari-si-native-stop"))
            ) {
              setRunUi(true, activeRun);
            }
          } else {
            updateMainButtonIdleState();
          }
        }
      }, 80);
    }, { childList: true, subtree: true });
  }

  function mount() {
    const root = findChatRoot();
    const sendButton = findSendButton(root);
    if (!root || !sendButton) return false;

    const existing = root.querySelector(`.${ROOT_CLASS}`);
    if (existing) {
      rootEl = existing;
      mainButton = existing.querySelector(`.${BUTTON_CLASS}`);
      menuEl = existing.querySelector(`.${MENU_CLASS}`);
      setupInputStateObservers(root);
      if (activeRun) setRunUi(true, activeRun);
      else updateMainButtonIdleState();
      syncMobileUi(root);
      mountAttempts = 0;
      setupScopedMountObserver();
      return true;
    }

    rootEl = createRoot();
    const targetParent = sendButton.parentElement || root;
    targetParent.insertBefore(rootEl, sendButton);
    if (activeRun) setRunUi(true, activeRun);
    else updateMainButtonIdleState();
    syncMobileUi(root);
    mountAttempts = 0;
    setupScopedMountObserver();
    return true;
  }

  function scheduleMountRetry() {
    if (mountRetryTimer) return;
    mountRetryTimer = marinara.setTimeout(() => {
      mountRetryTimer = null;
      mountAttempts += 1;
      if (mount()) return;
      if (mountAttempts < 120) scheduleMountRetry();
    }, 500);
  }

  marinara.onCleanup(() => {
    detachMenuDocumentListeners();
    disconnectMountObserver();
    clearHiddenQuickReplies();
    closePickerActions();
    if (activeRun) stopRun();
    try { extensionRegistration?.unregister?.(); } catch {}
    extensionRegistration = null;
    if (mountRetryTimer) clearTimeout(mountRetryTimer);
    if (mobileSyncTimer) clearTimeout(mobileSyncTimer);
    if (holdTimer) clearTimeout(holdTimer);
  });

  try {
    extensionRegistration = alDente()?.registerExtension?.({
      id: "impersonate-button",
      name: "Impersonate Button",
      version: "0.1.0",
      capabilities: [
        "dry-run-generation",
        "generation-operation",
        "wake-lock",
        "persona-parser",
        "character-parser",
      ],
    }) || null;
  } catch {}

  setupMobileMediaListener();
  if (!mount()) scheduleMountRetry();
})();

  });
}
