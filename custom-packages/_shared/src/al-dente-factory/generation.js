import { emit } from "./events.js";

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

export function createGenerationTracker(state, sse, messages) {
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
