// Generated from packages branch source by the catalog rebuild workflow.
const PACKAGE_ID = "group-smart-order";
const TAG_NAME = "marinara-capability-group-smart-order";
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

  const EXTENSION_NAME = "Group Smart Order";
  const PERSONA_TOKEN = "__persona__";
  const MAX_RECENT_MESSAGES = 5;
  const MAX_QUEUE_ITEMS = 64;
  const QUEUE_VALIDATION_MESSAGE_LIMIT = MAX_QUEUE_ITEMS + 4;
  const INDICATOR_CLASS = "mari-group-smart-order";
  const SELECTOR_MODE_STORAGE_KEY = "marinara-group-smart-order-selector-mode";
  const DIRECT_AGENT_STORAGE_KEY = "marinara-group-smart-order-direct-agent";
  const INCLUDE_PERSONA_STORAGE_KEY = "marinara-group-smart-order-include-persona";
  const MAIN_SELECTOR_MAX_TOKENS = 512;
  const ENABLE_TIMING_LOGS = false;
  const OAI_COMPATIBLE_PROVIDERS = new Set(["openai", "custom", "mistral", "cohere", "openrouter", "nanogpt", "xai"]);

  const state = {
    originalFetch: null,
    selectorConnectionMode: localStorage.getItem(SELECTOR_MODE_STORAGE_KEY) === "agent" ? "agent" : "main",
    directAgentConnection: localStorage.getItem(DIRECT_AGENT_STORAGE_KEY) === "true",
    includePersonaCandidates: localStorage.getItem(INCLUDE_PERSONA_STORAGE_KEY) !== "false",
    queues: new Map(),
    queueMeta: new Map(),
    controlLocks: new Map(),
    contextCache: new Map(),
    ineligibleChats: new Map(),
    lastActiveChatId: "",
    indicator: null,
    indicatorTimer: null,
    mountObserver: null,
    mountRetryTimer: null,
    uiSyncTimer: null,
    extensionRegistration: null,
    serviceRegistration: null,
    fetchInterceptorRegistration: null,
    postOnlyClickGuard: null,
    legacyFetchInstalled: false,
    loadingContext: new Set(),
    refreshPromises: new Map(),
    pendingEndRefresh: new Set(),
    characterCache: new Map(),
    connectionsCache: null,
    directEligibility: null,
    loadingDirectEligibility: false,
    lastSelectorDebug: null,
    lastSelectorReasoning: null,
    reasoningModal: null,
    defaultAgentConnectionId: null,
    defaultAgentConnectionLoaded: false,
  };

  function log(...args) {
    console.info(`[${EXTENSION_NAME}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${EXTENSION_NAME}]`, ...args);
  }

  function nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }

  function timed(label, start, details = {}) {
    if (!ENABLE_TIMING_LOGS) return;
    console.info(`[${EXTENSION_NAME} timing] ${label}`, {
      ms: Math.round((nowMs() - start) * 10) / 10,
      ...details,
    });
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

  function normalizeApiPath(path) {
    return path.startsWith("/") ? path : `/${path}`;
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
    const parser = factoryParsers();
    if (parser?.maybeJson) return parser.maybeJson(value, fallback);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function getMetadata(chat) {
    const sharedMetadata = factoryParsers()?.chatMetadata?.(chat);
    if (sharedMetadata && typeof sharedMetadata === "object" && !Array.isArray(sharedMetadata)) return sharedMetadata;
    const metadata = parseMaybeJson(chat?.metadata, {});
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  }

  function normalizeCharacterRow(row) {
    if (!row || typeof row !== "object") return row;
    return { ...row, data: parseMaybeJson(row.data, row.data || {}) };
  }

  function readCharacterName(character, fallback = "") {
    const data = parseMaybeJson(character?.data, character?.data || {});
    const candidates = [
      character?.name,
      data?.name,
      character?.card?.name,
      character?.character?.name,
      character?.displayName,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return fallback;
  }

  function readCharacterDescription(character) {
    const sharedDescription = factoryParsers()?.readCharacterDescription?.(character);
    if (sharedDescription) return sharedDescription;
    const data = parseMaybeJson(character?.data, character?.data || {});
    const extensions = parseMaybeJson(data?.extensions, data?.extensions || {});
    return [character?.description, data?.description, extensions?.backstory, character?.data?.description].find(
      (value) => typeof value === "string" && value.trim(),
    ) || "";
  }

  function getCharacterIds(chat) {
    const sharedIds = factoryParsers()?.getCharacterIds?.(chat);
    if (Array.isArray(sharedIds)) return sharedIds.filter((id) => typeof id === "string" && id.trim());
    const ids = parseMaybeJson(chat?.characterIds, []);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.trim()) : [];
  }

  function activeCharacterIdsForChat(chat) {
    const ids = getCharacterIds(chat);
    const activeIds = factoryParsers()?.activeCharacterIdsForChat?.(chat, ids);
    if (Array.isArray(activeIds)) return activeIds.filter((id) => typeof id === "string" && id.trim());
    const inactiveIds = Array.isArray(getMetadata(chat).inactiveCharacterIds)
      ? new Set(getMetadata(chat).inactiveCharacterIds.filter((id) => typeof id === "string"))
      : new Set();
    return ids.filter((id) => !inactiveIds.has(id));
  }

  function isEligibleChat(chat) {
    const meta = getMetadata(chat);
    return (
      chat?.mode === "roleplay" &&
      activeCharacterIdsForChat(chat).length > 1 &&
      meta.groupChatMode === "individual" &&
      meta.groupResponseOrder === "smart"
    );
  }

  function ineligibleReasonForChat(chat) {
    if (!chat) return "missing-chat";
    const meta = getMetadata(chat);
    if (chat.mode !== "roleplay") return "not-roleplay";
    if (meta.groupChatMode !== "individual") return "not-individual-group";
    if (meta.groupResponseOrder !== "smart") return "not-smart-order";
    if (activeCharacterIdsForChat(chat).length <= 1) return "single-active-member";
    return "";
  }

  function normalizeText(value) {
    return String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function contentOf(message) {
    const raw = message?.content;
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) {
      return raw.map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "")).join(" ");
    }
    return "";
  }

  function speakerName(message, charactersById, persona) {
    if (message?.role === "user") return persona?.name || "User";
    if (message?.characterId && charactersById.has(message.characterId)) {
      return charactersById.get(message.characterId).name || "Character";
    }
    if (message?.role === "assistant") return "Assistant";
    return message?.role || "Message";
  }

  function itemLabel(item) {
    return item?.name || (item?.type === "persona" ? "Persona" : "Character");
  }

  function queueMetaFor(chatId) {
    return state.queueMeta.get(chatId) || null;
  }

  function nextQueueIndex(chatId, queue = queueFor(chatId)) {
    const index = Number(queueMetaFor(chatId)?.nextIndex ?? 0);
    if (!Number.isFinite(index) || index < 0) return 0;
    return Math.min(Math.floor(index), queue.length);
  }

  function nextQueueItem(chatId, queue = queueFor(chatId)) {
    return queue[nextQueueIndex(chatId, queue)] || null;
  }

  function npcPrefix(queue, startIndex = 0) {
    const ids = [];
    for (const item of (queue || []).slice(Math.max(0, startIndex))) {
      if (item.type === "persona") break;
      if (item.type === "character" && item.id) ids.push(item.id);
    }
    return ids;
  }

  function queueFor(chatId) {
    return state.queues.get(chatId) || [];
  }

  function latestChatMessage(context) {
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]) return messages[index];
    }
    return null;
  }

  function textFingerprint(value) {
    const text = String(value || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    }
    return `${text.length}:${hash.toString(36)}`;
  }

  function messageMarker(message) {
    if (!message) return { empty: true };
    const rowid = Number(message.rowid);
    return {
      id: String(message.id || ""),
      rowid: Number.isFinite(rowid) ? rowid : null,
      role: String(message.role || ""),
      characterId: String(message.characterId || ""),
      createdAt: String(message.createdAt || ""),
      content: textFingerprint(contentOf(message)),
    };
  }

  function markerKey(marker) {
    if (!marker || marker.empty) return "empty";
    return [marker.id, marker.rowid ?? "", marker.role, marker.characterId, marker.createdAt, marker.content].join("|");
  }

  function sameMarker(a, b) {
    return markerKey(a) === markerKey(b);
  }

  function queueAnchor(context) {
    return messageMarker(latestChatMessage(context));
  }

  function findMessageMarkerIndex(messages, marker) {
    if (!marker) return -1;
    return (Array.isArray(messages) ? messages : []).findIndex((message) => sameMarker(messageMarker(message), marker));
  }

  function queueProgressFromContext(chatId, queue, context) {
    const meta = state.queueMeta.get(chatId);
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    if (!meta?.generatedOn) {
      return { valid: Boolean(meta?.anchor && sameMarker(meta.anchor, queueAnchor(context))), nextIndex: nextQueueIndex(chatId, queue) };
    }

    const startIndex = findMessageMarkerIndex(messages, meta.generatedOn);
    if (startIndex < 0) {
      return { valid: false, nextIndex: 0 };
    }

    let nextIndex = 0;
    let skippedPendingUserBasis = false;
    for (const message of messages.slice(startIndex + 1)) {
      if (meta.generatedWithPendingUser && !skippedPendingUserBasis) {
        if (message?.role === "user") {
          skippedPendingUserBasis = true;
          continue;
        }
        if (message?.role === "assistant") return { valid: false, nextIndex };
      }
      if (message?.role === "assistant" && message.characterId) {
        skippedPendingUserBasis = true;
        const expected = queue[nextIndex] || null;
        if (expected?.type !== "character" || expected.id !== message.characterId) return { valid: false, nextIndex };
        nextIndex += 1;
      } else if (message?.role === "user") {
        skippedPendingUserBasis = true;
        const expected = queue[nextIndex] || null;
        if (expected?.type !== "persona") return { valid: false, nextIndex };
        nextIndex += 1;
      }
    }

    return { valid: true, nextIndex: Math.min(nextIndex, queue.length) };
  }

  function queueMatchesContext(chatId, context, queue = queueFor(chatId)) {
    return queueProgressFromContext(chatId, queue, context).valid;
  }

  function setQueue(chatId, queue, options = {}) {
    const clean = [];
    for (const item of queue || []) {
      if (!item || !item.type) continue;
      if (item.type === "persona") {
        clean.push(item);
        break;
      }
      if (item.type === "character" && item.id) {
        clean.push(item);
      }
      if (clean.length >= MAX_QUEUE_ITEMS) break;
    }
    if (clean.length) {
      const previousMeta = state.queueMeta.get(chatId);
      const requestedIndex = Number(options.nextIndex ?? previousMeta?.nextIndex ?? 0);
      const nextIndex = Number.isFinite(requestedIndex) ? Math.min(Math.max(0, Math.floor(requestedIndex)), clean.length) : 0;
      state.queues.set(chatId, clean);
      state.queueMeta.set(chatId, {
        anchor: options.anchor || (options.context ? queueAnchor(options.context) : previousMeta?.anchor || queueAnchor(null)),
        generatedOn:
          options.generatedOn || (options.context && options.resetGeneratedOn ? queueAnchor(options.context) : previousMeta?.generatedOn),
        generatedWithPendingUser:
          options.resetGeneratedOn === true ? options.generatedWithPendingUser === true : previousMeta?.generatedWithPendingUser === true,
        nextIndex,
        updatedAt: new Date().toISOString(),
      });
    } else {
      state.queues.delete(chatId);
      state.queueMeta.delete(chatId);
    }
    scheduleIndicatorUpdate();
    return clean;
  }

  function consumeCharacter(chatId, message) {
    const characterId = message?.characterId;
    if (!characterId) return false;
    const current = queueFor(chatId);
    if (!current.length) return false;
    const index = nextQueueIndex(chatId, current);
    const first = current[index] || null;
    if (first?.type === "character" && first.id === characterId) {
      setQueue(chatId, current, { anchor: messageMarker(message), nextIndex: index + 1 });
      return index + 1 >= current.length;
    }
    warn("saved character did not match the next queued speaker; clearing queue", { expected: first, characterId });
    setQueue(chatId, []);
    return false;
  }

  async function getChatContext(chatId, options = {}) {
    const totalStart = nowMs();
    const chatStart = nowMs();
    factoryIdentity()?.clearCache?.("chats");
    const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
    timed("context chat fetch", chatStart, { chatId });
    if (!isEligibleChat(chat)) {
      state.ineligibleChats.set(chatId, {
        reason: ineligibleReasonForChat(chat),
        activeCount: activeCharacterIdsForChat(chat).length,
        updatedAt: new Date().toISOString(),
      });
      state.contextCache.delete(chatId);
      setQueue(chatId, []);
      return null;
    }
    state.ineligibleChats.delete(chatId);

    const activeIds = activeCharacterIdsForChat(chat);
    const parallelStart = nowMs();
    const [allCharacters, persona, messages] = await Promise.all([
      api("/characters"),
      chat.personaId ? api(`/characters/personas/${encodeURIComponent(chat.personaId)}`).catch(() => null) : null,
      api(`/chats/${encodeURIComponent(chatId)}/messages?limit=${QUEUE_VALIDATION_MESSAGE_LIMIT}`).catch(() => []),
    ]);
    timed("context base parallel fetch", parallelStart, {
      chatId,
      characters: Array.isArray(allCharacters) ? allCharacters.length : 0,
      messages: Array.isArray(messages) ? messages.length : 0,
      persona: Boolean(persona),
    });

    const normalizeStart = nowMs();
    const listedCharactersById = new Map(
      (Array.isArray(allCharacters) ? allCharacters : [])
        .filter((character) => character?.id && activeIds.includes(character.id))
        .map((character) => [character.id, normalizeCharacterRow(character)]),
    );
    timed("context character list normalize", normalizeStart, { chatId, activeCharacters: activeIds.length });
    const detailStart = nowMs();
    let missingCharacterDetails = 0;
    const detailRows = await Promise.all(
      activeIds.map(async (id) => {
        const listed = listedCharactersById.get(id);
        if (readCharacterName(listed, "")) return listed;
        if (state.characterCache.has(id)) return state.characterCache.get(id);
        missingCharacterDetails += 1;
        let detailRow = null;
        const identity = factoryIdentity();
        if (identity?.getCharacter) detailRow = await identity.getCharacter(id).catch(() => null);
        if (!detailRow) detailRow = await api(`/characters/${encodeURIComponent(id)}`).catch(() => listed || null);
        const detail = normalizeCharacterRow(detailRow);
        if (detail) state.characterCache.set(id, detail);
        return detail;
      }),
    );
    timed("context character detail fetch", detailStart, { chatId, fetched: missingCharacterDetails, activeCharacters: activeIds.length });
    const assembleStart = nowMs();
    const characters = activeIds
      .map((id, index) => {
        const raw = detailRows[index] || listedCharactersById.get(id);
        if (!raw) return null;
        const fallback = `Character ${index + 1}`;
        return {
          ...raw,
          id,
          name: readCharacterName(raw, fallback),
          description: readCharacterDescription(raw),
        };
      })
      .filter(Boolean);
    const charactersById = new Map(characters.map((character) => [character.id, character]));
    timed("context assemble", assembleStart, { chatId, characters: characters.length });
    if (characters.length < 2) return null;

    const context = {
      chat,
      persona,
      characters,
      charactersById,
      messages: Array.isArray(messages) ? messages : [],
    };
    if (!options.noCache) {
      state.contextCache.set(chatId, context);
      state.lastActiveChatId = chatId;
    }
    timed("context total", totalStart, { chatId, characters: characters.length, messages: context.messages.length });
    return context;
  }

  function explicitMentionQueue(body, context) {
    const mentioned = new Set((Array.isArray(body.mentionedCharacterNames) ? body.mentionedCharacterNames : []).map(normalizeText));
    const text = typeof body.userMessage === "string" ? body.userMessage : "";
    const queue = [];
    for (const character of context.characters) {
      const name = String(character.name || "");
      const normalized = normalizeText(name);
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (mentioned.has(normalized) || new RegExp(`@${escaped}(?=$|[\\s\\p{P}\\p{S}])`, "iu").test(text)) {
        queue.push({ type: "character", id: character.id, name: character.name || "Character" });
      }
    }
    return queue;
  }

  function fallbackQueue(context, options = {}) {
    const lastAssistantCharacterId = [...context.messages]
      .reverse()
      .find((message) => message?.role === "assistant" && typeof message.characterId === "string")?.characterId;
    const preferred =
      context.characters.find((character) => character.id !== lastAssistantCharacterId) || context.characters[0] || null;
    const queue = preferred?.id ? [{ type: "character", id: preferred.id, name: preferred.name || "Character" }] : [];
    if (state.includePersonaCandidates && !options.requireNpcBeforePersona && context.persona?.name) {
      queue.push({ type: "persona", id: context.chat.personaId || PERSONA_TOKEN, name: context.persona.name });
    }
    return queue;
  }

  function twoCharacterShortcutQueue(context) {
    if (state.includePersonaCandidates || context.characters.length !== 2) return [];
    return fallbackQueue(context, { requireNpcBeforePersona: true });
  }

  function latestChatSpeakerRole(context) {
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const role = messages[index]?.role;
      if (role === "user" || role === "assistant") return role;
    }
    return "";
  }

  function hasIncomingPersonaMessage(body) {
    return Boolean(
      (typeof body?.userMessage === "string" && body.userMessage.trim()) ||
        (Array.isArray(body?.attachments) && body.attachments.length) ||
        body?.pendingSpatialTransition,
    );
  }

  function isTruthyFlag(value) {
    return value === true || value === "true";
  }

  async function loadConnections() {
    if (Array.isArray(state.connectionsCache)) return state.connectionsCache;
    const connections = await api("/connections").catch((error) => {
      warn("failed to load connections", error);
      return [];
    });
    state.connectionsCache = Array.isArray(connections) ? connections : [];
    return state.connectionsCache;
  }

  async function getDefaultAgentConnectionId() {
    if (state.defaultAgentConnectionLoaded) return state.defaultAgentConnectionId;
    state.defaultAgentConnectionLoaded = true;
    const connections = await loadConnections();
    const defaultAgentConnection = (Array.isArray(connections) ? connections : []).find(
      (connection) =>
        connection?.id &&
        connection.provider !== "image_generation" &&
        connection.provider !== "video_generation" &&
        isTruthyFlag(connection.defaultForAgents),
    );
    state.defaultAgentConnectionId = defaultAgentConnection?.id || null;
    return state.defaultAgentConnectionId;
  }

  async function getSelectorConnection(context) {
    const connectionId =
      state.selectorConnectionMode === "agent" ? await getDefaultAgentConnectionId() : context.chat?.connectionId || null;
    if (!connectionId) return null;
    const connections = await loadConnections();
    return connections.find((connection) => connection?.id === connectionId) || { id: connectionId };
  }

  async function getSelectorConnectionId(context) {
    return (await getSelectorConnection(context))?.id || null;
  }

  function connectionLabel(connection) {
    if (!connection) return "";
    return [connection.name || connection.label || connection.id, connection.provider, connection.model].filter(Boolean).join(" / ");
  }

  function contentBlockText(value, fields) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        for (const field of fields) {
          if (typeof part[field] === "string") return part[field];
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  function rawResultContent(result) {
    const candidates = [
      result?.content,
      result?.text,
      result?.response,
      result?.message?.content,
      result?.choices?.[0]?.message?.content,
      result?.choices?.[0]?.text,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") return candidate;
      const blockText = contentBlockText(candidate, ["text", "content"]);
      if (blockText) return blockText;
    }
    return "";
  }

  function rawResultThinking(result) {
    const candidates = [
      result?.thinking,
      result?.reasoning,
      result?.reasoning_content,
      result?.message?.thinking,
      result?.message?.reasoning,
      result?.message?.reasoning_content,
      result?.choices?.[0]?.message?.thinking,
      result?.choices?.[0]?.message?.reasoning,
      result?.choices?.[0]?.message?.reasoning_content,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string") return candidate;
      const blockText = contentBlockText(candidate, ["thinking", "reasoning", "reasoning_content"]);
      if (blockText) return blockText;
    }
    return contentBlockText(result?.choices?.[0]?.message?.content, ["thinking", "reasoning", "reasoning_content"]);
  }

  function approxTokens(text) {
    const value = String(text || "").trim();
    return value ? Math.ceil(value.length / 4) : 0;
  }

  function personaCandidateId(context) {
    return context?.chat?.personaId || context?.persona?.id || PERSONA_TOKEN;
  }

  function selectorMaxTokensForMode() {
    return state.selectorConnectionMode === "main" ? MAIN_SELECTOR_MAX_TOKENS : null;
  }

  function selectorMaxTokensLabel(value) {
    return Number.isFinite(value) ? value : "connection-default";
  }

  function hasStoredApiKey(connection) {
    return Boolean(
      String(connection?.apiKey || "").trim() ||
        String(connection?.apiKeyEncrypted || "").trim() ||
        String(connection?.keyConfigured || "").trim(),
    );
  }

  function isDirectAgentConnectionEligible(connection) {
    return Boolean(
      connection?.baseUrl &&
        connection?.model &&
        OAI_COMPATIBLE_PROVIDERS.has(connection.provider) &&
        !hasStoredApiKey(connection),
    );
  }

  function directChatCompletionsUrl(connection) {
    const base = String(connection?.baseUrl || "").replace(/\/+$/, "");
    if (!base) return "";
    return `${base}/chat/completions`;
  }

  async function directAgentChatComplete(connection, messages) {
    const response = await baseFetch(directChatCompletionsUrl(connection), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        model: connection.model,
        messages,
        stream: false,
        temperature: 0.2,
        top_p: 1,
      }),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { rawText: text };
    }
    if (!response.ok) {
      const error = new Error(json?.error?.message || json?.error || text || `${response.status} ${response.statusText}`);
      error.status = response.status;
      error.body = json;
      throw error;
    }
    return json;
  }

  function parseSelectorOutput(text, context) {
    const raw = String(text || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end < start) return { queue: [], parsed: false };

    let parsed;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return { queue: [], parsed: false };
    }
    if (!Array.isArray(parsed)) return { queue: [], parsed: false };

    const validIds = new Set(context.characters.map((character) => character.id));
    const idsByName = new Map(context.characters.map((character) => [normalizeText(character.name), character.id]));
    const namesById = new Map(context.characters.map((character) => [character.id, character.name || "Character"]));
    const personaId = personaCandidateId(context);
    const personaName = state.includePersonaCandidates ? normalizeText(context.persona?.name || "") : "";
    const queue = [];

    for (const item of parsed) {
      const value =
        typeof item === "string" || typeof item === "number"
          ? String(item).trim()
          : item && typeof item === "object"
            ? String(item.id ?? item.characterId ?? item.name ?? item.value ?? "").trim()
            : "";
      if (!value) continue;
      const normalized = normalizeText(value);
      if (
        state.includePersonaCandidates &&
        (value === personaId || value === PERSONA_TOKEN || normalized === "persona" || (personaName && normalized === personaName))
      ) {
        queue.push({ type: "persona", id: personaId, name: context.persona?.name || "Persona" });
        break;
      }
      const id = validIds.has(value) ? value : idsByName.get(normalized);
      if (id) queue.push({ type: "character", id, name: namesById.get(id) || value });
      if (queue.length >= MAX_QUEUE_ITEMS) break;
    }

    return { queue, parsed: true };
  }

  function buildSelectorMessages(context, options = {}) {
    const personaName = context.persona?.name || "User";
    const personaId = personaCandidateId(context);
    const candidateCount = context.characters.length + (state.includePersonaCandidates && context.persona?.name ? 1 : 0);
    const queueTargetCount = Math.max(1, candidateCount) * 2;
    const transcriptMessages = context.messages
      .filter((message) => message?.role === "user" || message?.role === "assistant")
      .slice(-MAX_RECENT_MESSAGES);

    if (typeof options.pendingUserMessage === "string" && options.pendingUserMessage.trim()) {
      transcriptMessages.push({ role: "user", characterId: null, content: options.pendingUserMessage });
    }

    const recentTranscript = transcriptMessages
      .map((message) => {
        const content = contentOf(message).replace(/\s+/g, " ").trim().slice(0, 900);
        return content ? `${speakerName(message, context.charactersById, context.persona)}: ${content}` : "";
      })
      .filter(Boolean)
      .join("\n");

    const characterCandidates = context.characters.map((character) =>
      [
        `- id: ${character.id}`,
        `  name: ${character.name || "Character"}`,
        `  talkativeness: ${Math.round(Number(character.talkativeness ?? 0.5) * 100)}%`,
        character.personality ? `  personality: ${String(character.personality).slice(0, 500)}` : null,
        character.description ? `  description: ${String(character.description).slice(0, 500)}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    const personaCandidate =
      state.includePersonaCandidates && context.persona?.name
        ? [
            `- id: ${personaId}`,
            `  name: ${personaName}`,
            context.persona?.personality ? `  personality: ${String(context.persona.personality).slice(0, 500)}` : null,
            context.persona?.description ? `  description: ${String(context.persona.description).slice(0, 500)}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        : "";
    const candidates = [
      ...characterCandidates,
      personaCandidate,
    ].filter(Boolean).join("\n");

    const systemLines = [
      "You are a hidden response orchestrator for a roleplay group chat.",
      "This is a fast routing decision, not a writing task. Do not analyze at length; make a quick choice and answer immediately.",
      "Choose which character or characters should respond next, based on the latest user message, recent scene context, relevance, personality, and who has spoken recently.",
      options.requireNpcBeforePersona && state.includePersonaCandidates ? `The candidate ${personaId} cannot be the next person to speak.` : "",
      `Choose the next ${queueTargetCount} in the order they should speak. That can include characters speaking more than once.`,
      "Do not always choose the first character. Avoid making the same character speak twice in a row unless the context clearly calls for it.",
      `Return ONLY a valid JSON array of character IDs, such as ["character-id"]. No prose, no object wrapper, no markdown.`,
    ].filter(Boolean);

    return [
      { role: "system", content: systemLines.join("\n") },
      {
        role: "user",
        content: [
          "<candidates>",
          candidates,
          "</candidates>",
          "<recent_transcript>",
          recentTranscript || "No recent transcript.",
          "</recent_transcript>",
        ].join("\n"),
      },
    ];
  }

  async function selectWithConnection(context, options = {}) {
    const totalStart = nowMs();
    const connectionStart = nowMs();
    const connection = await getSelectorConnection(context);
    const connectionId = connection?.id || null;
    timed("selector connection resolve", connectionStart, {
      chatId: context.chat?.id,
      mode: state.selectorConnectionMode,
      connectionId: connectionId || "",
      connection: connectionLabel(connection),
      provider: connection?.provider || "",
      model: connection?.model || "",
    });
    if (!connectionId) {
      warn(`no ${state.selectorConnectionMode} selector connection found; using fallback queue`);
      return [];
    }
    try {
      const promptStart = nowMs();
      const messages = buildSelectorMessages(context, options);
      timed("selector prompt build", promptStart, {
        chatId: context.chat?.id,
        promptMessages: messages.length,
        promptChars: messages.reduce((sum, message) => sum + String(message.content || "").length, 0),
        requireNpcBeforePersona: options.requireNpcBeforePersona === true,
        mode: state.selectorConnectionMode,
      });
      const modelStart = nowMs();
      const selectorMaxTokens = selectorMaxTokensForMode();
      const parameters = {
        temperature: 0.2,
        topP: 1,
      };
      if (Number.isFinite(selectorMaxTokens)) parameters.maxTokens = selectorMaxTokens;
      const directRequested = state.selectorConnectionMode === "agent" && state.directAgentConnection;
      const directEligible = directRequested && isDirectAgentConnectionEligible(connection);
      const result = directEligible
        ? await directAgentChatComplete(connection, messages)
        : await api("/generate/raw", {
            method: "POST",
            body: JSON.stringify({
              connectionId,
              messages,
              parameters,
              streaming: false,
            }),
          });
      const content = rawResultContent(result);
      const thinking = rawResultThinking(result);
      state.lastSelectorReasoning = {
        chatId: context.chat?.id || "",
        mode: state.selectorConnectionMode,
        route: directEligible ? "direct-agent" : "marinara-raw",
        directRequested,
        directEligible,
        connectionId,
        connection: connectionLabel(connection),
        reasoning: thinking,
        response: content,
        reasoningChars: thinking.length,
        responseChars: content.length,
        updatedAt: new Date().toISOString(),
      };
      scheduleIndicatorUpdate();
      state.lastSelectorDebug = {
        chatId: context.chat?.id || "",
        mode: state.selectorConnectionMode,
        route: directEligible ? "direct-agent" : "marinara-raw",
        directRequested,
        directEligible,
        connectionId,
        connection: connectionLabel(connection),
        maxTokens: selectorMaxTokensLabel(selectorMaxTokens),
        responseChars: content.length,
        responseApproxTokens: approxTokens(content),
        thinkingChars: thinking.length,
        thinkingApproxTokens: approxTokens(thinking),
        resultKeys: result && typeof result === "object" ? Object.keys(result) : [],
        finishReason: result?.finishReason || result?.usage?.finishReason || "",
        usage: result?.usage || null,
        content: ENABLE_TIMING_LOGS ? content : "",
        thinking,
        rawResult: ENABLE_TIMING_LOGS ? result : null,
        updatedAt: new Date().toISOString(),
      };
      timed("selector raw model call", modelStart, {
        chatId: context.chat?.id,
        route: state.lastSelectorDebug.route,
        responseChars: content.length,
        responseApproxTokens: approxTokens(content),
        thinkingChars: thinking.length,
        thinkingApproxTokens: approxTokens(thinking),
        maxTokens: selectorMaxTokensLabel(selectorMaxTokens),
        mode: state.selectorConnectionMode,
        connectionId,
        connection: state.lastSelectorDebug.connection,
        resultKeys: result && typeof result === "object" ? Object.keys(result).join(",") : "",
        finishReason: state.lastSelectorDebug.finishReason,
      });
      if (!content.trim()) {
        warn("selector returned empty content", {
          chatId: context.chat?.id,
          mode: state.selectorConnectionMode,
          connection: connectionLabel(connection),
          result,
        });
      }
      const parseStart = nowMs();
      const parsed = parseSelectorOutput(content, context);
      timed("selector parse", parseStart, { chatId: context.chat?.id, queueItems: parsed.queue.length, parsed: parsed.parsed });
      timed("selector total", totalStart, { chatId: context.chat?.id, queueItems: parsed.queue.length, mode: state.selectorConnectionMode });
      if (parsed.queue.length) return parsed.queue;
      return [];
    } catch (error) {
      timed("selector total failed", totalStart, { chatId: context.chat?.id, mode: state.selectorConnectionMode });
      warn("selector call failed; using fallback", error);
      return [];
    }
  }

  async function selectQueue(body, context, options = {}) {
    const totalStart = nowMs();
    const mentionStart = nowMs();
    const mentioned = explicitMentionQueue(body || {}, context);
    timed("queue explicit mention scan", mentionStart, { chatId: context.chat?.id, queueItems: mentioned.length });
    if (mentioned.length) {
      timed("queue select total", totalStart, { chatId: context.chat?.id, source: "explicit", queueItems: mentioned.length });
      return mentioned;
    }

    const shortcut = twoCharacterShortcutQueue(context);
    if (shortcut.length) {
      timed("queue select total", totalStart, { chatId: context.chat?.id, source: "two-character-shortcut", queueItems: shortcut.length });
      return shortcut;
    }

    const selected = await selectWithConnection(context, {
      requireNpcBeforePersona: options.requireNpcBeforePersona === true,
      pendingUserMessage: typeof body?.userMessage === "string" ? body.userMessage : "",
    });
    if (selected.length) {
      timed("queue select total", totalStart, { chatId: context.chat?.id, source: "selector", queueItems: selected.length });
      return selected;
    }

    const fallbackStart = nowMs();
    const fallback = fallbackQueue(context, options);
    timed("queue fallback", fallbackStart, { chatId: context.chat?.id, queueItems: fallback.length });
    timed("queue select total", totalStart, { chatId: context.chat?.id, source: "fallback", queueItems: fallback.length });
    return fallback;
  }

  async function refreshQueue(chatId, options = {}) {
    if (state.refreshPromises.has(chatId)) return state.refreshPromises.get(chatId);
    const totalStart = nowMs();
    const promise = (async () => {
      scheduleIndicatorUpdate();
      const contextStart = nowMs();
      const context = await getChatContext(chatId).catch((error) => {
        warn("failed to refresh queue", error);
        return null;
      });
      timed("refresh context load", contextStart, { chatId, foundContext: Boolean(context) });
      if (!context) {
        setQueue(chatId, []);
        timed("refresh total", totalStart, { chatId, source: "no-context", queueItems: 0 });
        return [];
      }
      const selectStart = nowMs();
      const queue = await selectQueue({}, context, options);
      timed("refresh select", selectStart, { chatId, queueItems: queue.length });
      const setStart = nowMs();
      const stored = setQueue(chatId, queue, { context, nextIndex: 0, resetGeneratedOn: true });
      timed("refresh set queue", setStart, { chatId, queueItems: stored.length });
      timed("refresh total", totalStart, { chatId, source: "refresh", queueItems: stored.length });
      return stored;
    })().finally(() => {
      state.refreshPromises.delete(chatId);
      if (state.refreshPromises.size === 0) releaseAllDisabledControls();
      scheduleIndicatorUpdate();
    });
    state.refreshPromises.set(chatId, promise);
    scheduleIndicatorUpdate();
    return promise;
  }

  function scheduleEndRefresh(chatId) {
    if (chatId) state.pendingEndRefresh.add(chatId);
  }

  function flushEndRefresh(chatId) {
    if (!chatId || !state.pendingEndRefresh.delete(chatId)) return;
    marinara.setTimeout(() => {
      refreshQueue(chatId).catch((error) => warn("failed to refresh queue after generation", error));
    }, 80);
  }

  function startSharedGeneration(chatId, body, detail = {}) {
    if (!chatId) return null;
    const id = `group-smart-order:generate:${chatId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
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
        label: "Group Smart generation",
        reason: "group-smart-order:generate",
        detail: {
          chatId,
          forCharacterId: body?.forCharacterId || "",
          ...detail,
        },
        wakeLock: {
          id,
          source: EXTENSION_NAME,
          reason: "group-smart-order:generate",
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

  function wrapSharedGenerationResponse(response, shared) {
    if (!shared) return response;
    const isSse = factorySse()?.isSseResponse?.(response)
      || Boolean(response?.body && String(response.headers?.get?.("content-type") || "").includes("text/event-stream"));
    if (!isSse) {
      finishSharedGeneration(shared, response?.ok === false ? "failed" : "finished", null, { finishGeneration: true });
      return response;
    }
    if (shared.generation?.wrapResponse) {
      return shared.generation.wrapResponse(response, {
        onDone: (type, value) => {
          if (type === "error") finishSharedGeneration(shared, "failed", value, { finishGeneration: false });
          else if (type === "cancel") finishSharedGeneration(shared, "cancelled", value, { finishGeneration: false });
          else finishSharedGeneration(shared, "finished", null, { finishGeneration: false });
        },
        onError: (error) => finishSharedGeneration(shared, "failed", error, { finishGeneration: false }),
        onCancel: (reason) => finishSharedGeneration(shared, "cancelled", reason, { finishGeneration: false }),
      });
    }
    return response;
  }

  function sseEvent(type, data) {
    return `data: ${JSON.stringify({ type, data })}\n\n`;
  }

  function handleSsePayload(chatId, payload, options = {}) {
    const event = factorySse()?.parseEventPayload?.(payload) || (() => {
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    })();
    if (!event) return;
    if (options.sharedGeneration?.generation?.event) {
      options.sharedGeneration.generation.event(event);
    } else {
      factoryMessages()?.handleSseEvent?.(chatId, event, { source: EXTENSION_NAME, generationId: options.sharedGeneration?.id || "" });
    }
    if (event?.type === "message_saved" && event.data?.role === "assistant" && event.data?.characterId) {
      if (options.refreshAfterSave) {
        scheduleEndRefresh(chatId);
      } else if (consumeCharacter(chatId, event.data) && options.refreshOnQueueEnd) {
        scheduleEndRefresh(chatId);
      }
      return;
    }
    if (event?.type === "done") {
      finishSharedGeneration(options.sharedGeneration, "finished", null, { finishGeneration: false });
      flushEndRefresh(chatId);
    } else if (event?.type === "aborted") {
      finishSharedGeneration(options.sharedGeneration, "cancelled", null, { finishGeneration: false });
    } else if (event?.type === "error") {
      finishSharedGeneration(options.sharedGeneration, "failed", event?.data || event, { finishGeneration: false });
    }
  }

  function injectQueueAndTrack(response, chatId, options = {}) {
    if (!response.body || !String(response.headers.get("content-type") || "").includes("text/event-stream")) {
      finishSharedGeneration(options.sharedGeneration, response?.ok === false ? "failed" : "finished");
      return response;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let injected = false;

    function parsePayloads(text, final = false) {
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

    const stream = new ReadableStream({
      async pull(controller) {
        if (!injected) {
          injected = true;
          if (options.injectResponseQueue !== false) {
            const queue = queueFor(chatId);
            const characterIds = npcPrefix(queue, nextQueueIndex(chatId, queue));
            if (characterIds.length) controller.enqueue(encoder.encode(sseEvent("response_queue", { characterIds })));
          }
        }
        try {
          const { done, value } = await reader.read();
          if (done) {
            const parsed = parsePayloads(buffer, true);
            for (const payload of parsed.payloads) handleSsePayload(chatId, payload, options);
            flushEndRefresh(chatId);
            finishSharedGeneration(options.sharedGeneration, "finished");
            controller.close();
            return;
          }
          const text = decoder.decode(value, { stream: true });
          buffer += text;
          const parsed = parsePayloads(buffer);
          buffer = parsed.rest;
          for (const payload of parsed.payloads) handleSsePayload(chatId, payload, options);
          controller.enqueue(value);
      } catch (error) {
        finishSharedGeneration(options.sharedGeneration, "failed", error);
        controller.error(error);
      }
    },
    cancel(reason) {
        finishSharedGeneration(options.sharedGeneration, "cancelled", reason);
        return reader.cancel(reason);
      },
    });

    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  function cloneInitWithBody(input, init, body) {
    const sharedClone = factoryFetch()?.cloneInitWithBody;
    if (sharedClone) return sharedClone(input, init, body);
    const nextInit = { ...(init || {}) };
    nextInit.method = String(nextInit.method || (typeof input !== "string" ? input?.method : "") || "POST");
    nextInit.body = JSON.stringify(body);
    const headers = new Headers(nextInit.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    nextInit.headers = headers;
    return nextInit;
  }

  function generateWithPresenceIfAvailable(input, init, body, nextFetch = baseFetch) {
    const fetchNext = typeof nextFetch === "function" ? nextFetch : baseFetch;
    const presence = alDente()?.services?.get?.("presence") || window.__marinaraPresence;
    if (presence && typeof presence.generateWithPresence === "function") {
      if (typeof presence.getDebug === "function" && presence.getDebug()) {
        console.info(`[${EXTENSION_NAME}] handing generate to Presence`, {
          chatId: body?.chatId || null,
          forCharacterId: body?.forCharacterId || null,
        });
      }
      return presence.generateWithPresence(input, init, body, fetchNext);
    }
    return fetchNext(input, init);
  }

  async function callGenerate(input, init, body, sharedGeneration, nextFetch = baseFetch) {
    try {
      return await generateWithPresenceIfAvailable(input, init, body, nextFetch);
    } catch (error) {
      finishSharedGeneration(sharedGeneration, "failed", error);
      throw error;
    }
  }

  async function handleGenerate(input, init, body, nextFetch = baseFetch) {
    const totalStart = nowMs();
    const chatId = body?.chatId;
    const sharedGeneration = chatId ? startSharedGeneration(chatId, body) : null;
    try {
    if (!chatId || body.impersonate) {
      const response = await callGenerate(input, init, body, sharedGeneration, nextFetch);
      return wrapSharedGenerationResponse(response, sharedGeneration);
    }
    if (body.regenerateMessageId || body.continueMessageId) {
      const response = await callGenerate(input, init, body, sharedGeneration, nextFetch);
      return injectQueueAndTrack(response, chatId, {
        refreshAfterSave: true,
        sharedGeneration,
        injectResponseQueue: false,
      });
    }
    if (state.refreshPromises.has(chatId)) {
      const waitStart = nowMs();
      await state.refreshPromises.get(chatId).catch(() => []);
      timed("intercept waited for refresh", waitStart, { chatId });
    }

    const contextStart = nowMs();
    const context = await getChatContext(chatId).catch((error) => {
      warn("failed to load chat context", error);
      return null;
    });
    timed("intercept context load", contextStart, { chatId, foundContext: Boolean(context) });
    if (!context) {
      const response = await callGenerate(input, init, body, sharedGeneration, nextFetch);
      return wrapSharedGenerationResponse(response, sharedGeneration);
    }

    const validationStart = nowMs();
    const hasPendingPersonaMessage = hasIncomingPersonaMessage(body);
    const isPersonaTurn = hasPendingPersonaMessage || latestChatSpeakerRole(context) === "user";
    const existingQueue = queueFor(chatId);
    const existingProgress = existingQueue.length
      ? queueProgressFromContext(chatId, existingQueue, context)
      : { valid: false, nextIndex: 0 };
    const existingQueueIsCurrent = existingProgress.valid;
    if (existingQueueIsCurrent && existingProgress.nextIndex !== nextQueueIndex(chatId, existingQueue)) {
      setQueue(chatId, existingQueue, { context, nextIndex: existingProgress.nextIndex });
    }
    timed("intercept queue validation", validationStart, {
      chatId,
      existingQueueItems: existingQueue.length,
      valid: existingQueueIsCurrent,
      nextIndex: existingProgress.nextIndex,
      isPersonaTurn,
      hasPendingPersonaMessage,
    });

    if (body.forCharacterId) {
      const directedStart = nowMs();
      const queue = existingQueueIsCurrent ? existingQueue : [];
      const first = nextQueueItem(chatId, queue);
      const followsQueue = first?.type === "character" && first.id === body.forCharacterId;
      const shouldRefreshAfterSave = !queue.length || !followsQueue;
      if (shouldRefreshAfterSave) {
        log("directed request will refresh queue after the generated message is saved", {
          requested: body.forCharacterId,
          expected: first,
          reason: queue.length ? "wrong-speaker" : existingQueue.length ? "invalid-queue" : "missing-queue",
        });
        setQueue(chatId, []);
      }
      timed("intercept directed total before generate", directedStart, { chatId, followsQueue, shouldRefreshAfterSave });
      const generateStart = nowMs();
      const response = await callGenerate(input, init, body, sharedGeneration, nextFetch);
      timed("intercept directed generate request", generateStart, { chatId, status: response.status });
      timed("intercept total", totalStart, { chatId, path: "manual-directed", followsQueue, shouldRefreshAfterSave });
      return injectQueueAndTrack(response, chatId, { refreshAfterSave: shouldRefreshAfterSave, sharedGeneration });
    }

    const selectStart = nowMs();
    let queue =
      isPersonaTurn || !existingQueueIsCurrent
        ? await selectQueue(body, context, { requireNpcBeforePersona: isPersonaTurn })
        : existingQueue;
    timed("intercept queue select/reuse", selectStart, {
      chatId,
      source: isPersonaTurn || !existingQueueIsCurrent ? "selected" : "existing",
      queueItems: queue.length,
    });
    queue = setQueue(chatId, queue, {
      context,
      nextIndex: isPersonaTurn || !existingQueueIsCurrent ? 0 : undefined,
      resetGeneratedOn: isPersonaTurn || !existingQueueIsCurrent,
      generatedWithPendingUser: hasPendingPersonaMessage,
    });

    let first = nextQueueItem(chatId, queue);
    if (first?.type === "persona") {
      const retryStart = nowMs();
      queue = await selectQueue(body, context, { requireNpcBeforePersona: true });
      timed("intercept npc-first reselect", retryStart, { chatId, queueItems: queue.length, reason: "persona-next" });
      queue = setQueue(chatId, queue, {
        context,
        nextIndex: 0,
        resetGeneratedOn: true,
        generatedWithPendingUser: hasPendingPersonaMessage,
      });
      first = nextQueueItem(chatId, queue);
    }
    if (!first) {
      const retryStart = nowMs();
      queue = await selectQueue(body, context, { requireNpcBeforePersona: true });
      timed("intercept npc-first reselect", retryStart, { chatId, queueItems: queue.length, reason: "queue-exhausted" });
      queue = setQueue(chatId, queue, {
        context,
        nextIndex: 0,
        resetGeneratedOn: true,
        generatedWithPendingUser: hasPendingPersonaMessage,
      });
      first = nextQueueItem(chatId, queue);
    }

    if (!first || first.type !== "character") {
      timed("intercept total", totalStart, { chatId, path: "fallthrough", reason: "no-character" });
      const response = await callGenerate(input, init, body, sharedGeneration, nextFetch);
      return wrapSharedGenerationResponse(response, sharedGeneration);
    }

    const directedBody = { ...body, forCharacterId: first.id };
    if (first.name) {
      directedBody.mentionedCharacterNames = Array.from(
        new Set([...(Array.isArray(body.mentionedCharacterNames) ? body.mentionedCharacterNames : []), first.name]),
      );
    }

    log(`directing Smart request in chat ${chatId} to ${first.name || first.id}`);
    const generateStart = nowMs();
    const directedInit = cloneInitWithBody(input, init, directedBody);
    const response = await callGenerate(input, directedInit, directedBody, sharedGeneration, nextFetch);
    timed("intercept directed generate request", generateStart, { chatId, status: response.status, character: first.name || first.id });
    timed("intercept total", totalStart, { chatId, path: "auto-directed", character: first.name || first.id });
    return injectQueueAndTrack(response, chatId, { refreshOnQueueEnd: true, sharedGeneration });
    } catch (error) {
      finishSharedGeneration(sharedGeneration, "failed", error);
      throw error;
    }
  }

  function findInputRoot() {
    return Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input"))
      .filter((el) => el instanceof HTMLElement && el.querySelector("textarea.mari-chat-input-textarea, textarea"))
      .find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
  }

  function findGenerationControls(root = findInputRoot()) {
    if (!root) return { textarea: null, buttons: [] };
    const textarea = root.querySelector("textarea.mari-chat-input-textarea, textarea");
    const buttons = Array.from(root.querySelectorAll("button.mari-chat-send-btn, button[title='Send'], button[aria-label='Send']"));
    return { textarea, buttons };
  }

  function findPostOnlyButtons() {
    return Array.from(document.querySelectorAll("button[aria-label^='Post only:'], button[title^='Post only:']"))
      .filter((button) => button instanceof HTMLButtonElement);
  }

  function lockDisabledControl(control) {
    if (!control || typeof control.disabled !== "boolean") return;
    if (!state.controlLocks.has(control)) {
      state.controlLocks.set(control, {
        disabled: control.disabled,
        ariaDisabled: control.getAttribute("aria-disabled"),
      });
    }
    control.disabled = true;
    control.setAttribute("aria-disabled", "true");
  }

  function releaseDisabledControl(control) {
    const original = state.controlLocks.get(control);
    if (!original) return;
    control.disabled = original.disabled === true;
    if (original.ariaDisabled === null) control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", original.ariaDisabled);
    state.controlLocks.delete(control);
  }

  function releaseAllDisabledControls() {
    for (const control of Array.from(state.controlLocks.keys())) {
      releaseDisabledControl(control);
    }
  }

  function isGsoLocked(control) {
    return state.controlLocks.has(control);
  }

  function applyRefreshControlLocks(refreshing) {
    if (!refreshing) {
      releaseAllDisabledControls();
      return;
    }

    const { textarea, buttons } = findGenerationControls();
    const agentSelectorMode = state.selectorConnectionMode === "agent";

    if (agentSelectorMode) {
      if (textarea) releaseDisabledControl(textarea);
      for (const button of buttons) releaseDisabledControl(button);
      for (const button of findPostOnlyButtons()) lockDisabledControl(button);
      return;
    }

    if (textarea) lockDisabledControl(textarea);
    for (const button of buttons) lockDisabledControl(button);
    for (const button of findPostOnlyButtons()) releaseDisabledControl(button);
  }

  function shouldBlockPostOnlyAction(target) {
    if (state.selectorConnectionMode !== "agent" || state.refreshPromises.size === 0) return false;
    const button = target instanceof Element ? target.closest("button[aria-label^='Post only:'], button[title^='Post only:']") : null;
    return Boolean(button);
  }

  function findActiveChatId() {
    const factoryChatId = factoryIdentity()?.readActiveChatId?.();
    if (factoryChatId) return factoryChatId;
    const stored = localStorage.getItem("marinara-active-chat-id");
    if (stored) return stored;
    const selected = document.querySelector('[data-chat-id][class*="sidebar-accent"], [data-chat-id][aria-current="true"]');
    const id = selected?.getAttribute("data-chat-id") || "";
    return id || state.lastActiveChatId || "";
  }

  function setSelectorConnectionMode(mode) {
    const nextMode = mode === "agent" ? "agent" : "main";
    if (state.selectorConnectionMode === nextMode) return;
    state.selectorConnectionMode = nextMode;
    localStorage.setItem(SELECTOR_MODE_STORAGE_KEY, nextMode);
    state.connectionsCache = null;
    state.defaultAgentConnectionId = null;
    state.defaultAgentConnectionLoaded = false;
    const chatId = findActiveChatId();
    if (chatId) setQueue(chatId, []);
    scheduleIndicatorUpdate();
  }

  function setDirectAgentConnection(enabled) {
    const nextValue = enabled === true;
    if (state.directAgentConnection === nextValue) return;
    state.directAgentConnection = nextValue;
    localStorage.setItem(DIRECT_AGENT_STORAGE_KEY, nextValue ? "true" : "false");
    const chatId = findActiveChatId();
    if (chatId) setQueue(chatId, []);
    scheduleIndicatorUpdate();
  }

  function setIncludePersonaCandidates(enabled) {
    const nextValue = enabled !== false;
    if (state.includePersonaCandidates === nextValue) return;
    state.includePersonaCandidates = nextValue;
    localStorage.setItem(INCLUDE_PERSONA_STORAGE_KEY, nextValue ? "true" : "false");
    const chatId = findActiveChatId();
    if (chatId) setQueue(chatId, []);
    scheduleIndicatorUpdate();
  }

  function iconSvg(name) {
    if (name === "direct") {
      return [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<path d="M13 2 3 14h8l-1 8 11-14h-8l1-6z"></path>',
        "</svg>",
      ].join("");
    }
    if (name === "reason") {
      return [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<circle cx="12" cy="12" r="10"></circle>',
        '<path d="M9.1 9a3 3 0 1 1 4.6 2.5c-.9.5-1.7 1.1-1.7 2.5"></path>',
        '<path d="M12 17h.01"></path>',
        "</svg>",
      ].join("");
    }
    if (name === "agent") {
      return [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<path d="M12 8V4"></path>',
        '<path d="M8 4h8"></path>',
        '<rect x="4" y="8" width="16" height="12" rx="2"></rect>',
        '<path d="M9 14h.01"></path>',
        '<path d="M15 14h.01"></path>',
        '<path d="M9 18h6"></path>',
        "</svg>",
      ].join("");
    }
    if (name === "persona") {
      return [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<circle cx="12" cy="8" r="4"></circle>',
        '<path d="M4 21a8 8 0 0 1 16 0"></path>',
        '<path d="M18 3l3 3"></path>',
        "</svg>",
      ].join("");
    }
    return [
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
      '<path d="M10 7 8.5 8.5a3 3 0 0 0 0 4.2l2.8 2.8a3 3 0 0 0 4.2 0L17 14"></path>',
      '<path d="m14 17 1.5-1.5a3 3 0 0 0 0-4.2l-2.8-2.8a3 3 0 0 0-4.2 0L7 10"></path>',
      '<path d="M8 2v4"></path>',
      '<path d="M16 18v4"></path>',
      "</svg>",
    ].join("");
  }

  function updateModeToggle(el = state.indicator) {
    if (!el) return;
    for (const button of el.querySelectorAll(".mgso-mode")) {
      const active = button.dataset.mode === state.selectorConnectionMode;
      button.classList.toggle("mgso-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const directButton = el.querySelector(".mgso-direct");
    if (directButton) {
      const available =
        state.selectorConnectionMode === "agent" &&
        state.directEligibility?.mode === "agent" &&
        state.directEligibility?.eligible === true;
      directButton.hidden = !available;
      directButton.disabled = !available;
      directButton.classList.toggle("mgso-active", available && state.directAgentConnection);
      directButton.setAttribute("aria-pressed", available && state.directAgentConnection ? "true" : "false");
    }
    const reasonButton = el.querySelector(".mgso-reason");
    if (reasonButton) {
      const hasReasoning = Boolean(state.lastSelectorReasoning?.reasoning);
      reasonButton.disabled = !state.lastSelectorReasoning;
      reasonButton.classList.toggle("mgso-active", hasReasoning);
    }
    const personaButton = el.querySelector(".mgso-persona");
    if (personaButton) {
      personaButton.classList.toggle("mgso-active", state.includePersonaCandidates);
      personaButton.setAttribute("aria-pressed", state.includePersonaCandidates ? "true" : "false");
      personaButton.title = state.includePersonaCandidates
        ? "Persona is included as a selector candidate"
        : "Persona is not included as a selector candidate";
    }
  }

  async function loadDirectEligibilityForIndicator() {
    if (state.selectorConnectionMode !== "agent" || state.loadingDirectEligibility) return;
    if (state.directEligibility?.mode === "agent" && Array.isArray(state.connectionsCache)) return;
    state.loadingDirectEligibility = true;
    try {
      const connection = await getSelectorConnection({ chat: {} });
      state.directEligibility = {
        mode: "agent",
        connectionId: connection?.id || "",
        eligible: isDirectAgentConnectionEligible(connection),
        connection: connectionLabel(connection),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      state.directEligibility = {
        mode: "agent",
        connectionId: "",
        eligible: false,
        connection: "",
        updatedAt: new Date().toISOString(),
      };
      warn("failed to check direct agent selector eligibility", error);
    } finally {
      state.loadingDirectEligibility = false;
      scheduleIndicatorUpdate();
    }
  }

  function closeReasoningModal() {
    if (state.reasoningModal?.isConnected) state.reasoningModal.remove();
    state.reasoningModal = null;
  }

  function openReasoningModal() {
    closeReasoningModal();
    const detail = state.lastSelectorReasoning;
    const modal = document.createElement("div");
    modal.className = "mgso-modal";
    const reasoning = detail?.reasoning || "No reasoning captured.";
    modal.innerHTML = [
      '<div class="mgso-modal-panel" role="dialog" aria-modal="true" aria-label="Selector reasoning">',
      '<div class="mgso-modal-header">',
      '<strong>Selector reasoning</strong>',
      '<button type="button" class="mgso-modal-close" title="Close" aria-label="Close">x</button>',
      "</div>",
      `<div class="mgso-modal-meta">${escapeHtml(detail?.connection || "No selector result")} · ${escapeHtml(detail?.route || "")} · ${escapeHtml(detail?.updatedAt || "")}</div>`,
      `<pre class="mgso-modal-body">${escapeHtml(reasoning)}</pre>`,
      "</div>",
    ].join("");
    const closeButton = modal.querySelector(".mgso-modal-close");
    if (closeButton) marinara.on(closeButton, "click", closeReasoningModal);
    marinara.on(modal, "click", (event) => {
      if (event.target === modal) closeReasoningModal();
    });
    document.body.appendChild(modal);
    state.reasoningModal = modal;
  }

  function ensureIndicator() {
    const root = findInputRoot();
    if (!root) return null;
    if (state.indicator && state.indicator.isConnected && state.indicator.parentElement === root) return state.indicator;

    if (state.indicator?.isConnected) state.indicator.remove();
    const el = document.createElement("div");
    el.className = INDICATOR_CLASS;
    el.innerHTML = [
      '<div class="mgso-main">',
      '<span class="mgso-label">Next</span>',
      '<span class="mgso-value">Checking...</span>',
      "</div>",
      '<div class="mgso-actions">',
      '<div class="mgso-mode-toggle" role="group" aria-label="Selector connection">',
      `<button type="button" class="mgso-mode" data-mode="main" title="Use main chat connection" aria-label="Use main chat connection">${iconSvg("main")}</button>`,
      `<button type="button" class="mgso-mode" data-mode="agent" title="Use default agent connection" aria-label="Use default agent connection">${iconSvg("agent")}</button>`,
      "</div>",
      `<button type="button" class="mgso-icon-button mgso-direct" title="Use direct local agent endpoint" aria-label="Use direct local agent endpoint">${iconSvg("direct")}</button>`,
      `<button type="button" class="mgso-icon-button mgso-persona" title="Persona is included as a selector candidate" aria-label="Toggle persona selector candidate">${iconSvg("persona")}</button>`,
      `<button type="button" class="mgso-icon-button mgso-reason" title="Show selector reasoning" aria-label="Show selector reasoning">${iconSvg("reason")}</button>`,
      '<button type="button" class="mgso-refresh" title="Refresh group smart order queue">Refresh</button>',
      "</div>",
    ].join("");
    updateModeToggle(el);
    for (const modeButton of el.querySelectorAll(".mgso-mode")) {
      marinara.on(modeButton, "click", () => {
        setSelectorConnectionMode(modeButton.dataset.mode);
        updateModeToggle(el);
      });
    }
    const directButton = el.querySelector(".mgso-direct");
    if (directButton) marinara.on(directButton, "click", () => {
      if (state.selectorConnectionMode !== "agent") return;
      setDirectAgentConnection(!state.directAgentConnection);
      updateModeToggle(el);
    });
    const reasonButton = el.querySelector(".mgso-reason");
    if (reasonButton) marinara.on(reasonButton, "click", openReasoningModal);
    const personaButton = el.querySelector(".mgso-persona");
    if (personaButton) marinara.on(personaButton, "click", () => {
      setIncludePersonaCandidates(!state.includePersonaCandidates);
      updateModeToggle(el);
    });
    const refreshButton = el.querySelector(".mgso-refresh");
    if (refreshButton) marinara.on(refreshButton, "click", async () => {
      const chatId = findActiveChatId();
      if (!chatId) return;
      const controls = findGenerationControls(root);
      if (controls.textarea?.disabled || controls.buttons.some((button) => button.disabled)) return;
      el.classList.add("mgso-loading");
      await refreshQueue(chatId).finally(() => el.classList.remove("mgso-loading"));
      updateIndicator();
    });
    root.insertBefore(el, root.firstChild);
    state.indicator = el;
    return el;
  }

  async function loadContextForIndicator(chatId) {
    if (!chatId || state.contextCache.has(chatId) || state.loadingContext.has(chatId)) return;
    state.loadingContext.add(chatId);
    try {
      await getChatContext(chatId);
    } catch (error) {
      warn("failed to load indicator chat context", error);
    } finally {
      state.loadingContext.delete(chatId);
      scheduleIndicatorUpdate();
    }
  }

  function updateIndicator() {
    const chatId = findActiveChatId();
    const refreshing = chatId ? state.refreshPromises.has(chatId) : false;
    applyRefreshControlLocks(refreshing);
    if (chatId && state.ineligibleChats.has(chatId)) {
      if (state.indicator) state.indicator.hidden = true;
      return;
    }
    const el = ensureIndicator();
    if (!el) return;
    const queue = chatId ? queueFor(chatId) : [];
    const context = chatId ? state.contextCache.get(chatId) : null;
    const value = el.querySelector(".mgso-value");
    const refreshButton = el.querySelector(".mgso-refresh");
    if (state.selectorConnectionMode === "agent") void loadDirectEligibilityForIndicator();
    updateModeToggle(el);
    const { textarea, buttons } = findGenerationControls();
    const generationBusy =
      !refreshing &&
      ((textarea && textarea.disabled && !isGsoLocked(textarea)) || buttons.some((button) => button.disabled && !isGsoLocked(button)));

    if (refreshButton) refreshButton.disabled = refreshing || generationBusy;

    if (!chatId) {
      el.hidden = true;
      return;
    }

    el.hidden = false;
    if (!context) {
      value.textContent = refreshing ? "Refreshing..." : "Queue not loaded";
      void loadContextForIndicator(chatId);
      return;
    }
    if (!isEligibleChat(context.chat)) {
      state.ineligibleChats.set(chatId, {
        reason: ineligibleReasonForChat(context.chat),
        activeCount: activeCharacterIdsForChat(context.chat).length,
        updatedAt: new Date().toISOString(),
      });
      el.hidden = true;
      return;
    }
    if (!queue.length) {
      value.textContent = refreshing ? "Refreshing..." : "Queue not loaded";
      return;
    }
    const nextIndex = nextQueueIndex(chatId, queue);
    const next = queue[nextIndex] || null;
    value.textContent = refreshing ? "Refreshing..." : next ? itemLabel(next) : "Queue complete";
    el.title = queue.map((item, index) => `${index === nextIndex ? "Next: " : ""}${itemLabel(item)}`).join(" -> ");
  }

  function scheduleIndicatorUpdate() {
    if (state.uiSyncTimer) return;
    state.uiSyncTimer = marinara.setTimeout(() => {
      state.uiSyncTimer = null;
      updateIndicator();
    }, 40);
  }

  function installStyles() {
    const css = `
      .${INDICATOR_CLASS} {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin: 0 0 0.35rem;
        padding: 0.3rem 0.5rem;
        border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
        border-radius: 0.5rem;
        background: color-mix(in srgb, var(--background) 88%, var(--accent));
        color: var(--foreground);
        font-size: 0.75rem;
      }
      .${INDICATOR_CLASS}[hidden] { display: none; }
      .${INDICATOR_CLASS} .mgso-main {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .${INDICATOR_CLASS} .mgso-label {
        color: var(--muted-foreground);
        font-weight: 600;
      }
      .${INDICATOR_CLASS} .mgso-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${INDICATOR_CLASS} .mgso-actions {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 0.35rem;
      }
      .${INDICATOR_CLASS} .mgso-mode-toggle {
        display: inline-flex;
        align-items: center;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 0.375rem;
        background: var(--background);
      }
      .${INDICATOR_CLASS} .mgso-mode {
        width: 1.55rem;
        height: 1.35rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 0;
        color: var(--muted-foreground);
        background: transparent;
        padding: 0;
      }
      .${INDICATOR_CLASS} .mgso-mode + .mgso-mode {
        border-left: 1px solid var(--border);
      }
      .${INDICATOR_CLASS} .mgso-mode svg {
        width: 0.9rem;
        height: 0.9rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .${INDICATOR_CLASS} .mgso-mode.mgso-active {
        color: var(--accent-foreground);
        background: var(--accent);
      }
      .${INDICATOR_CLASS} .mgso-icon-button {
        width: 1.55rem;
        height: 1.35rem;
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border);
        border-radius: 0.375rem;
        color: var(--muted-foreground);
        background: var(--background);
        padding: 0;
      }
      .${INDICATOR_CLASS} .mgso-icon-button svg {
        width: 0.9rem;
        height: 0.9rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .${INDICATOR_CLASS} .mgso-icon-button.mgso-active {
        color: var(--accent-foreground);
        background: var(--accent);
      }
      .${INDICATOR_CLASS} .mgso-icon-button:disabled {
        opacity: 0.45;
      }
      .${INDICATOR_CLASS} .mgso-refresh {
        flex: 0 0 auto;
        border: 1px solid var(--border);
        border-radius: 0.375rem;
        padding: 0.15rem 0.4rem;
        color: var(--foreground);
        background: var(--background);
        font-size: 0.7rem;
      }
      .${INDICATOR_CLASS}.mgso-loading .mgso-refresh {
        opacity: 0.6;
      }
      .${INDICATOR_CLASS} .mgso-refresh:disabled {
        cursor: wait;
      }
      .mgso-modal {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background: color-mix(in srgb, black 55%, transparent);
      }
      .mgso-modal-panel {
        width: min(52rem, 100%);
        max-height: min(38rem, 90vh);
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--background);
        color: var(--foreground);
        box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.35);
      }
      .mgso-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.65rem 0.8rem;
        border-bottom: 1px solid var(--border);
      }
      .mgso-modal-close {
        border: 1px solid var(--border);
        border-radius: 0.375rem;
        color: var(--foreground);
        background: var(--background);
        padding: 0.1rem 0.45rem;
      }
      .mgso-modal-meta {
        padding: 0.45rem 0.8rem 0;
        color: var(--muted-foreground);
        font-size: 0.72rem;
      }
      .mgso-modal-body {
        min-height: 10rem;
        margin: 0;
        padding: 0.8rem;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.78rem;
        line-height: 1.45;
      }
    `;
    if (typeof marinara !== "undefined" && marinara?.addStyle) marinara.addStyle(css);
    else {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function disconnectMountObserver() {
    if (state.mountObserver && typeof state.mountObserver.disconnect === "function") {
      try {
        state.mountObserver.disconnect();
      } catch {}
    }
    state.mountObserver = null;
  }

  function setupMountObserver() {
    if (!document.body || state.mountObserver) return;
    state.mountObserver = marinara.observe(
      document.body,
      () => {
        scheduleIndicatorUpdate();
        if (state.mountRetryTimer) return;
        state.mountRetryTimer = marinara.setTimeout(() => {
          state.mountRetryTimer = null;
          const root = findInputRoot();
          const detached = state.indicator && !document.documentElement.contains(state.indicator);
          const missing = root && !root.querySelector(`:scope > .${INDICATOR_CLASS}`);
          if (detached || missing) {
            if (state.indicator?.isConnected) state.indicator.remove();
            state.indicator = null;
          }
          updateIndicator();
        }, 80);
      },
      { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-chat-id", "aria-current"] },
    );
  }

  function install() {
    if (state.fetchInterceptorRegistration || state.legacyFetchInstalled) return;
    installStyles();
    state.originalFetch = factoryFetch()?.fetchOriginal || window.fetch.bind(window);

    const fetchHub = factoryFetch();
    if (fetchHub?.intercepts?.register) {
      state.fetchInterceptorRegistration = fetchHub.intercepts.register({
        id: "group-smart-order:fetch-generate",
        route: "generate",
        priority: 20,
        handler: async (context, next) => {
          if (context.method !== "POST" || context.route?.route !== "generate") return next();
          const body = context.body && typeof context.body === "object" ? context.body : null;
          if (!body) return next();
          return handleGenerate(context.input, context.init, body, next);
        },
      });
    } else {
      state.legacyFetchInstalled = true;
      window.fetch = async (input, init = {}) => {
        const url = typeof input === "string" ? input : input?.url || "";
        const method = String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
        if (method !== "POST" || !isGenerateUrl(url)) return baseFetch(input, init);

        let body = null;
        try {
          body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        } catch {
          body = null;
        }
        if (!body || typeof body !== "object") return baseFetch(input, init);
        return handleGenerate(input, init, body, baseFetch);
      };
    }

    state.postOnlyClickGuard = (event) => {
      if (!shouldBlockPostOnlyAction(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", state.postOnlyClickGuard, true);

    try {
      state.extensionRegistration = alDente()?.registerExtension?.({
        id: "group-smart-order",
        name: EXTENSION_NAME,
        version: "0.2.0",
        capabilities: [
          "fetch-interceptor",
          "generation-monitor",
          "message-tracking",
          "wake-lock",
          "group-smart-order",
          "presence-compatibility",
          "character-parser",
          "persona-parser",
        ],
      }) || null;
    } catch {}
    try {
      state.serviceRegistration = alDente()?.services?.register?.("group-smart-order", {
        presenceCompatibility: true,
        refreshQueue,
        getQueue: queueFor,
        getQueueMeta: queueMetaFor,
        getSelectorConnectionMode: () => state.selectorConnectionMode,
        setSelectorConnectionMode,
        getDirectAgentConnection: () => state.directAgentConnection,
        setDirectAgentConnection,
        getDirectAgentEligibility: () => state.directEligibility,
        getIncludePersonaCandidates: () => state.includePersonaCandidates,
        setIncludePersonaCandidates,
      }, {
        owner: EXTENSION_NAME,
        version: "0.2.0",
        capabilities: ["queue", "selector", "persona-candidate-toggle", "presence-compatibility"],
      }) || null;
    } catch {}

    setupMountObserver();
    state.indicatorTimer = marinara.setInterval(updateIndicator, 1500);
    scheduleIndicatorUpdate();
    log("installed");
  }

  function uninstall() {
    try { state.fetchInterceptorRegistration?.unregister?.(); } catch {}
    state.fetchInterceptorRegistration = null;
    try { state.serviceRegistration?.unregister?.(); } catch {}
    state.serviceRegistration = null;
    try { state.extensionRegistration?.unregister?.(); } catch {}
    state.extensionRegistration = null;
    if (state.legacyFetchInstalled && state.originalFetch) {
      window.fetch = state.originalFetch;
    }
    if (state.postOnlyClickGuard) {
      document.removeEventListener("click", state.postOnlyClickGuard, true);
      state.postOnlyClickGuard = null;
    }
    state.legacyFetchInstalled = false;
    state.originalFetch = null;
    if (state.indicatorTimer) window.clearInterval(state.indicatorTimer);
    state.indicatorTimer = null;
    if (state.mountRetryTimer) window.clearTimeout(state.mountRetryTimer);
    state.mountRetryTimer = null;
    if (state.uiSyncTimer) window.clearTimeout(state.uiSyncTimer);
    state.uiSyncTimer = null;
    disconnectMountObserver();
    closeReasoningModal();
    if (state.indicator?.isConnected) state.indicator.remove();
    state.indicator = null;
    state.queues.clear();
    state.queueMeta.clear();
    state.pendingEndRefresh.clear();
    state.contextCache.clear();
    state.defaultAgentConnectionId = null;
    state.defaultAgentConnectionLoaded = false;
    releaseAllDisabledControls();
    if (window.__marinaraGroupSmartOrder?.uninstall === uninstall) {
      delete window.__marinaraGroupSmartOrder;
    }
  }

  install();
  if (typeof marinara !== "undefined" && marinara?.onCleanup) marinara.onCleanup(uninstall);
  window.__marinaraGroupSmartOrder = {
    version: "0.2.0",
    presenceCompatibility: true,
    queues: state.queues,
    queueMeta: state.queueMeta,
    get lastSelectorDebug() {
      return state.lastSelectorDebug;
    },
    get lastSelectorReasoning() {
      return state.lastSelectorReasoning;
    },
    refreshQueue,
    getSelectorConnectionMode: () => state.selectorConnectionMode,
    setSelectorConnectionMode,
    getDirectAgentConnection: () => state.directAgentConnection,
    setDirectAgentConnection,
    getDirectAgentEligibility: () => state.directEligibility,
    getIncludePersonaCandidates: () => state.includePersonaCandidates,
    setIncludePersonaCandidates,
    uninstall,
  };
  window.dispatchEvent(new CustomEvent("marinara-extension-ready", { detail: { name: EXTENSION_NAME } }));
})();

  });
}
