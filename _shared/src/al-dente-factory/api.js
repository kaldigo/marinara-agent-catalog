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

export function createApiClient(state) {
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
