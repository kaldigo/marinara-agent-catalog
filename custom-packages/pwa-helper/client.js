// Generated from agents/extensions source by the catalog rebuild workflow.
const PACKAGE_ID = "pwa-helper";
const TAG_NAME = "marinara-capability-pwa-helper";
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

  const DATA_ATTR = "mariPwaHelperWakeLock";
  const ERROR_ATTR = "mariPwaHelperWakeLockError";
  const SYNC_DELAY_MS = 80;
  const IOS_ICON_SIZE = 180;
  const IOS_ICON_PADDING = 18;
  const IOS_ICON_GRADIENT = ["#4de5dd", "#eb8951", "#e15c8c"];
  const IOS_ICON_LOGO_FILL = "#ffffff";
  const IOS_ICON_SOURCE = "/icon-192.png";

  const state = {
    generationActive: false,
    generationLease: null,
    syncTimer: null,
    bodyObserver: null,
    registration: null,
    appleTouchIconUrl: "",
    debug: false,
  };

  function log(...args) {
    if (state.debug) console.debug("[PWA Helper]", ...args);
  }

  function warn(...args) {
    console.warn("[PWA Helper]", ...args);
  }

  function setStatus(status, error) {
    const root = document.documentElement;
    if (!root) return;
    if (status) root.dataset[DATA_ATTR] = status;
    else delete root.dataset[DATA_ATTR];
    if (error) root.dataset[ERROR_ATTR] = String(error).slice(0, 160);
    else delete root.dataset[ERROR_ATTR];
  }

  function factory() {
    return window.alDenteFactory || null;
  }

  function ensureHeadLink(rel, selector = `link[rel="${rel}"]`) {
    let link = document.head?.querySelector(selector);
    if (!(link instanceof HTMLLinkElement)) {
      link = document.createElement("link");
      link.rel = rel;
      document.head?.appendChild(link);
    }
    return link;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load ${src}`));
      image.src = src;
    });
  }

  async function createIosTouchIconUrl() {
    const image = await loadImage(IOS_ICON_SOURCE);
    const canvas = document.createElement("canvas");
    canvas.width = IOS_ICON_SIZE;
    canvas.height = IOS_ICON_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");

    const gradient = context.createLinearGradient(0, 0, IOS_ICON_SIZE, IOS_ICON_SIZE);
    gradient.addColorStop(0, IOS_ICON_GRADIENT[0]);
    gradient.addColorStop(0.52, IOS_ICON_GRADIENT[1]);
    gradient.addColorStop(1, IOS_ICON_GRADIENT[2]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, IOS_ICON_SIZE, IOS_ICON_SIZE);

    const iconSize = IOS_ICON_SIZE - IOS_ICON_PADDING * 2;
    const logoCanvas = document.createElement("canvas");
    logoCanvas.width = IOS_ICON_SIZE;
    logoCanvas.height = IOS_ICON_SIZE;
    const logoContext = logoCanvas.getContext("2d");
    if (!logoContext) throw new Error("Canvas 2D context is unavailable.");
    logoContext.drawImage(image, IOS_ICON_PADDING, IOS_ICON_PADDING, iconSize, iconSize);
    logoContext.globalCompositeOperation = "source-in";
    logoContext.fillStyle = IOS_ICON_LOGO_FILL;
    logoContext.fillRect(IOS_ICON_PADDING, IOS_ICON_PADDING, iconSize, iconSize);
    context.drawImage(logoCanvas, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function installIosTouchIcon() {
    try {
      const url = await createIosTouchIconUrl();
      state.appleTouchIconUrl = url;
      const link = ensureHeadLink("apple-touch-icon");
      link.href = url;
      link.sizes = `${IOS_ICON_SIZE}x${IOS_ICON_SIZE}`;
      link.type = "image/png";
      document.documentElement?.setAttribute?.("data-mari-pwa-helper-ios-icon", "active");
      log("installed iOS touch icon override");
    } catch (error) {
      document.documentElement?.setAttribute?.("data-mari-pwa-helper-ios-icon", "error");
      warn("failed to install iOS touch icon override", error);
    }
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!el.getClientRects().length) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function getLabel(button) {
    return [
      button.getAttribute("title"),
      button.getAttribute("aria-label"),
      button.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function hasStopIcon(button) {
    const svg = button.querySelector("svg");
    if (!svg) return false;

    const className = svg.getAttribute("class") || "";
    if (/\b(lucide-)?(circle-stop|stop-circle)\b/i.test(className)) return true;

    // Marinara's roleplay input currently renders the stop state as a Lucide
    // StopCircle icon without title/aria text on the button.
    return Boolean(svg.querySelector("circle") && svg.querySelector("rect"));
  }

  function isGenerationStopButton(button) {
    if (!(button instanceof HTMLButtonElement) || !isVisible(button)) return false;

    const label = getLabel(button);
    if (/\bstop\s+generat(?:e|ing|ion)\b/i.test(label)) return true;

    const inChatInput = Boolean(button.closest(".mari-chat-input, .chat-input-container"));
    if (!inChatInput && !button.classList.contains("mari-chat-send-btn")) return false;

    return hasStopIcon(button);
  }

  function collectCandidateButtons() {
    const buttons = new Set();
    document.querySelectorAll(".mari-chat-input button, .chat-input-container button, button.mari-chat-send-btn")
      .forEach((button) => buttons.add(button));
    document.querySelectorAll("button[title*='Stop' i], button[aria-label*='Stop' i]")
      .forEach((button) => buttons.add(button));
    return Array.from(buttons);
  }

  function detectGenerationActive() {
    return collectCandidateButtons().some(isGenerationStopButton);
  }

  function releaseGenerationLease() {
    if (!state.generationLease) return;
    try {
      state.generationLease.release();
    } finally {
      state.generationLease = null;
    }
  }

  function holdGenerationLease() {
    if (state.generationLease) return;
    const wakeLock = factory()?.wakeLock;
    if (!wakeLock || typeof wakeLock.hold !== "function") {
      setStatus("error", "alDenteFactory wake lock surface is unavailable.");
      warn("alDenteFactory wake lock surface is unavailable.");
      return;
    }
    state.generationLease = wakeLock.hold({
      id: "pwa-helper:native-generation",
      source: "PWA Helper",
      reason: "native-generation",
    });
  }

  function syncGenerationState() {
    state.syncTimer = null;
    const active = detectGenerationActive();
    if (active === state.generationActive) {
      if (active) holdGenerationLease();
      return;
    }

    state.generationActive = active;
    if (active) holdGenerationLease();
    else releaseGenerationLease();
  }

  function scheduleSync() {
    if (state.syncTimer) return;
    state.syncTimer = marinara.setTimeout(syncGenerationState, SYNC_DELAY_MS);
  }

  function observeBody() {
    if (!document.body || state.bodyObserver) return;
    state.bodyObserver = marinara.observe(document.body, scheduleSync, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "class", "disabled"],
    });
  }

  marinara.on(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync();
  });

  marinara.on(window, "pageshow", scheduleSync);
  marinara.on(window, "focus", scheduleSync);
  marinara.on(document, "click", scheduleSync);
  marinara.setInterval(scheduleSync, 2500);

  marinara.onCleanup(() => {
    if (state.syncTimer) clearTimeout(state.syncTimer);
    state.generationActive = false;
    releaseGenerationLease();
    state.registration?.unregister?.();
    state.registration = null;
    document.documentElement?.removeAttribute?.("data-mari-pwa-helper-ios-icon");
    setStatus("", "");
  });

  state.registration = factory()?.registerExtension?.({
    id: "pwa-helper",
    name: "PWA Helper",
    version: "0.1.0",
    capabilities: ["wake-lock"],
  }) || null;

  if (document.readyState === "loading") {
    marinara.on(document, "DOMContentLoaded", () => {
      installIosTouchIcon();
      observeBody();
      scheduleSync();
    });
  } else {
    installIosTouchIcon();
    observeBody();
    scheduleSync();
  }
})();

  });
}
