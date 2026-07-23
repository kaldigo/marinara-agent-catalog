export function diffSummaryEntries(previousEntries, nextEntries, hint = {}) {
  const previous = indexEntries(previousEntries);
  const next = indexEntries(nextEntries);
  const events = [];

  for (const [id, entry] of next) {
    const old = previous.get(id);
    if (!old) {
      events.push({
        type: hint.source === "generation" ? "generated" : "created",
        summaryId: id,
        entry,
        source: hint.source || "unknown",
      });
      continue;
    }

    if (String(old.content ?? "") !== String(entry.content ?? "")) {
      events.push({ type: "edited", summaryId: id, previous: old, entry, source: hint.source || "unknown" });
    }

    if (Boolean(old.enabled !== false) !== Boolean(entry.enabled !== false)) {
      events.push({
        type: "toggled",
        summaryId: id,
        previous: old,
        entry,
        enabled: entry.enabled !== false,
        source: hint.source || "unknown",
      });
    }
  }

  for (const [id, entry] of previous) {
    if (!next.has(id)) {
      events.push({ type: "deleted", summaryId: id, previous: entry, source: hint.source || "unknown" });
    }
  }

  return events;
}

export function readSummaryEntries(chat) {
  const metadata = normalizeObject(chat?.metadata);
  const entries = metadata.summaryEntries;
  return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object") : [];
}

export function indexEntries(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (id) map.set(id, entry);
  }
  return map;
}

export function inferSummaryHintFromRoute(method, path, body = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const normalizedPath = String(path || "");
  if (normalizedPath.includes("/agent-write-approval/commit") && body?.kind === "summary_update") {
    return { source: "generation" };
  }
  if (normalizedMethod === "POST" && normalizedPath.includes("/generate-summary")) {
    return { source: "manual" };
  }
  if (normalizedMethod === "PATCH" && normalizedPath.includes("/summary-entries")) {
    return { source: "manual", operation: body?.operation || "unknown" };
  }
  return { source: "unknown" };
}

function normalizeObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
