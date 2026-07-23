// Generated from packages branch source by the catalog rebuild workflow.
const PACKAGE_ID = "presence-extension";
const TAG_NAME = "marinara-capability-presence-extension";
const LEGACY_CSS = "";


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
  "use strict";

  const EXTENSION_NAME = "Presence";
  const PRESENCE_KEY = "marinaraPresence";
  const BUTTON_CLASS = "mari-presence-button";
  const POPOVER_CLASS = "mari-presence-popover";
  const TOAST_CLASS = "mari-presence-toast";
  const DEFAULT_TOKEN_BUDGET = 32000;
  const SCAN_OVERAGE = 1.1;
  const PATCH_CONCURRENCY = 8;
  const DEBUG_STORAGE_KEY = "marinara-presence-debug";

  const state = {
    originalFetch: null,
    observer: null,
    scanTimer: null,
    popover: null,
    popoverMessageId: "",
    popoverOpenSeq: 0,
    chatCache: new Map(),
    characterCache: new Map(),
    cleanups: [],
    extensionRegistration: null,
    serviceRegistration: null,
    commandRegistration: null,
    fetchInterceptorRegistrations: [],
    legacyFetchInstalled: false,
    debug: localStorage.getItem(DEBUG_STORAGE_KEY) === "true",
    disposed: false,
  };

  function log(...args) {
    if (!state.debug) return;
    console.info(`[${EXTENSION_NAME}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${EXTENSION_NAME}]`, ...args);
  }

  function normalizeApiPath(path) {
    return path.startsWith("/") ? path : `/${path}`;
  }

  function alDente() {
    return window.alDenteFactory || null;
  }

  function factoryApi() {
    return alDente()?.marinara?.api || null;
  }

  function factoryFetch() {
    return alDente()?.marinara?.fetch || null;
  }

  function factoryCommands() {
    return alDente()?.marinara?.commands || null;
  }

  function factoryGeneration() {
    return alDente()?.marinara?.generation || null;
  }

  function factoryIdentity() {
    return alDente()?.marinara?.identity || null;
  }

  function factoryMessages() {
    return alDente()?.marinara?.messages || null;
  }

  function factoryOperations() {
    return alDente()?.operations || null;
  }

  function factoryParsers() {
    return alDente()?.marinara?.parsers || null;
  }

  function factoryRoutes() {
    return alDente()?.marinara?.routes || null;
  }

  function factorySse() {
    return alDente()?.marinara?.sse || null;
  }

  function baseFetch(input, init) {
    const fetchFn = typeof state.originalFetch === "function"
      ? state.originalFetch
      : factoryFetch()?.fetchOriginal || window.fetch.bind(window);
    return fetchFn(input, init);
  }

  async function api(path, options = {}) {
    const sharedApi = factoryApi();
    if (sharedApi?.request) return sharedApi.request(path, options);

    const response = await baseFetch(`/api${normalizeApiPath(path)}`, {
      ...options,
      headers: {
        ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
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

  function parseMaybeJson(value, fallback) {
    const parsedByFactory = factoryParsers()?.maybeJson?.(value, fallback);
    if (parsedByFactory !== undefined) return parsedByFactory;
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function getExtra(message) {
    const extraByFactory = factoryParsers()?.messageExtra?.(message);
    if (extraByFactory && typeof extraByFactory === "object" && !Array.isArray(extraByFactory)) return extraByFactory;
    const extra = parseMaybeJson(message?.extra, {});
    return extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  }

  function getMetadata(chat) {
    const metadataByFactory = factoryParsers()?.chatMetadata?.(chat);
    if (metadataByFactory && typeof metadataByFactory === "object" && !Array.isArray(metadataByFactory)) return metadataByFactory;
    const metadata = parseMaybeJson(chat?.metadata, {});
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  }

  function isHiddenFromAI(message) {
    return getExtra(message).hiddenFromAI === true;
  }

  function messageContent(message) {
    const contentByFactory = factoryParsers()?.messageContent?.(message);
    if (contentByFactory !== undefined) return String(contentByFactory);
    return String(message?.content ?? message?.mes ?? message?.message ?? "");
  }

  function countRoughTokens(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return 0;
    return Math.max(1, Math.ceil(normalized.length / 4));
  }

  function resolveTokenBudget(chat, body) {
    const meta = getMetadata(chat);
    const candidates = [
      body?.contextSize,
      body?.maxContext,
      body?.contextTokenLimit,
      chat?.contextSize,
      chat?.maxContext,
      meta.contextSize,
      meta.maxContext,
      meta.contextTokenLimit,
      meta.effectiveMaxContext,
    ];
    for (const value of candidates) {
      const n = Math.floor(Number(value));
      if (Number.isFinite(n) && n > 1000) return n;
    }
    return DEFAULT_TOKEN_BUDGET;
  }

  function isGenerateUrl(url) {
    const routeHelper = factoryRoutes();
    if (routeHelper?.isGenerateUrl) return routeHelper.isGenerateUrl(url);
    try {
      const pathname = new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/, "");
      return pathname === "/api/generate";
    } catch {
      return false;
    }
  }

  function parseCreateMessageUrl(url) {
    const routeHelper = factoryRoutes();
    if (routeHelper?.parseCreateMessageUrl) return routeHelper.parseCreateMessageUrl(url);
    try {
      const pathname = new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/, "");
      const match = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  }

  function withPresenceSkip(init = {}) {
    return { ...(init || {}), __marinaraPresenceHandled: true };
  }

  function stripPresenceInternalInit(init = {}) {
    if (!init || typeof init !== "object" || !("__marinaraPresenceHandled" in init)) return init;
    const { __marinaraPresenceHandled, ...rest } = init;
    return rest;
  }

  function readActiveChatId() {
    const factoryChatId = factoryIdentity()?.readActiveChatId?.();
    if (factoryChatId) return factoryChatId;
    const stored = localStorage.getItem("marinara-active-chat-id");
    if (stored) return stored;
    const selected = document.querySelector('[data-chat-id][aria-current="true"], [data-chat-id][class*="sidebar-accent"]');
    return selected?.getAttribute("data-chat-id") || "";
  }

  async function getChat(chatId) {
    if (!chatId) return null;
    const cached = state.chatCache.get(chatId);
    if (cached && Date.now() - cached.at < 5000) return cached.value;
    const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
    if (chat?.metadata && typeof chat.metadata === "string") chat.metadata = parseMaybeJson(chat.metadata, {});
    state.chatCache.set(chatId, { at: Date.now(), value: chat });
    return chat;
  }

  async function getMessages(chatId) {
    const res = await api(`/chats/${encodeURIComponent(chatId)}/messages`);
    return Array.isArray(res) ? res : res?.messages || res?.data || [];
  }

  function readCharacterName(character, fallback = "") {
    const nameByFactory = factoryParsers()?.readCharacterName?.(character, fallback);
    if (nameByFactory) return nameByFactory;
    const data = parseMaybeJson(character?.data, character?.data || {});
    return String(character?.name || data?.name || fallback || character?.id || "Character").trim();
  }

  function getCharacterIds(chat) {
    const idsByFactory = factoryParsers()?.getCharacterIds?.(chat);
    if (Array.isArray(idsByFactory)) return idsByFactory.filter((id) => typeof id === "string" && id.trim()).map(String);
    const ids = parseMaybeJson(chat?.characterIds, []);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.trim()).map(String) : [];
  }

  async function getCharacter(characterId) {
    if (!characterId) return null;
    const cached = state.characterCache.get(characterId);
    if (cached) return cached;
    const identity = factoryIdentity();
    let character = null;
    if (identity?.getCharacter) character = await identity.getCharacter(characterId).catch(() => null);
    if (!character) character = await api(`/characters/${encodeURIComponent(characterId)}`).catch(() => null);
    const normalized = character ? { ...character, id: character.id || characterId, name: readCharacterName(character, characterId) } : null;
    if (normalized) state.characterCache.set(characterId, normalized);
    return normalized;
  }

  async function getRoster(chat) {
    const ids = getCharacterIds(chat);
    const characters = [];
    for (const id of ids) {
      const character = await getCharacter(id);
      characters.push(character || { id, name: id });
    }
    return characters;
  }

  function activeCharacterIdsForChat(chat, rosterIds) {
    const activeByFactory = factoryParsers()?.activeCharacterIdsForChat?.(chat, rosterIds);
    if (Array.isArray(activeByFactory)) return activeByFactory.filter((id) => typeof id === "string" && id.trim()).map(String);
    const meta = getMetadata(chat);
    const inactive = new Set(Array.isArray(meta.inactiveCharacterIds) ? meta.inactiveCharacterIds.map(String) : []);
    const active = rosterIds.filter((id) => !inactive.has(id));
    return active.length ? active : rosterIds;
  }

  function generationCharacterIdsForBody(chat, rosterIds, body, messages = []) {
    const requested = typeof body?.forCharacterId === "string" ? body.forCharacterId.trim() : "";
    if (requested && rosterIds.includes(requested)) return { ids: [requested], source: "forCharacterId" };

    const anchorId =
      typeof body?.regenerateMessageId === "string" && body.regenerateMessageId.trim()
        ? body.regenerateMessageId.trim()
        : typeof body?.continueMessageId === "string" && body.continueMessageId.trim()
          ? body.continueMessageId.trim()
          : "";
    if (anchorId) {
      const anchor = messages.find((message) => message?.id === anchorId);
      const characterId = typeof anchor?.characterId === "string" ? anchor.characterId.trim() : "";
      if (characterId && rosterIds.includes(characterId)) return { ids: [characterId], source: "anchorMessage" };
    }

    return { ids: activeCharacterIdsForChat(chat, rosterIds), source: "activeCharacters" };
  }

  function getPresenceIds(message, rosterIds) {
    const presence = getExtra(message)[PRESENCE_KEY];
    if (!presence || typeof presence !== "object" || Array.isArray(presence)) return new Set(rosterIds);
    if (presence.mode === "default") return new Set(rosterIds);
    if (Array.isArray(presence.presentCharacterIds)) {
      const roster = new Set(rosterIds);
      return new Set(presence.presentCharacterIds.map(String).filter((id) => roster.has(id)));
    }
    return new Set(rosterIds);
  }

  function buildPresencePatch(ids, rosterIds) {
    const unique = Array.from(new Set(ids.map(String))).filter((id) => rosterIds.includes(id));
    if (unique.length === rosterIds.length) return { [PRESENCE_KEY]: null };
    return {
      [PRESENCE_KEY]: {
        version: 1,
        presentCharacterIds: unique,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  async function patchMessagePresence(chatId, messageId, ids, rosterIds) {
    return api(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`, {
      method: "PATCH",
      body: JSON.stringify(buildPresencePatch(ids, rosterIds)),
    });
  }

  async function stampMessageWithActivePresence(chatId, messageId, chat = null) {
    if (!chatId || !messageId) return;
    const resolvedChat = chat || (await getChat(chatId));
    const rosterIds = getCharacterIds(resolvedChat);
    if (!rosterIds.length) return;
    const activeIds = activeCharacterIdsForChat(resolvedChat, rosterIds);
    await patchMessagePresence(chatId, messageId, activeIds, rosterIds);
  }

  function hasStoredPresence(message) {
    return Object.prototype.hasOwnProperty.call(getExtra(message), PRESENCE_KEY);
  }

  async function bulkHidden(chatId, messageIds, hidden) {
    if (!messageIds.length) return { requested: 0, updated: 0 };
    const result = await api(`/chats/${encodeURIComponent(chatId)}/messages/bulk-hidden`, {
      method: "PATCH",
      body: JSON.stringify({ messageIds, hidden }),
    });
    const updated =
      typeof result?.updated === "number"
        ? result.updated
        : Array.isArray(result)
          ? result.length
          : Array.isArray(result?.messageIds)
            ? result.messageIds.length
            : Array.isArray(result?.updatedIds)
              ? result.updatedIds.length
              : 0;
    return { requested: messageIds.length, updated };
  }

  async function toggleSummaryEntry(chatId, entryId, enabled) {
    return api(`/chats/${encodeURIComponent(chatId)}/summary-entries`, {
      method: "PATCH",
      body: JSON.stringify({ operation: "toggle", entryId, enabled }),
    });
  }

  function getSummaryEntries(chat) {
    const entries = getMetadata(chat).summaryEntries;
    return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object") : [];
  }

  function messageVisibleByPresence(message, activeIds, rosterIds) {
    if (!activeIds.length || !rosterIds.length) return true;
    const present = getPresenceIds(message, rosterIds);
    return activeIds.some((id) => present.has(id));
  }

  function buildPresencePlan(chat, messages, body) {
    const rosterIds = getCharacterIds(chat);
    const target = generationCharacterIdsForBody(chat, rosterIds, body, messages);
    const activeIds = target.ids;
    const tokenBudget = resolveTokenBudget(chat, body);
    const scanBudget = Math.ceil(tokenBudget * SCAN_OVERAGE);
    let scannedTokens = 0;
    const hideIds = [];
    const hiddenByPresence = new Set();

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message?.id || isHiddenFromAI(message)) continue;
      scannedTokens += countRoughTokens(messageContent(message));
      const visible = messageVisibleByPresence(message, activeIds, rosterIds);
      if (!visible) {
        hideIds.push(message.id);
        hiddenByPresence.add(message.id);
      }
      if (scannedTokens > scanBudget) break;
    }

    const byId = new Map(messages.filter((message) => message?.id).map((message) => [message.id, message]));
    const disabledSummaryEntryIds = [];
    for (const entry of getSummaryEntries(chat)) {
      if (entry.enabled === false || !entry.id) continue;
      const coveredIds = Array.isArray(entry.messageIds)
        ? entry.messageIds
        : Array.isArray(entry.hiddenMessageIds)
          ? entry.hiddenMessageIds
          : [];
      const coveredMessages = coveredIds.map((id) => byId.get(id)).filter(Boolean);
      if (!coveredMessages.length) continue;
      const allHiddenForPresence = coveredMessages.every((message) => !messageVisibleByPresence(message, activeIds, rosterIds));
      if (allHiddenForPresence) disabledSummaryEntryIds.push(String(entry.id));
    }

    return {
      chatId: chat?.id || body?.chatId || "",
      hideIds: Array.from(new Set(hideIds)),
      disabledSummaryEntryIds: Array.from(new Set(disabledSummaryEntryIds)),
      targetCharacterIds: activeIds,
      targetSource: target.source,
      tokenBudget,
      scannedTokens,
    };
  }

  async function preparePresenceRun(body) {
    const chatId = body?.chatId || readActiveChatId();
    log("preparePresenceRun called", {
      chatId,
      forCharacterId: body?.forCharacterId || null,
      regenerateMessageId: body?.regenerateMessageId || null,
      continueMessageId: body?.continueMessageId || null,
      impersonate: body?.impersonate === true,
    });
    if (!chatId) {
      log("prepare skipped: no chatId");
      return null;
    }
    if (body?.impersonate) {
      log("prepare skipped: unsupported generation mode");
      return null;
    }

    const [chat, messages] = await Promise.all([getChat(chatId), getMessages(chatId)]);
    if (!chat) {
      log("prepare skipped: missing chat or messages", { hasChat: Boolean(chat), messages: messages.length });
      return null;
    }
    const rosterIds = getCharacterIds(chat);
    const stampPresenceIds = activeCharacterIdsForChat(chat, rosterIds);
    const plan = buildPresencePlan(chat, messages, body || {});
    const applied = {
      chatId,
      hiddenMessageIds: [],
      hiddenMessageUpdateCount: 0,
      disabledSummaryEntryIds: [],
      preMessageIds: new Set(messages.filter((message) => message?.id).map((message) => String(message.id))),
      rosterIds,
      stampPresenceIds,
    };

    try {
      for (const entryId of plan.disabledSummaryEntryIds) {
        await toggleSummaryEntry(chatId, entryId, false);
        applied.disabledSummaryEntryIds.push(entryId);
      }
      if (plan.hideIds.length) {
        const result = await bulkHidden(chatId, plan.hideIds, true);
        if (result.updated <= 0) {
          warn("bulk hide did not update any messages", { chatId, requested: result.requested, sample: plan.hideIds.slice(0, 5) });
        }
        applied.hiddenMessageIds = plan.hideIds;
        applied.hiddenMessageUpdateCount = result.updated;
      }
      log("generation presence plan", {
        chatId,
        targets: plan.targetCharacterIds,
        targetSource: plan.targetSource,
        plannedHideMessages: plan.hideIds.length,
        plannedDisableSummaries: plan.disabledSummaryEntryIds.length,
        hiddenMessages: applied.hiddenMessageIds.length,
        hiddenMessagesServerUpdated: applied.hiddenMessageUpdateCount,
        disabledSummaries: applied.disabledSummaryEntryIds.length,
        stampPresenceIds: applied.stampPresenceIds,
        preMessageCount: applied.preMessageIds.size,
        tokenBudget: plan.tokenBudget,
        scannedTokens: plan.scannedTokens,
      });
      return applied;
    } catch (error) {
      warn("failed to apply presence visibility; restoring partial changes", error);
      await cleanupPresenceRun(applied).catch((cleanupError) => warn("presence cleanup after failed prepare failed", cleanupError));
      throw error;
    }
  }

  async function cleanupPresenceRun(run) {
    if (!run?.chatId) return;
    const errors = [];
    if (run.disabledSummaryEntryIds?.length) {
      for (const entryId of run.disabledSummaryEntryIds) {
        await toggleSummaryEntry(run.chatId, entryId, true).catch((error) => errors.push(error));
      }
    }
    if (run.hiddenMessageIds?.length) {
      await bulkHidden(run.chatId, run.hiddenMessageIds, false).catch((error) => errors.push(error));
    }
    if (errors.length) throw errors[0];
  }

  async function stampNewGenerationMessages(run) {
    if (!run?.chatId || !run?.preMessageIds || !run?.rosterIds?.length) return;
    const stampIds = Array.isArray(run.stampPresenceIds) && run.stampPresenceIds.length ? run.stampPresenceIds : run.rosterIds;
    const messages = await getMessages(run.chatId);
    const created = messages.filter((message) => {
      if (!message?.id || run.preMessageIds.has(String(message.id))) return false;
      if (hasStoredPresence(message)) return false;
      return message.role === "user" || message.role === "assistant";
    });
    if (!created.length) return;
    await patchMessagesInBatches(
      created.map((message) => async () => {
        await patchMessagePresence(run.chatId, String(message.id), stampIds, run.rosterIds);
      }),
    );
    log("stamped generated turn messages", {
      chatId: run.chatId,
      count: created.length,
      ids: created.map((message) => message.id).slice(0, 8),
      stampPresenceIds: stampIds,
    });
  }

  async function finalizePresenceRun(run) {
    try {
      await stampNewGenerationMessages(run);
    } catch (error) {
      warn("failed to stamp generated turn messages", error);
    } finally {
      await cleanupPresenceRun(run);
    }
  }

  function startSharedGeneration(chatId, body) {
    if (!chatId) return null;
    const id = `presence:generate:${chatId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let generation = null;
    let operation = null;
    try {
      generation = factoryGeneration()?.start?.({
        id,
        chatId,
        route: "generate",
        source: EXTENSION_NAME,
        body,
      }) || null;
    } catch {}
    try {
      operation = factoryOperations()?.start?.({
        id,
        source: EXTENSION_NAME,
        kind: "generation",
        label: "Presence generation",
        reason: "presence:generate",
        detail: {
          chatId,
          forCharacterId: body?.forCharacterId || "",
          regenerateMessageId: body?.regenerateMessageId || "",
          continueMessageId: body?.continueMessageId || "",
        },
        wakeLock: {
          id,
          source: EXTENSION_NAME,
          reason: "presence:generate",
        },
      }) || null;
    } catch {}
    if (!generation && !operation) return null;
    return { id, generation, operation, closed: false };
  }

  function finishSharedGeneration(shared, status = "finished", error = null, options = {}) {
    if (!shared || shared.closed) return;
    shared.closed = true;
    try {
      if (options.finishGeneration !== false && shared.generation) {
        if (status === "failed") shared.generation.fail?.(error);
        else if (status === "cancelled") shared.generation.abort?.();
        else shared.generation.finish?.();
      }
    } catch {}
    try {
      if (shared.operation) {
        if (status === "failed") shared.operation.fail?.(error);
        else if (status === "cancelled") shared.operation.cancel?.();
        else shared.operation.finish?.();
      }
    } catch {}
  }

  function parseSsePayloads(text, final = false) {
    const parsedByFactory = factorySse()?.parsePayloads?.(text, final);
    if (parsedByFactory) return parsedByFactory;
    const parts = text.split(/\n\n/);
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

  function handleSsePayloadForPresence(chatId, payload, sharedGeneration = null) {
    const event = factorySse()?.parseEventPayload?.(payload) || (() => {
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    })();
    if (!event) return;
    if (sharedGeneration?.generation?.event) {
      sharedGeneration.generation.event(event);
    } else {
      factoryMessages()?.handleSseEvent?.(chatId, event, { source: EXTENSION_NAME });
    }
    if (event?.type === "done") {
      finishSharedGeneration(sharedGeneration, "finished", null, { finishGeneration: false });
    } else if (event?.type === "aborted") {
      finishSharedGeneration(sharedGeneration, "cancelled", null, { finishGeneration: false });
    } else if (event?.type === "error") {
      finishSharedGeneration(sharedGeneration, "failed", event?.data || event, { finishGeneration: false });
    }
    if (event?.type !== "message_saved") return;
    const messageId = event.data?.id || event.data?.messageId;
    if (!messageId) return;
    stampMessageWithActivePresence(chatId, String(messageId)).catch((error) => warn("failed to stamp generated message presence", error));
  }

  function wrapStreamingResponse(response, chatId, onDone, sharedGeneration = null) {
    const isSse = factorySse()?.isSseResponse?.(response)
      || Boolean(response?.body && String(response.headers?.get?.("content-type") || "").includes("text/event-stream"));
    if (!isSse) {
      finishSharedGeneration(sharedGeneration, response?.ok === false ? "failed" : "finished");
      return response;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let cleaned = false;
    const cleanupOnce = () => {
      if (cleaned) return;
      cleaned = true;
      Promise.resolve(onDone()).catch((error) => warn("presence cleanup failed", error));
    };
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            const parsed = parseSsePayloads(buffer, true);
            for (const payload of parsed.payloads) handleSsePayloadForPresence(chatId, payload, sharedGeneration);
            cleanupOnce();
            finishSharedGeneration(sharedGeneration, "finished", null, { finishGeneration: false });
            controller.close();
            return;
          }
          const text = decoder.decode(value, { stream: true });
          buffer += text;
          const parsed = parseSsePayloads(buffer);
          buffer = parsed.rest;
          for (const payload of parsed.payloads) handleSsePayloadForPresence(chatId, payload, sharedGeneration);
          controller.enqueue(value);
        } catch (error) {
          cleanupOnce();
          finishSharedGeneration(sharedGeneration, "failed", error);
          controller.error(error);
        }
      },
      cancel(reason) {
        cleanupOnce();
        finishSharedGeneration(sharedGeneration, "cancelled", reason);
        return reader.cancel(reason);
      },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  async function handleGenerate(input, init, body, nextFetch = baseFetch, options = {}) {
    const fetchNext = typeof nextFetch === "function" ? nextFetch : baseFetch;
    const chatIdForTracking = body?.chatId || readActiveChatId() || "";
    const sharedGeneration = options.trackSharedGeneration === true ? startSharedGeneration(chatIdForTracking, body || {}) : null;
    log("handleGenerate called", {
      chatId: chatIdForTracking || null,
      forCharacterId: body?.forCharacterId || null,
      hasNextFetch: typeof nextFetch === "function",
    });
    let run = null;
    try {
      run = await preparePresenceRun(body);
    } catch (error) {
      warn("continuing generation without presence filtering", error);
    }

    let response;
    try {
      response = await fetchNext(input, withPresenceSkip(init));
    } catch (error) {
      if (run) await cleanupPresenceRun(run).catch((cleanupError) => warn("presence cleanup failed", cleanupError));
      finishSharedGeneration(sharedGeneration, "failed", error);
      throw error;
    }

    const chatId = run?.chatId || body?.chatId || readActiveChatId();
    if (!run) {
      if (chatId) return wrapStreamingResponse(response, chatId, async () => {}, sharedGeneration);
      finishSharedGeneration(sharedGeneration, response?.ok === false ? "failed" : "finished");
      return response;
    }
    const isSse = factorySse()?.isSseResponse?.(response)
      || Boolean(response?.body && String(response.headers?.get?.("content-type") || "").includes("text/event-stream"));
    if (!isSse) {
      await finalizePresenceRun(run).catch((error) => warn("presence cleanup failed", error));
      finishSharedGeneration(sharedGeneration, response?.ok === false ? "failed" : "finished");
      return response;
    }
    return wrapStreamingResponse(response, run.chatId, () => finalizePresenceRun(run), sharedGeneration);
  }

  async function handleCreateMessage(input, init, chatId, nextFetch = baseFetch) {
    const fetchNext = typeof nextFetch === "function" ? nextFetch : baseFetch;
    const response = await fetchNext(input, init);
    await factoryMessages()?.trackCreateResponse?.(chatId, response, { source: EXTENSION_NAME });
    if (!response.ok) return response;
    let message = null;
    try {
      message = await response.clone().json();
    } catch {
      message = null;
    }
    const messageId = message?.id || message?.message?.id || message?.data?.id;
    if (messageId) {
      stampMessageWithActivePresence(chatId, String(messageId)).catch((error) => warn("failed to stamp saved message presence", error));
    }
    return response;
  }

  function installGenerateInterceptor() {
    if (state.fetchInterceptorRegistrations.length || state.legacyFetchInstalled) return;
    state.originalFetch = factoryFetch()?.fetchOriginal || window.fetch.bind(window);
    const fetchHub = factoryFetch();
    if (fetchHub?.intercepts?.register) {
      state.fetchInterceptorRegistrations.push(
        fetchHub.intercepts.register({
          id: "presence:fetch-message-create",
          route: "message:create",
          priority: 40,
          handler: async (context, next) => {
            const chatId = context.route?.chatId || "";
            if (context.method !== "POST" || !chatId) return next();
            return handleCreateMessage(context.input, context.init, chatId, next);
          },
        }),
      );
      state.fetchInterceptorRegistrations.push(
        fetchHub.intercepts.register({
          id: "presence:fetch-generate",
          route: "generate",
          priority: 40,
          handler: async (context, next) => {
            if (context.init?.__marinaraPresenceHandled === true) {
              return next(context.input, stripPresenceInternalInit(context.init));
            }
            if (context.method !== "POST" || context.route?.route !== "generate") return next();
            return handleGenerate(context.input, context.init, context.body || {}, next, { trackSharedGeneration: true });
          },
        }),
      );
      return;
    }

    state.legacyFetchInstalled = true;
    window.fetch = async (input, init = {}) => {
      if (init?.__marinaraPresenceHandled === true) {
        return baseFetch(input, stripPresenceInternalInit(init));
      }
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
      const createMessageChatId = method === "POST" ? parseCreateMessageUrl(url) : "";
      if (createMessageChatId) return handleCreateMessage(input, init, createMessageChatId, baseFetch);
      if (method !== "POST" || !isGenerateUrl(url)) return baseFetch(input, init);
      const groupSmartOrder = alDente()?.services?.get?.("group-smart-order") || window.__marinaraGroupSmartOrder;
      if (groupSmartOrder?.presenceCompatibility === true) {
        log("generate intercepted but deferred to compatible GSO");
        return baseFetch(input, init);
      }
      let body = null;
      try {
        body = typeof init.body === "string" ? JSON.parse(init.body) : null;
      } catch {
        body = null;
      }
      return handleGenerate(input, init, body || {}, baseFetch, { trackSharedGeneration: true });
    };
  }

  function showToast(message, tone = "info") {
    let toast = document.querySelector(`.${TOAST_CLASS}`);
    if (!toast) {
      toast = document.createElement("div");
      toast.className = TOAST_CLASS;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function positionPopover(anchor, popover) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(320, window.innerWidth - 16);
    const viewportHeight = window.innerHeight;
    const availableBelow = viewportHeight - rect.bottom - margin;
    const availableAbove = rect.top - margin;
    const preferAbove = availableBelow < 180 && availableAbove > availableBelow;
    const maxHeight = Math.max(140, Math.floor((preferAbove ? availableAbove : availableBelow) - margin));
    const measuredHeight = popover.offsetHeight || 240;
    const top = preferAbove
      ? Math.max(margin, rect.top - Math.min(measuredHeight, maxHeight) - margin)
      : Math.min(rect.bottom + margin, viewportHeight - margin - Math.min(measuredHeight, maxHeight));
    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${maxHeight}px`;
    popover.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    popover.style.top = `${top}px`;
  }

  async function openPresencePopover(anchor, messageId) {
    closePopover();
    const openSeq = ++state.popoverOpenSeq;
    const chatId = readActiveChatId();
    if (!chatId) return showToast("No active chat.", "error");
    const popover = document.createElement("div");
    popover.className = POPOVER_CLASS;
    popover.innerHTML = `<div class="mp-loading">Loading presence...</div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    state.popoverMessageId = messageId;
    positionPopover(anchor, popover);

    try {
      const [chat, messages] = await Promise.all([getChat(chatId), getMessages(chatId)]);
      const roster = await getRoster(chat);
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      const rosterIds = roster.map((character) => character.id);
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error("Message not found.");
      const present = getPresenceIds(message, rosterIds);
      renderPopover(popover, { chatId, messageId, roster, present, rosterIds, openSeq });
      positionPopover(anchor, popover);
    } catch (error) {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      popover.innerHTML = `<div class="mp-error">${escapeHtml(error?.message || "Could not load presence.")}</div>`;
    }
  }

  function isCurrentPopover(popover, chatId, messageId, openSeq) {
    return (
      state.popover === popover &&
      popover?.isConnected &&
      state.popoverMessageId === messageId &&
      state.popoverOpenSeq === openSeq &&
      readActiveChatId() === chatId
    );
  }

  function renderPopover(popover, context) {
    const { chatId, messageId, roster, present, rosterIds, openSeq } = context;
    popover.innerHTML = `
      <div class="mp-head">
        <strong>Presence</strong>
        <button type="button" class="mp-close" title="Close presence">x</button>
      </div>
      <div class="mp-list">
        ${roster
          .map(
            (character) => `
              <label class="mp-row">
                <input type="checkbox" value="${escapeHtml(character.id)}" ${present.has(character.id) ? "checked" : ""}>
                <span>${escapeHtml(character.name || character.id)}</span>
              </label>
            `,
          )
          .join("") || `<div class="mp-empty">No chat characters found.</div>`}
      </div>
      <div class="mp-actions">
        <button type="button" data-action="all">Everyone</button>
        <button type="button" data-action="none">Nobody</button>
      </div>
    `;
    popover.querySelector(".mp-close")?.addEventListener("click", closePopover);
    const patchCurrentPopoverPresence = async (ids, successMessage) => {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      await patchMessagePresence(chatId, messageId, ids, rosterIds);
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      showToast(successMessage);
    };
    popover.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.addEventListener("change", async () => {
        if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
        const ids = Array.from(popover.querySelectorAll("input[type='checkbox']:checked")).map((item) => item.value);
        await patchCurrentPopoverPresence(ids, "Presence updated.");
      });
    });
    popover.querySelector("[data-action='all']")?.addEventListener("click", async () => {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      popover.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = true;
      });
      await patchCurrentPopoverPresence(rosterIds, "Everyone marked present.");
    });
    popover.querySelector("[data-action='none']")?.addEventListener("click", async () => {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      popover.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = false;
      });
      await patchCurrentPopoverPresence([], "Nobody marked present.");
    });
  }

  function closePopover() {
    state.popoverOpenSeq += 1;
    if (state.popover?.isConnected) state.popover.remove();
    state.popover = null;
    state.popoverMessageId = "";
  }

  function ensureMessageButtons() {
    if (state.disposed) return;
    const rows = Array.from(document.querySelectorAll(".mari-message[data-message-id]"));
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      if (row.querySelector(`.${BUTTON_CLASS}`)) continue;
      const actions = row.querySelector(".mari-message-actions");
      if (!actions) continue;
      const messageId = row.getAttribute("data-message-id");
      if (!messageId) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = BUTTON_CLASS;
      button.title = "Edit presence";
      button.setAttribute("aria-label", "Edit presence");
      button.textContent = "P";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const currentMessageId = button.closest(".mari-message[data-message-id]")?.getAttribute("data-message-id") || messageId;
        openPresencePopover(button, currentMessageId);
      });
      actions.appendChild(button);
    }
  }

  function scheduleButtonScan() {
    if (state.scanTimer) return;
    state.scanTimer = window.setTimeout(() => {
      state.scanTimer = null;
      ensureMessageButtons();
    }, 80);
  }

  function parseCommandTokens(text) {
    const parsedByFactory = factoryCommands()?.parseTokens?.(text);
    if (Array.isArray(parsedByFactory)) return parsedByFactory;
    const tokens = [];
    const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
    let match;
    while ((match = re.exec(text))) {
      tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1"));
    }
    return tokens;
  }

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function resolveCharacterToken(token, roster) {
    const normalized = normalizeName(token);
    if (["all", "everyone", "*"].includes(normalized)) return roster;
    const exact = roster.filter((character) => normalizeName(character.name) === normalized || normalizeName(character.id) === normalized);
    if (exact.length === 1) return exact;
    const fuzzy = roster.filter((character) => normalizeName(character.name).includes(normalized));
    if (fuzzy.length === 1) return fuzzy;
    if (exact.length || fuzzy.length) throw new Error(`Character name is ambiguous: ${token}`);
    throw new Error(`Character not found: ${token}`);
  }

  function selectRange(messages, tokens) {
    const joined = tokens.join(" ").trim().toLowerCase();
    if (!joined) throw new Error("Range is required.");
    if (joined === "all") return messages;
    if (tokens[0]?.toLowerCase() === "last") {
      const n = Math.max(0, Math.floor(Number(tokens[1])));
      if (!n) throw new Error("Use /presence ... last <number>.");
      return messages.slice(-n);
    }
    if (tokens[0]?.toLowerCase() === "from" && tokens[2]?.toLowerCase() === "to") {
      return selectIndexRange(messages, Number(tokens[1]), Number(tokens[3]));
    }
    const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dash) return selectIndexRange(messages, Number(dash[1]), Number(dash[2]));
    const single = Number(joined);
    if (Number.isInteger(single) && single > 0) return selectIndexRange(messages, single, single);
    throw new Error(`Unsupported range: ${tokens.join(" ")}`);
  }

  function selectIndexRange(messages, start, end) {
    const a = Math.max(1, Math.min(start, end));
    const b = Math.min(messages.length, Math.max(start, end));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > messages.length) throw new Error("Range is outside the loaded chat.");
    return messages.slice(a - 1, b);
  }

  async function patchMessagesInBatches(tasks) {
    let index = 0;
    const workers = Array.from({ length: Math.min(PATCH_CONCURRENCY, tasks.length) }, async () => {
      while (index < tasks.length) {
        const task = tasks[index++];
        await task();
      }
    });
    await Promise.all(workers);
  }

  async function runPresenceCommand(raw) {
    const tokens = parseCommandTokens(raw.replace(/^\/presence\b/i, "").trim());
    const action = tokens.shift()?.toLowerCase();
    if (!["set", "unset", "remove"].includes(action)) {
      throw new Error("Usage: /presence <set|unset> <character> <range>");
    }
    const charToken = tokens.shift();
    if (!charToken) throw new Error("Character name is required.");
    const chatId = readActiveChatId();
    if (!chatId) throw new Error("No active chat.");

    const [chat, messages] = await Promise.all([getChat(chatId), getMessages(chatId)]);
    const roster = await getRoster(chat);
    const rosterIds = roster.map((character) => character.id);
    if (!rosterIds.length) throw new Error("This chat has no character roster.");
    const targets = resolveCharacterToken(charToken, roster);
    const targetIds = new Set(targets.map((character) => character.id));
    const selected = selectRange(messages, tokens).filter((message) => message?.id);
    if (!selected.length) throw new Error("No messages matched that range.");

    await patchMessagesInBatches(
      selected.map((message) => async () => {
        const present = getPresenceIds(message, rosterIds);
        if (action === "set") {
          for (const id of targetIds) present.add(id);
        } else {
          for (const id of targetIds) present.delete(id);
        }
        await patchMessagePresence(chatId, message.id, Array.from(present), rosterIds);
      }),
    );
    showToast(`Presence ${action}: ${targets.map((c) => c.name).join(", ")} across ${selected.length} message(s).`);
  }

  function findInputRoot() {
    return Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input"))
      .filter((el) => el instanceof HTMLElement && el.querySelector("textarea.mari-chat-input-textarea, textarea"))
      .find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
  }

  function clearTextarea(textarea) {
    textarea.value = "";
    textarea.style.height = "auto";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
  }

  function consumePresenceCommandFromTextarea(textarea, event) {
    const value = textarea?.value || "";
    if (!/^\/presence(?:\s|$)/i.test(value.trim())) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    const raw = value.trim();
    clearTextarea(textarea);
    runPresenceCommand(raw).catch((error) => {
      showToast(error?.message || "Presence command failed.", "error");
      warn("presence command failed", error);
    });
    return true;
  }

  function installCommandInterceptors() {
    addListener(
      document,
      "keydown",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement)) return;
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
        consumePresenceCommandFromTextarea(target, event);
      },
      true,
    );
    addListener(
      document,
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest("button.mari-chat-send-btn, button[title='Send'], button[aria-label='Send']");
        if (!button) return;
        const root = findInputRoot();
        const textarea = root?.querySelector("textarea.mari-chat-input-textarea, textarea");
        if (textarea) consumePresenceCommandFromTextarea(textarea, event);
      },
      true,
    );
  }

  function addListener(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    state.cleanups.push(() => target.removeEventListener(event, handler, options));
  }

  function installStyles() {
    const css = `
      .${BUTTON_CLASS} {
        width: 1.45em;
        height: 1.45em;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid color-mix(in srgb, var(--marinara-chat-chrome-button-border-active, var(--border)) 45%, transparent);
        border-radius: 0.35rem;
        background: transparent;
        color: var(--marinara-chat-chrome-button-text, var(--muted-foreground));
        font-size: 0.72rem;
        font-weight: 800;
        line-height: 1;
        padding: 0;
      }
      .${BUTTON_CLASS}:hover {
        background: var(--marinara-chat-chrome-highlight-bg-hover, var(--accent));
        color: var(--marinara-chat-chrome-button-text-hover, var(--foreground));
      }
      .${POPOVER_CLASS} {
        position: fixed;
        z-index: 10000;
        max-height: min(28rem, calc(100vh - 2rem));
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--popover, var(--background));
        color: var(--popover-foreground, var(--foreground));
        box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 0.32);
        padding: 0.55rem;
        font-size: 0.78rem;
      }
      .${POPOVER_CLASS} .mp-head,
      .${POPOVER_CLASS} .mp-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.4rem;
      }
      .${POPOVER_CLASS} .mp-head {
        margin-bottom: 0.45rem;
      }
      .${POPOVER_CLASS} button {
        border: 1px solid var(--border);
        border-radius: 0.35rem;
        background: var(--secondary);
        color: var(--foreground);
        padding: 0.25rem 0.45rem;
        font-size: 0.72rem;
      }
      .${POPOVER_CLASS} .mp-close {
        width: 1.45rem;
        height: 1.45rem;
        padding: 0;
      }
      .${POPOVER_CLASS} .mp-list {
        display: grid;
        gap: 0.25rem;
        margin-bottom: 0.5rem;
      }
      .${POPOVER_CLASS} .mp-row {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        min-width: 0;
        border-radius: 0.35rem;
        padding: 0.25rem 0.2rem;
      }
      .${POPOVER_CLASS} .mp-row:hover {
        background: var(--accent);
      }
      .${POPOVER_CLASS} .mp-row span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${POPOVER_CLASS} .mp-loading,
      .${POPOVER_CLASS} .mp-error,
      .${POPOVER_CLASS} .mp-empty {
        color: var(--muted-foreground);
        padding: 0.25rem;
      }
      .${POPOVER_CLASS} .mp-error {
        color: var(--destructive);
      }
      .${TOAST_CLASS} {
        position: fixed;
        right: 1rem;
        bottom: 1rem;
        z-index: 10001;
        max-width: min(24rem, calc(100vw - 2rem));
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--popover, var(--background));
        color: var(--popover-foreground, var(--foreground));
        box-shadow: 0 0.8rem 2rem rgb(0 0 0 / 0.25);
        padding: 0.55rem 0.7rem;
        font-size: 0.78rem;
      }
      .${TOAST_CLASS}[hidden] {
        display: none;
      }
      .${TOAST_CLASS}[data-tone="error"] {
        border-color: color-mix(in srgb, var(--destructive) 55%, var(--border));
        color: var(--destructive);
      }
    `;
    if (typeof marinara !== "undefined" && marinara?.addStyle) marinara.addStyle(css);
    else {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function install() {
    state.disposed = false;
    installStyles();
    installGenerateInterceptor();
    try {
      state.extensionRegistration = alDente()?.registerExtension?.({
        id: "presence",
        name: EXTENSION_NAME,
        version: "0.1.0",
        capabilities: [
          "fetch-interceptor",
          "generation-monitor",
          "message-tracking",
          "presence-filtering",
          "presence-command",
          "shared-command",
          "character-parser",
        ],
      }) || null;
    } catch {}
    try {
      state.serviceRegistration = alDente()?.services?.register?.("presence", {
        version: "0.1.0",
        generateWithPresence: (input, init, body, nextFetch) => handleGenerate(input, init || {}, body || {}, nextFetch || baseFetch),
        getDebug: () => state.debug,
        setDebug: (enabled) => {
          state.debug = enabled === true;
          localStorage.setItem(DEBUG_STORAGE_KEY, state.debug ? "true" : "false");
          console.info(`[${EXTENSION_NAME}] debug ${state.debug ? "enabled" : "disabled"}`);
          return state.debug;
        },
        runPresenceCommand,
      }, {
        owner: EXTENSION_NAME,
        version: "0.1.0",
        capabilities: ["generation-presence", "message-presence", "commands"],
      }) || null;
    } catch {}
    try {
      state.commandRegistration = factoryCommands()?.register?.({
        id: "presence:command",
        name: "presence",
        source: EXTENSION_NAME,
        description: "Set or unset per-message character presence.",
        handler: async ({ raw }) => {
          try {
            await runPresenceCommand(raw);
          } catch (error) {
            showToast(error?.message || "Presence command failed.", "error");
            warn("presence command failed", error);
            throw error;
          }
        },
      }) || null;
    } catch {}
    if (!state.commandRegistration) installCommandInterceptors();
    ensureMessageButtons();
    state.observer = new MutationObserver(scheduleButtonScan);
    if (document.body) state.observer.observe(document.body, { childList: true, subtree: true });
    addListener(document, "mousedown", (event) => {
      if (!state.popover) return;
      if (event.target instanceof Node && state.popover.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(`.${BUTTON_CLASS}`)) return;
      closePopover();
    });
    log("installed");
  }

  function uninstall() {
    state.disposed = true;
    for (const registration of state.fetchInterceptorRegistrations.splice(0)) {
      try {
        registration?.unregister?.();
      } catch {}
    }
    try { state.serviceRegistration?.unregister?.(); } catch {}
    state.serviceRegistration = null;
    try { state.commandRegistration?.unregister?.(); } catch {}
    state.commandRegistration = null;
    try { state.extensionRegistration?.unregister?.(); } catch {}
    state.extensionRegistration = null;
    if (state.legacyFetchInstalled && state.originalFetch) {
      window.fetch = state.originalFetch;
    }
    state.legacyFetchInstalled = false;
    state.originalFetch = null;
    if (state.observer) state.observer.disconnect();
    state.observer = null;
    if (state.scanTimer) window.clearTimeout(state.scanTimer);
    state.scanTimer = null;
    for (const cleanup of state.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {}
    }
    closePopover();
    document.querySelectorAll(`.${BUTTON_CLASS}, .${TOAST_CLASS}`).forEach((el) => el.remove());
    state.chatCache.clear();
    state.characterCache.clear();
    if (window.__marinaraPresence?.uninstall === uninstall) {
      delete window.__marinaraPresence;
    }
  }

  install();
  if (typeof marinara !== "undefined" && marinara?.onCleanup) marinara.onCleanup(uninstall);
  window.__marinaraPresence = {
    version: "0.1.0",
    generateWithPresence: (input, init, body, nextFetch) => handleGenerate(input, init || {}, body || {}, nextFetch || baseFetch),
    getDebug: () => state.debug,
    setDebug: (enabled) => {
      state.debug = enabled === true;
      localStorage.setItem(DEBUG_STORAGE_KEY, state.debug ? "true" : "false");
      console.info(`[${EXTENSION_NAME}] debug ${state.debug ? "enabled" : "disabled"}`);
      return state.debug;
    },
    uninstall,
    runPresenceCommand,
  };
  window.dispatchEvent(new CustomEvent("marinara-extension-ready", { detail: { name: EXTENSION_NAME } }));
})();

  });
}
