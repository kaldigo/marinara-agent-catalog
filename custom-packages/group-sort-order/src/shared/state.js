export const GROUP_SORT_ORDER_PACKAGE_ID = "group-sort-order";
export const GROUP_SORT_ORDER_AGENT_TYPE = "group-sort-order";
export const GROUP_SORT_ORDER_STATE_KEY = "groupSortOrder";
export const NEXT_SPEAKER_MARKER_RE = /(?:\r?\n\s*)?<next_speaker>\s*([^<\s]+)\s*<\/next_speaker>\s*$/u;

export function normalizeObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function uniqueStrings(value) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== "string" || !item.trim() || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function isGroupSortEnabled(chat) {
  const meta = normalizeObject(chat?.metadata);
  const activeAgentIds = uniqueStrings(meta.activeAgentIds);
  return meta.enableAgents !== false && activeAgentIds.includes(GROUP_SORT_ORDER_PACKAGE_ID);
}

export function normalizeGroupSortState(raw) {
  const state = normalizeObject(raw);
  return {
    includePersonaCandidate: state.includePersonaCandidate === true,
    personaCandidate: normalizeCandidate(state.personaCandidate, "persona"),
    candidateHash: typeof state.candidateHash === "string" ? state.candidateHash : "",
    byAnchor: normalizeAnchorMap(state.byAnchor),
  };
}

export function readGroupSortState(metadata) {
  return normalizeGroupSortState(normalizeObject(metadata)[GROUP_SORT_ORDER_STATE_KEY]);
}

export function writeGroupSortState(metadata, patch) {
  const base = normalizeObject(metadata);
  const current = readGroupSortState(base);
  return {
    ...base,
    [GROUP_SORT_ORDER_STATE_KEY]: normalizeGroupSortState({
      ...current,
      ...patch,
      byAnchor: patch?.byAnchor ?? current.byAnchor,
    }),
  };
}

export function resolveActiveCharacterIds(chat) {
  const characterIds = uniqueStrings(chat?.characterIds);
  const inactive = new Set(uniqueStrings(normalizeObject(chat?.metadata).inactiveCharacterIds));
  return characterIds.filter((id) => !inactive.has(id));
}

export function buildCandidateHash(candidates, options = {}) {
  return stableJson({
    includePersonaCandidate: options.includePersonaCandidate === true,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind,
    })),
  });
}

export function buildInstructionText(candidates) {
  if (!Array.isArray(candidates) || candidates.length <= 2) return "";
  const lines = candidates.flatMap((candidate) => [`- id: ${candidate.id}`, `  name: ${candidate.name}`]);
  return [
    "At the very end of your response, choose which candidate should speak next in this roleplay group chat, based on the latest user message, recent scene context, relevance, personality, and who has spoken recently.",
    "Use only one candidate ID from this list:",
    ...lines,
    "Do not always choose the first candidate. Avoid choosing the same candidate twice in a row unless the context clearly calls for it.",
    "Append exactly one terminal marker after the response text:",
    "<next_speaker>candidate-id</next_speaker>",
    "Use the selected ID only inside the marker. Do not use names, JSON, prose, or markdown inside the marker.",
  ].join("\n");
}

export function parseTerminalNextSpeakerMarker(content) {
  const match = String(content || "").match(NEXT_SPEAKER_MARKER_RE);
  if (!match) return null;
  return { speakerId: match[1].trim() };
}

export function parseSmartGroupSelectionIds(raw, candidates) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "");
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (arrayStart < 0 && objectStart < 0) return [];

  let parsed;
  try {
    parsed =
      arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)
        ? JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
        : JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
  } catch {
    return [];
  }

  const parsedRecord = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const rawIds = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsedRecord.characterIds)
      ? parsedRecord.characterIds
      : Array.isArray(parsedRecord.characters)
        ? parsedRecord.characters
        : [];
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const validIds = new Set(candidateList.map((candidate) => candidate.id));
  const namesByLower = new Map(
    candidateList
      .filter((candidate) => typeof candidate.name === "string" && candidate.name.trim())
      .map((candidate) => [normalizeTextForMatch(candidate.name), candidate.id]),
  );
  const selected = [];

  for (const rawId of rawIds) {
    const value = String(rawId).trim();
    const id = validIds.has(value) ? value : (namesByLower.get(normalizeTextForMatch(value)) ?? "");
    if (validIds.has(id) && !selected.includes(id)) selected.push(id);
  }

  return selected;
}

export function stripTerminalNextSpeakerMarker(content) {
  return String(content || "").replace(NEXT_SPEAKER_MARKER_RE, "").trimEnd();
}

export function deriveNextSpeaker({ state, messages, candidates, candidateHash }) {
  const normalizedState = normalizeGroupSortState(state);
  if (!candidateHash || normalizedState.candidateHash !== candidateHash) return null;
  const candidateById = new Map((candidates || []).map((candidate) => [candidate.id, candidate]));
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message?.id) continue;
    const swipeIndex = Number.isInteger(message.activeSwipeIndex) ? message.activeSwipeIndex : 0;
    const anchor = normalizedState.byAnchor[anchorKey(message.id, swipeIndex)];
    if (!anchor || anchor.candidateHash !== candidateHash) continue;
    const candidate = candidateById.get(anchor.nextSpeakerId);
    return candidate || null;
  }
  return null;
}

export function upsertAnchor(state, anchor) {
  const normalized = normalizeGroupSortState(state);
  const key = anchorKey(anchor.messageId, anchor.swipeIndex);
  return normalizeGroupSortState({
    ...normalized,
    candidateHash: anchor.candidateHash,
    byAnchor: {
      ...normalized.byAnchor,
      [key]: {
        messageId: anchor.messageId,
        swipeIndex: anchor.swipeIndex,
        messageSpeakerId: anchor.messageSpeakerId ?? "",
        nextSpeakerId: anchor.nextSpeakerId,
        candidateHash: anchor.candidateHash,
        parsedAt: anchor.parsedAt ?? new Date().toISOString(),
      },
    },
  });
}

export function anchorKey(messageId, swipeIndex) {
  return `${messageId}:${Number.isInteger(swipeIndex) ? swipeIndex : 0}`;
}

function normalizeCandidate(value, fallbackKind = "character") {
  const candidate = normalizeObject(value);
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  return {
    id: candidate.id,
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : candidate.id,
    kind: candidate.kind === "persona" ? "persona" : fallbackKind,
  };
}

function normalizeAnchorMap(value) {
  const source = normalizeObject(value);
  const out = {};
  for (const [key, raw] of Object.entries(source)) {
    const anchor = normalizeObject(raw);
    if (
      typeof anchor.messageId !== "string" ||
      typeof anchor.nextSpeakerId !== "string" ||
      typeof anchor.candidateHash !== "string"
    ) {
      continue;
    }
    const swipeIndex = Number.isInteger(anchor.swipeIndex) ? anchor.swipeIndex : 0;
    out[key] = {
      messageId: anchor.messageId,
      swipeIndex,
      messageSpeakerId: typeof anchor.messageSpeakerId === "string" ? anchor.messageSpeakerId : "",
      nextSpeakerId: anchor.nextSpeakerId,
      candidateHash: anchor.candidateHash,
      parsedAt: typeof anchor.parsedAt === "string" ? anchor.parsedAt : "",
    };
  }
  return out;
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function normalizeTextForMatch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortJson(v)]));
}
