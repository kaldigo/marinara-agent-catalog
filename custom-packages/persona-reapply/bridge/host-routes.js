// Upstream gap MB-008: packages do not yet have stable host resource write APIs,
// so package servers sometimes need to call Marinara's own routes through Fastify.

// Calls a host Fastify JSON route and normalizes JSON parsing/error reporting.
export async function injectHostJson(app, method, url, payload, options = {}) {
  if (!app || typeof app.inject !== "function") {
    throw new Error("Mari bridge host JSON injection requires Fastify app.inject.");
  }
  const headers = { ...(options.headers || {}) };
  const internalHeader = typeof options.internalHeader === "string" ? options.internalHeader : "";
  if (internalHeader) headers[internalHeader] = options.internalHeaderValue ?? "1";
  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(readInjectError(response));
  }
  if (response.statusCode === 204 || !response.payload) return {};
  return JSON.parse(response.payload);
}

// Creates a package-scoped JSON injector with a fixed internal request header.
export function createHostJsonInjector({ app, internalHeader, internalHeaderValue = "1" } = {}) {
  return (method, url, payload, options = {}) =>
    injectHostJson(app, method, url, payload, {
      ...options,
      internalHeader: options.internalHeader || internalHeader,
      internalHeaderValue: options.internalHeaderValue ?? internalHeaderValue,
    });
}

function readInjectError(response) {
  const fallback = `${response.statusCode} ${response.statusMessage || "Host route failed"}`;
  if (!response.payload) return fallback;
  try {
    const parsed = JSON.parse(response.payload);
    return parsed?.error || parsed?.message || fallback;
  } catch {
    return response.payload || fallback;
  }
}
