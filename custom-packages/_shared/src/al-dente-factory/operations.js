import { emit } from "./events.js";
import { normalizeId, toCleanString } from "./strings.js";

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

export function createOperationTracker(state, wakeLock) {
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
