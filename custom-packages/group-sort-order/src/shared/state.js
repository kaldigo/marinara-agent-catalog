export const GROUP_SORT_ORDER_AGENT_TYPE = "group-sort-order";
export const GROUP_SORT_ORDER_STATE_KEY = "groupSortOrder";
export const NEXT_SPEAKER_MARKER = "<next_speaker>candidate-id</next_speaker>";

export const DEFAULT_GROUP_SORT_PROMPT_TEMPLATE = [
  "At the very end of your response, choose exactly one participant who should speak next in this roleplay group chat.",
  "Choose from the supplied candidates using the current scene, relevance, personality, and who has spoken recently.",
  "Never choose the participant who is currently responding.",
  "Candidates:",
  "{{candidates}}",
  "Append exactly one terminal marker after the response text:",
  "{{marker}}",
  "Put only the selected candidate ID inside the marker. Do not add prose, JSON, or markdown after it.",
].join("\n");

export const DEFAULT_GROUP_SORT_SELECTOR_PROMPT = [
  "You are a hidden next-participant selector for a roleplay group chat.",
  "Choose exactly one supplied candidate to speak next using the current scene, relevance, personality, talkativeness, and who spoke recently.",
  "Never choose the participant who just spoke.",
  'Return ONLY a valid JSON array containing one candidate ID, such as ["candidate-id"]. No prose or markdown.',
].join("\n");

export function normalizeObject(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean))];
}

export function isGroupSortEnabled(chat) {
  const metadata = normalizeObject(chat?.metadata);
  return metadata.enableAgents === true && uniqueStrings(metadata.activeAgentIds).includes(GROUP_SORT_ORDER_AGENT_TYPE);
}

export function resolveActiveCharacterIds(chat) {
  const inactive = new Set(uniqueStrings(normalizeObject(chat?.metadata).inactiveCharacterIds));
  return uniqueStrings(chat?.characterIds).filter((id) => !inactive.has(id));
}

export function normalizeGroupSortState(value) {
  const state = normalizeObject(value);
  return {
    includePersonaCandidate: state.includePersonaCandidate !== false,
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

export function buildCandidateHash(candidates, includePersonaCandidate) {
  return JSON.stringify({
    includePersonaCandidate: includePersonaCandidate === true,
    candidates: (candidates ?? []).map(({ id, name, kind }) => ({ id, name, kind })),
  });
}

export function buildInstructionText(candidates, currentParticipantId, promptTemplate = DEFAULT_GROUP_SORT_PROMPT_TEMPLATE) {
  const selectable = filterCandidates(candidates, currentParticipantId);
  if (selectable.length === 0) return "";
  const candidateText = selectable
    .map((candidate) => `- id: ${candidate.id}\n  name: ${candidate.name}\n  kind: ${candidate.kind}`)
    .join("\n");
  return String(promptTemplate || DEFAULT_GROUP_SORT_PROMPT_TEMPLATE)
    .replaceAll("{{candidates}}", candidateText)
    .replaceAll("{{marker}}", NEXT_SPEAKER_MARKER)
    .replaceAll("{{excluded_candidate_id}}", String(currentParticipantId ?? ""));
}

export function filterCandidates(candidates, excludedId) {
  const excluded = String(excludedId ?? "").trim();
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate?.id && candidate.id !== excluded);
}

export function resolveMessageParticipant(message, candidates) {
  if (message?.role === "user") return candidates.find((candidate) => candidate.kind === "persona") ?? null;
  if (message?.role !== "assistant" || !message.characterId) return null;
  return candidates.find((candidate) => candidate.kind === "character" && candidate.id === message.characterId) ?? null;
}

export function resolveLatestParticipant(messages, candidates) {
  for (const message of [...(Array.isArray(messages) ? messages : [])].reverse()) {
    const participant = resolveMessageParticipant(message, candidates);
    if (participant) return participant;
  }
  return null;
}

export function deriveNextParticipant({ state, messages, candidates, candidateHash }) {
  const normalized = normalizeGroupSortState(state);
  if (!candidateHash || normalized.candidateHash !== candidateHash) return null;
  const latest = [...(messages ?? [])].reverse().find((message) => message?.id && ["user", "assistant"].includes(message.role));
  if (!latest) return null;
  const swipeIndex = Number.isInteger(latest.activeSwipeIndex) ? latest.activeSwipeIndex : 0;
  const anchor = normalized.byAnchor[anchorKey(latest.id, swipeIndex)];
  if (!anchor || anchor.candidateHash !== candidateHash) return null;
  const current = resolveMessageParticipant(latest, candidates);
  if (current?.id === anchor.nextParticipantId) return null;
  return candidates.find((candidate) => candidate.id === anchor.nextParticipantId) ?? null;
}

export function upsertAnchor(state, input) {
  const normalized = normalizeGroupSortState(state);
  const key = anchorKey(input.messageId, input.swipeIndex);
  return normalizeGroupSortState({
    ...normalized,
    candidateHash: input.candidateHash,
    byAnchor: {
      ...normalized.byAnchor,
      [key]: {
        messageId: input.messageId,
        swipeIndex: Number.isInteger(input.swipeIndex) ? input.swipeIndex : 0,
        messageParticipantId: String(input.messageParticipantId ?? ""),
        nextParticipantId: input.nextParticipantId,
        candidateHash: input.candidateHash,
        source: input.source === "refresh" ? "refresh" : "marker",
        selectedAt: input.selectedAt ?? new Date().toISOString(),
      },
    },
  });
}

export function parseSmartGroupSelectionIds(raw, candidates) {
  const cleaned = String(raw ?? "").trim().replace(/```(?:json)?\s*/giu, "").replace(/```/gu, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  let parsed;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const validIds = new Set(candidates.map((candidate) => String(candidate.id)));
  const names = new Map(candidates.map((candidate) => [normalize(candidate.name), String(candidate.id)]));
  return [...new Set(parsed.map((value) => {
    const text = String(value).trim();
    return validIds.has(text) ? text : names.get(normalize(text)) || "";
  }).filter((id) => validIds.has(id)))];
}

export function anchorKey(messageId, swipeIndex) {
  return `${messageId}:${Number.isInteger(swipeIndex) ? swipeIndex : 0}`;
}

function normalizeAnchorMap(value) {
  const source = normalizeObject(value);
  const output = {};
  for (const [key, raw] of Object.entries(source)) {
    const anchor = normalizeObject(raw);
    const nextParticipantId = String(anchor.nextParticipantId ?? anchor.nextSpeakerId ?? "").trim();
    if (!anchor.messageId || !nextParticipantId || !anchor.candidateHash) continue;
    output[key] = {
      messageId: String(anchor.messageId),
      swipeIndex: Number.isInteger(anchor.swipeIndex) ? anchor.swipeIndex : 0,
      messageParticipantId: String(anchor.messageParticipantId ?? anchor.messageSpeakerId ?? ""),
      nextParticipantId,
      candidateHash: String(anchor.candidateHash),
      source: anchor.source === "refresh" ? "refresh" : "marker",
      selectedAt: String(anchor.selectedAt ?? anchor.parsedAt ?? ""),
    };
  }
  return output;
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}
