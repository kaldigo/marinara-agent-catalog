import { emit } from "./events.js";
import { normalizeId } from "./strings.js";

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

export function createFetchHub(state, routes) {
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
