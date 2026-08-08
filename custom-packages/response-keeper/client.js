(() => {
  "use strict";
  // bridge/runtime.js
  // Shared runtime coordinator for bridge copies bundled by different packages.

  const MARI_BRIDGE_VERSION = "1.0.7";

  const MARI_BRIDGE_RUNTIME_KEY = "__mariBridgeRuntime";
  const DEFAULT_CAPABILITIES = [
    "runtime:newest-wins",
    "commands:register",
    "fetch:interceptors",
    "generation:lifecycle-events",
    "ui-slots:composer-above-input",
    "ui-slots:quick-actions-menu",
    "ui-slots:message-actions",
    "ui-slots:topbar-panel",
    "ui-slots:chat-settings",
    "capability-slots:register",
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

    if (current && comparison === 0 && (current.installed || current.installing)) {
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
      installing: true,
      installedAt: Date.now(),
      cleanup: null,
    };
    runtime.subsystems.set(subsystem, next);

    try {
      if (typeof definition.install === "function") {
        const cleanup = definition.install({ runtime, previous: current, token });
        if (typeof cleanup === "function") next.cleanup = cleanup;
      }
      next.installed = true;
      return { active: true, current: next, runtime, token };
    } catch (error) {
      if (current) runtime.subsystems.set(subsystem, current);
      else runtime.subsystems.delete(subsystem);
      throw error;
    } finally {
      next.installing = false;
    }
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

  // bridge/generation-stream.js
  function parseSsePayloads(text, final = false) {
    const parts = String(text || "").split(/\n\n/u);
    const rest = final ? "" : parts.pop() || "";
    return {
      rest,
      payloads: parts
        .map((frame) =>
          frame
            .split(/\r?\n/u)
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

  async function apiRequest(path, options = {}) {
    const response = await fetch(path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message = typeof data === "object" && data?.error ? data.error : text || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  }

  async function streamJsonSse(path, body, handlers = {}, options = {}) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: JSON.stringify(body || {}),
      signal: options.signal,
    });

    if (!response.ok) {
      let text = "";
      try {
        text = await response.text();
      } catch {}
      throw new Error(text || `Streaming request failed (${response.status})`);
    }
    if (!response.body) throw new Error("Streaming request returned no response body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let carry = "";

    while (true) {
      const next = await reader.read();
      if (next.done) {
        const parsed = parseSsePayloads(carry, true);
        for (const payload of parsed.payloads) emitSsePayload(payload, handlers);
        handlers.onDone?.();
        return;
      }

      const decoded = decoder.decode(next.value, { stream: true });
      const parsed = parseSsePayloads(`${carry}${decoded}`, false);
      carry = parsed.rest;
      for (const payload of parsed.payloads) emitSsePayload(payload, handlers);
    }
  }

  function emitSsePayload(payload, handlers) {
    const event = parseSseEventPayload(payload);
    handlers.onPayload?.(payload, event);
    if (!event || !event.type) return;
    handlers.onEvent?.(event);
    if (event.type === "error") handlers.onErrorEvent?.(event);
    if (event.type === "done") handlers.onDoneEvent?.(event);
    if (event.type === "aborted") handlers.onAbortEvent?.(event);
  }

  // bridge/fetch-intercept.js
  // Upstream gap MB-011: packages do not yet have a first-class client-side
  // generate request observation/mutation hook.


  const FETCH_INTERCEPT_STATE_KEY = "__mariBridgeFetchInterceptState";

  function getApiPath(input) {
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      return new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/u, "") || "/";
    } catch {
      return "";
    }
  }

  function classifyApiRequest(input) {
    const pathname = getApiPath(input);
    if (pathname === "/api/generate") return { kind: "generate", route: "generate", pathname };
    if (pathname === "/api/generate/dryRun") return { kind: "generate", route: "generate:dry-run", pathname };
    if (pathname === "/api/generate/raw") return { kind: "generate", route: "generate:raw", pathname };
    const messageMatch = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/u);
    if (messageMatch) {
      return { kind: "message:create", route: "message:create", chatId: decodeURIComponent(messageMatch[1]), pathname };
    }
    return { kind: "other", route: "other", pathname };
  }

  function parseJsonFetchBody(init) {
    if (typeof init?.body !== "string") return null;
    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }

  function cloneFetchInitWithJsonBody(input, init, body) {
    const nextInit = { ...(init || {}) };
    nextInit.method = String(nextInit.method || (typeof input !== "string" ? input?.method : "") || "POST");
    nextInit.body = JSON.stringify(body);
    const headers = new Headers(nextInit.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    nextInit.headers = headers;
    return nextInit;
  }

  function installFetchInterceptor(definition = {}) {
    const id = typeof definition.id === "string" && definition.id.trim() ? definition.id.trim() : "";
    if (!id) throw new Error("installFetchInterceptor requires an id.");
    if (typeof definition.handler !== "function") throw new Error(`Fetch interceptor "${id}" requires a handler.`);

    const state = fetchInterceptState();
    state.interceptors.set(id, {
      id,
      priority: Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : 100,
      match: typeof definition.match === "function" ? definition.match : null,
      route: typeof definition.route === "string" ? definition.route : "",
      handler: definition.handler,
    });
    claimBridgeSubsystem("fetch-intercept", {
      version: MARI_BRIDGE_VERSION,
      ownerId: "mari-bridge:fetch-intercept",
      install: ({ token }) => installFetchPatch(state, token),
    });

    return () => {
      const current = state.interceptors.get(id);
      if (current?.handler === definition.handler) state.interceptors.delete(id);
    };
  }

  function fetchInterceptState() {
    if (!window[FETCH_INTERCEPT_STATE_KEY]) {
      window[FETCH_INTERCEPT_STATE_KEY] = {
        originalFetch: null,
        patchedFetch: null,
        interceptors: new Map(),
        ownerToken: null,
      };
    }
    const state = window[FETCH_INTERCEPT_STATE_KEY];
    if (!(state.interceptors instanceof Map)) state.interceptors = new Map();
    if (!("ownerToken" in state)) state.ownerToken = null;
    return state;
  }

  function installFetchPatch(state, token) {
    if (typeof state.originalFetch !== "function") state.originalFetch = window.fetch.bind(window);
    state.ownerToken = token;
    state.patchedFetch = (input, init = {}) => {
      if (!isBridgeSubsystemOwner("fetch-intercept", token)) {
        return (state.originalFetch || window.fetch.bind(window))(input, init);
      }
      return runFetchPipeline(state, input, init);
    };
    window.fetch = state.patchedFetch;
    return () => {
      if (state.ownerToken !== token) return;
      if (window.fetch === state.patchedFetch && typeof state.originalFetch === "function") {
        window.fetch = state.originalFetch;
      }
      state.patchedFetch = null;
      state.ownerToken = null;
    };
  }

  async function runFetchPipeline(state, input, init = {}) {
    const stack = Array.from(state.interceptors.values())
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .filter((entry) => fetchInterceptorMatches(entry, input, init));
    const baseFetch = state.originalFetch || window.fetch.bind(window);

    const dispatch = async (index, currentInput, currentInit) => {
      const entry = stack[index];
      if (!entry) return baseFetch(currentInput, currentInit);
      let nextCalled = false;
      const context = buildFetchContext(currentInput, currentInit, baseFetch);
      const next = async (nextInput = currentInput, nextInit = currentInit) => {
        if (nextCalled) throw new Error(`Fetch interceptor "${entry.id}" called next() more than once.`);
        nextCalled = true;
        return dispatch(index + 1, nextInput, nextInit);
      };
      return entry.handler(context, next);
    };

    return dispatch(0, input, init);
  }

  function fetchInterceptorMatches(entry, input, init) {
    const context = buildFetchContext(input, init, window.fetch);
    if (entry.match) return entry.match(context) === true;
    if (entry.route) return entry.route === context.route.route || entry.route === context.route.kind;
    return true;
  }

  function buildFetchContext(input, init, fetchOriginal) {
    return {
      input,
      init,
      method: String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase(),
      route: classifyApiRequest(input),
      body: parseJsonFetchBody(init),
      cloneInitWithJsonBody: (body) => cloneFetchInitWithJsonBody(input, init, body),
      fetchOriginal,
    };
  }

  // src/client/constants.js
  const PACKAGE_ID = "response-keeper";
  const PACKAGE_NAME = "Response Keeper";
  const PACKAGE_VERSION = "1.0.0";
  const PUBLIC_API_KEY = "__marinaraResponseKeeper";
  const RUNTIME_KEY = "__marinaraResponseKeeperRuntime";
  const EXTRA_KEY = "responseKeeper";

  // src/client/keeper.js
  const TEXT_DECODER = new TextDecoder("utf-8");

  async function handleGenerateRequest(_runtime, context, next) {
    const body = context.body || {};
    const chatId = cleanId(body.chatId);
    const regenerateMessageId = cleanId(body.regenerateMessageId);
    const continueMessageId = cleanId(body.continueMessageId);
    const targetMessageId = regenerateMessageId || continueMessageId;
    if (!chatId || !targetMessageId || body.impersonate === true) return next();

    const fetchOriginal = context.fetchOriginal;
    const generationContext = await loadGenerationContext(fetchOriginal, chatId, targetMessageId);
    if (!generationContext || generationContext.chatMode === "game") return next();

    const response = await next();
    if (!response?.ok || !response.body || typeof response.clone !== "function") return response;

    const monitorInput = {
      fetchOriginal,
      chatId,
      targetMessageId,
      kind: regenerateMessageId ? "regenerate" : "continue",
      signal: context.init?.signal || null,
      response: response.clone(),
      baseContent: generationContext.message?.content || "",
      continueAddsNewline: body.continueAddsNewline !== false,
    };
    void monitorStoppedGeneration(monitorInput);
    return response;
  }

  async function handleMessageEditRequest(_runtime, context, next) {
    const content = typeof context.body?.content === "string" ? context.body.content : null;
    if (content === null) return next();

    const match = context.route.pathname.match(/^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/u);
    const chatId = decodePathPart(match?.[1]);
    const messageId = decodePathPart(match?.[2]);
    if (!chatId || !messageId) return next();

    const fetchOriginal = context.fetchOriginal;
    const chat = await getJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}`).catch(() => null);
    if (chat?.mode === "game") return next();

    const message = await getMessage(fetchOriginal, chatId, messageId);
    if (!message || message.chatId !== chatId) return next();
    if (message.content === content) return next();

    const swipes = await getSwipes(fetchOriginal, chatId, messageId);
    const activeSwipeIndex = normalizeSwipeIndex(message.activeSwipeIndex);
    const activeSwipe = swipes.find((swipe) => normalizeSwipeIndex(swipe.index) === activeSwipeIndex);
    if (isManualEditSwipe(activeSwipe)) return next();

    await postJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/swipes`, {
      content,
    });
    await patchMessageExtra(fetchOriginal, chatId, messageId, {
      [EXTRA_KEY]: {
        manualEdit: true,
        sourceSwipeIndex: activeSwipeIndex,
        sourceMessageContent: message.content,
        createdAt: new Date().toISOString(),
        packageId: PACKAGE_ID,
        packageVersion: PACKAGE_VERSION,
      },
    });

    const updated = await getMessage(fetchOriginal, chatId, messageId);
    return jsonResponse(updated || { ...message, content, activeSwipeIndex: swipes.length });
  }

  async function monitorStoppedGeneration(input) {
    const reader = input.response.body?.getReader?.();
    if (!reader) return;

    let carry = "";
    let content = "";
    let completed = false;
    let preserved = false;
    let preservePromise = null;
    const preserveOnce = () => {
      if (completed || preserved || !content.trim()) return null;
      preserved = true;
      preservePromise = preservePartialSwipe(input, content).catch((error) => {
        console.warn("[Response Keeper] Failed to preserve stopped generation.", error);
      });
      return preservePromise;
    };
    const onAbort = () => {
      preserveOnce();
    };
    input.signal?.addEventListener?.("abort", onAbort, { once: true });

    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          processSsePayloads(parseSsePayloads(carry, true).payloads);
          break;
        }
        const decoded = TEXT_DECODER.decode(next.value, { stream: true });
        const parsed = parseSsePayloads(`${carry}${decoded}`, false);
        carry = parsed.rest;
        processSsePayloads(parsed.payloads);
      }
    } catch {
      // Abort tears down the cloned reader too. The signal check below decides
      // whether the partial should be preserved.
    } finally {
      input.signal?.removeEventListener?.("abort", onAbort);
      try {
        reader.releaseLock?.();
      } catch {}
      if (input.signal?.aborted === true) {
        await (preserveOnce() || preservePromise);
      }
    }

    function processSsePayloads(payloads) {
      for (const payload of payloads) {
        const event = parseSseEventPayload(payload);
        if (!event || typeof event.type !== "string") continue;
        if (event.type === "token" && typeof event.data === "string") content += event.data;
        else if (event.type === "content_replace" && typeof event.data === "string") content = event.data;
        else if (event.type === "text_rewrite" && typeof event.data?.editedText === "string") content = event.data.editedText;
        else if (event.type === "message_saved" || event.type === "done") completed = true;
        else if (event.type === "generation_discarded") completed = true;
      }
    }
  }

  async function preservePartialSwipe(input, partialContent) {
    const trimmedPartial = normalizeGeneratedText(partialContent);
    if (!trimmedPartial) return;
    if (input.kind === "continue") {
      const content = appendContinuationMessageContent(input.baseContent, trimmedPartial, input.continueAddsNewline);
      if (!content.trim() || content === input.baseContent) return;
      await patchMessageContent(input.fetchOriginal, input.chatId, input.targetMessageId, content);
      await patchMessageExtra(input.fetchOriginal, input.chatId, input.targetMessageId, {
        [EXTRA_KEY]: {
          manualEdit: false,
          stoppedPartial: true,
          source: "continue",
          createdAt: new Date().toISOString(),
          packageId: PACKAGE_ID,
          packageVersion: PACKAGE_VERSION,
        },
      });
      return;
    }

    await postJson(
      input.fetchOriginal,
      `/api/chats/${encodeURIComponent(input.chatId)}/messages/${encodeURIComponent(input.targetMessageId)}/swipes`,
      { content: trimmedPartial },
    );
    await patchMessageExtra(input.fetchOriginal, input.chatId, input.targetMessageId, {
      [EXTRA_KEY]: {
        stoppedPartial: true,
        source: "regenerate",
        createdAt: new Date().toISOString(),
        packageId: PACKAGE_ID,
        packageVersion: PACKAGE_VERSION,
      },
    });
  }

  async function loadGenerationContext(fetchOriginal, chatId, messageId) {
    const [chat, message] = await Promise.all([
      getJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}`).catch(() => null),
      getMessage(fetchOriginal, chatId, messageId).catch(() => null),
    ]);
    if (!chat || !message) return null;
    return { chatMode: typeof chat.mode === "string" ? chat.mode : "", message };
  }

  async function getMessage(fetchOriginal, chatId, messageId) {
    const messages = await getJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}/messages`);
    const list = Array.isArray(messages) ? messages : Array.isArray(messages?.messages) ? messages.messages : [];
    return list.find((message) => message?.id === messageId) || null;
  }

  async function getSwipes(fetchOriginal, chatId, messageId) {
    const swipes = await getJson(
      fetchOriginal,
      `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/swipes`,
    ).catch(() => []);
    return Array.isArray(swipes) ? swipes : [];
  }

  async function patchMessageExtra(fetchOriginal, chatId, messageId, extra) {
    return patchJson(
      fetchOriginal,
      `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`,
      extra,
    );
  }

  async function patchMessageContent(fetchOriginal, chatId, messageId, content) {
    return patchJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`, {
      content,
    });
  }

  async function getJson(fetchOriginal, path) {
    const response = await fetchOriginal(path, { headers: { Accept: "application/json" } });
    return readJsonResponse(response);
  }

  async function postJson(fetchOriginal, path, body) {
    const response = await fetchOriginal(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    return readJsonResponse(response);
  }

  async function patchJson(fetchOriginal, path, body) {
    const response = await fetchOriginal(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    return readJsonResponse(response);
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message = data && typeof data === "object" && data.error ? data.error : text || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  }

  function normalizeGeneratedText(value) {
    return String(value || "").replace(/[ \t]+(\r?\n)/gu, "$1").trim();
  }

  function appendContinuationMessageContent(existingContent, continuation, addNewline = true) {
    const existing = typeof existingContent === "string" ? existingContent : "";
    if (!existing) return continuation;
    if (!continuation) return existing;
    if (!addNewline) return `${existing}${continuation.replace(/^(?:\r?\n)+/u, "")}`;
    return `${existing.replace(/\s+$/u, "")}\n\n${continuation.replace(/^\s+/u, "")}`;
  }

  function isManualEditSwipe(swipe) {
    const extra = normalizeObject(swipe?.extra);
    const marker = normalizeObject(extra[EXTRA_KEY]);
    return marker.manualEdit === true;
  }

  function normalizeObject(value) {
    if (!value) return {};
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    return typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeSwipeIndex(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }

  function cleanId(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function decodePathPart(value) {
    if (!value) return "";
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }

  function jsonResponse(data) {
    return new Response(`${JSON.stringify(data ?? null)}\n`, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // src/client/runtime.js
  function startResponseKeeperPackage() {
    if (window[RUNTIME_KEY]?.destroy) return window[RUNTIME_KEY].api;

    const runtime = {
      cleanups: [],
      api: null,
      destroy: null,
    };

    runtime.cleanups.push(
      installFetchInterceptor({
        id: `${PACKAGE_ID}:generate`,
        priority: 40,
        match: (context) => context.method === "POST" && context.route.pathname === "/api/generate",
        handler: (context, next) => handleGenerateRequest(runtime, context, next),
      }),
    );
    runtime.cleanups.push(
      installFetchInterceptor({
        id: `${PACKAGE_ID}:message-edit`,
        priority: 45,
        match: (context) =>
          context.method === "PATCH" && /^\/api\/chats\/[^/]+\/messages\/[^/]+$/u.test(context.route.pathname),
        handler: (context, next) => handleMessageEditRequest(runtime, context, next),
      }),
    );

    runtime.api = Object.freeze({
      packageId: PACKAGE_ID,
      destroy: () => runtime.destroy?.(),
    });

    runtime.destroy = () => {
      while (runtime.cleanups.length) {
        try {
          runtime.cleanups.pop()?.();
        } catch {}
      }
      if (window[RUNTIME_KEY] === runtime) delete window[RUNTIME_KEY];
      if (window[PUBLIC_API_KEY] === runtime.api) delete window[PUBLIC_API_KEY];
    };

    window[RUNTIME_KEY] = runtime;
    Object.defineProperty(window, PUBLIC_API_KEY, {
      configurable: true,
      value: runtime.api,
    });
    window.dispatchEvent(new CustomEvent("marinara:response-keeper-ready", { detail: runtime.api }));
    return runtime.api;
  }

  startResponseKeeperPackage();
})();
