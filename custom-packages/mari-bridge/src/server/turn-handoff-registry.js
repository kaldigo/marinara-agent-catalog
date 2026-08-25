const TERMINAL_MARKER_RE = /(?:\r?\n\s*)?(?:<|&lt;?)\s*;?\s*next_speaker\s*;?\s*(?:>|&gt;?)\s*;?\s*([^<\s&]+?)\s*;?\s*(?:<|&lt;?)\s*;?\s*\/\s*;?\s*next_speaker\s*;?\s*(?:>|&gt;?)\s*;?\s*$/iu;
const MARKER_OPEN_PREFIXES = Object.freeze(["<next_speaker", "&lt;next_speaker"]);

function parseMetadata(value) {
  if (typeof value !== "string") return value && typeof value === "object" ? value : {};
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function activeAgentIds(metadata) {
  const value = parseMetadata(metadata);
  if (value.enableAgents !== true) return [];
  return Array.isArray(value.activeAgentIds) ? value.activeAgentIds.map(String) : [];
}

function normalizeParticipant(value) {
  const id = String(value?.id ?? "").trim();
  const kind = value?.kind === "persona" ? "persona" : value?.kind === "character" ? "character" : "";
  if (!id || !kind) return null;
  return Object.freeze({
    id,
    kind,
    name: String(value?.name ?? id).trim() || id,
  });
}

function extractTerminalMarker(content) {
  const source = String(content ?? "");
  const match = source.match(TERMINAL_MARKER_RE);
  if (!match) return null;
  const participantId = String(match[1] ?? "").trim().replace(/^;+|;+$/gu, "");
  if (!participantId) return null;
  return Object.freeze({ participantId, content: source.replace(TERMINAL_MARKER_RE, "").trimEnd() });
}

function createTerminalMarkerStreamFilter() {
  let buffer = "";
  let markerStarted = false;
  const overlap = Math.max(...MARKER_OPEN_PREFIXES.map((prefix) => prefix.length)) - 1;
  return Object.freeze({
    push(chunk) {
      const combined = buffer + String(chunk ?? "");
      if (markerStarted) {
        buffer = combined;
        return "";
      }
      const lower = combined.toLocaleLowerCase();
      const markerIndex = MARKER_OPEN_PREFIXES.reduce((earliest, prefix) => {
        const index = lower.indexOf(prefix);
        return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest;
      }, -1);
      if (markerIndex >= 0) {
        markerStarted = true;
        buffer = combined.slice(markerIndex);
        return combined.slice(0, markerIndex);
      }
      if (combined.length <= overlap) {
        buffer = combined;
        return "";
      }
      buffer = combined.slice(-overlap);
      return combined.slice(0, -overlap);
    },
    flush() {
      const pending = buffer;
      buffer = "";
      markerStarted = false;
      return extractTerminalMarker(pending)?.content ?? pending;
    },
  });
}

function compare(left, right) {
  return right.priority - left.priority || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id);
}

export function createTurnHandoffRegistry() {
  const registrations = new Map();

  function active(scope) {
    const ids = new Set(activeAgentIds(scope?.chatMetadata));
    return [...registrations.values()]
      .filter((item) => item.agentTypes.some((agentType) => ids.has(agentType)))
      .sort(compare);
  }

  async function firstResult(method, scope) {
    const candidates = scope?.chatMetadata === undefined
      ? [...registrations.values()].sort(compare)
      : active(scope);
    for (const registration of candidates) {
      const handler = registration[method];
      if (typeof handler !== "function") continue;
      const result = await handler(Object.freeze({ ...scope, ownerId: registration.ownerId }));
      if (result != null) return Object.freeze({ registration, result });
    }
    return null;
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const agentTypes = [...new Set((input.agentTypes ?? []).map(String).map((value) => value.trim()).filter(Boolean))];
      if (!id || agentTypes.length === 0 || typeof input.resolve !== "function" || typeof input.validate !== "function") {
        throw new TypeError("Turn handoff registration requires id, agentTypes, resolve, and validate");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate turn handoff ${key}`);
      const registration = Object.freeze({
        ownerId,
        id,
        agentTypes: Object.freeze(agentTypes),
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        resolve: input.resolve,
        validate: input.validate,
        commit: typeof input.commit === "function" ? input.commit : null,
        view: typeof input.view === "function" ? input.view : null,
        update: typeof input.update === "function" ? input.update : null,
        refresh: typeof input.refresh === "function" ? input.refresh : null,
      });
      registrations.set(key, registration);
      return () => registrations.delete(key);
    },
    resolvePolicy(scope, fallback) {
      return active(scope).length > 0
        ? Object.freeze({ groupChatMode: "individual", groupResponseOrder: "smart" })
        : fallback;
    },
    async select(scope, fallback) {
      for (const registration of active(scope)) {
        const participant = normalizeParticipant(await registration.resolve(Object.freeze({ ...scope, ownerId: registration.ownerId })));
        if (!participant) continue;
        return Object.freeze({
          characterIds: Object.freeze(participant.kind === "character" ? [participant.id] : []),
          participant,
          participantKind: participant.kind,
          source: "stored",
        });
      }
      const selected = await fallback();
      return Object.freeze({
        characterIds: Object.freeze(Array.isArray(selected) ? selected : []),
        participant: null,
        participantKind: null,
        source: "fallback",
      });
    },
    createStreamFilter(scope) {
      return active(scope).length > 0 ? createTerminalMarkerStreamFilter() : null;
    },
    async processResponse(scope, content) {
      const extracted = extractTerminalMarker(content);
      if (!extracted) return null;
      for (const registration of active(scope)) {
        const participant = normalizeParticipant(await registration.validate(Object.freeze({
          ...scope,
          ownerId: registration.ownerId,
          participantId: extracted.participantId,
        })));
        if (!participant) continue;
        return Object.freeze({
          ownerId: registration.ownerId,
          registrationId: registration.id,
          content: extracted.content,
          participant,
        });
      }
      return Object.freeze({ content: extracted.content, participant: null, ownerId: null, registrationId: null });
    },
    async commit(scope, processed) {
      if (!processed?.ownerId || !processed?.registrationId || !processed?.participant) return null;
      const registration = registrations.get(`${processed.ownerId}:${processed.registrationId}`);
      if (!registration?.commit) return null;
      return registration.commit(Object.freeze({ ...scope, participant: processed.participant }));
    },
    async view(scope) {
      return (await firstResult("view", scope))?.result ?? null;
    },
    async update(scope) {
      return (await firstResult("update", scope))?.result ?? null;
    },
    async refresh(scope) {
      return (await firstResult("refresh", scope))?.result ?? null;
    },
    snapshot() {
      return Object.freeze([...registrations.values()].map((item) => Object.freeze({
        ownerId: item.ownerId,
        id: item.id,
        agentTypes: item.agentTypes,
      })));
    },
    clear() { registrations.clear(); },
  });
}

export const __test = Object.freeze({ extractTerminalMarker, createTerminalMarkerStreamFilter });
