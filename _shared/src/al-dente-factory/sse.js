export function parseSsePayloads(text, final = false) {
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

export function parseSseEventPayload(payload) {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function isSseResponse(response) {
  return Boolean(response?.body && String(response.headers?.get?.("content-type") || "").includes("text/event-stream"));
}

export function wrapSseResponse(response, handlers = {}) {
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

export function createSseSurface() {
  return Object.freeze({
    parsePayloads: parseSsePayloads,
    parseEventPayload: parseSseEventPayload,
    isSseResponse,
    wrapResponse: wrapSseResponse,
  });
}
