// Upstream gap MB-011: packages do not yet have a first-class client-side
// generate request observation/mutation hook.

const FETCH_INTERCEPT_STATE_KEY = "__mariBridgeFetchInterceptState";

export function getApiPath(input) {
  try {
    const url = typeof input === "string" ? input : input?.url || "";
    return new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/u, "") || "/";
  } catch {
    return "";
  }
}

export function classifyApiRequest(input) {
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

export function parseJsonFetchBody(init) {
  if (typeof init?.body !== "string") return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

export function cloneFetchInitWithJsonBody(input, init, body) {
  const nextInit = { ...(init || {}) };
  nextInit.method = String(nextInit.method || (typeof input !== "string" ? input?.method : "") || "POST");
  nextInit.body = JSON.stringify(body);
  const headers = new Headers(nextInit.headers || (typeof input !== "string" ? input?.headers : undefined) || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  nextInit.headers = headers;
  return nextInit;
}

export function installFetchInterceptor(definition = {}) {
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
  installFetchPatch(state);

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
    };
  }
  return window[FETCH_INTERCEPT_STATE_KEY];
}

function installFetchPatch(state) {
  if (state.patchedFetch && window.fetch === state.patchedFetch) return;
  if (typeof state.originalFetch !== "function") state.originalFetch = window.fetch.bind(window);
  state.patchedFetch = (input, init = {}) => runFetchPipeline(state, input, init);
  window.fetch = state.patchedFetch;
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
