export function parseSsePayloads(text, final = false) {
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

export function parseSseEventPayload(payload) {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export async function apiRequest(path, options = {}) {
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

export async function streamJsonSse(path, body, handlers = {}, options = {}) {
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
