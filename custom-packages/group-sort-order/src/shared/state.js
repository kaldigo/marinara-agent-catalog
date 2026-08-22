export const GROUP_SORT_ORDER_PACKAGE_ID = "group-sort-order";
export const GROUP_SORT_ORDER_AGENT_TYPE = "group-sort-order";
export const GROUP_SORT_ORDER_STATE_KEY = "groupSortOrder";
export const DEFAULT_NEXT_SPEAKER_MARKER_TEMPLATE = "<next_speaker>{{speaker_id}}</next_speaker>";
export const DEFAULT_GROUP_SORT_PROMPT_TEMPLATE = [
  "At the very end of your response, choose which candidate should speak next in this roleplay group chat, based on the latest user message, recent scene context, relevance, personality, and who has spoken recently.",
  "Use only one candidate ID from this list:",
  "{{candidates}}",
  "Do not always choose the first candidate. Never choose the participant who just posted or is currently responding.",
  "Append exactly one terminal marker after the response text:",
  "{{marker}}",
  "Use the selected ID only inside the marker. Do not use names, JSON, prose, or markdown inside the marker.",
].join("\n");
export const DEFAULT_GROUP_SORT_SELECTOR_PROMPT = [
  "You are a hidden response orchestrator for a roleplay group chat.",
  "Choose which character or characters should respond next, based on the latest user message, recent scene context, relevance, personality, and who has spoken recently.",
  "Usually choose exactly one character. Choose multiple only when multiple characters have a strong immediate reason to answer.",
  "Do not always choose the first character. Never choose the participant who just posted.",
  'Return ONLY a valid JSON array of character IDs, such as ["character-id"]. No prose, no object wrapper, no markdown.',
].join("\n");
const XML_LT = "(?:<|&lt;?)";
const XML_GT = "(?:>|&gt;?)";
const NEXT_SPEAKER_OPEN = `${XML_LT}\\s*;?\\s*next_speaker\\s*;?\\s*${XML_GT}`;
const NEXT_SPEAKER_CLOSE = `${XML_LT}\\s*;?\\s*/\\s*;?\\s*next_speaker\\s*;?\\s*${XML_GT}`;
export const NEXT_SPEAKER_MARKER_RE = new RegExp(
  `(?:\\r?\\n\\s*)?${NEXT_SPEAKER_OPEN}\\s*;?\\s*([^<\\s&]+?)\\s*;?\\s*${NEXT_SPEAKER_CLOSE}\\s*;?\\s*$`,
  "iu",
);

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
  return meta.enableAgents === true && activeAgentIds.includes(GROUP_SORT_ORDER_PACKAGE_ID);
}

export function normalizeGroupSortState(raw) {
  const state = normalizeObject(raw);
  return {
    includePersonaCandidate: state.includePersonaCandidate === true,
    personaCandidate: normalizeCandidate(state.personaCandidate, "persona"),
    markerTemplate: normalizeMarkerTemplate(state.markerTemplate),
    promptTemplate: normalizePromptSetting(state.promptTemplate, DEFAULT_GROUP_SORT_PROMPT_TEMPLATE),
    selectorPrompt: normalizePromptSetting(state.selectorPrompt, DEFAULT_GROUP_SORT_SELECTOR_PROMPT),
    selectorConnectionId: readNonEmptyString(state.selectorConnectionId),
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

export function buildInstructionText(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length <= 2) return "";
  const excludedCandidateId = readNonEmptyString(options.excludedCandidateId);
  const selectableCandidates = filterNextSpeakerCandidates(candidates, excludedCandidateId);
  if (selectableCandidates.length === 0) return "";
  const candidatesText = selectableCandidates.flatMap((candidate) => [`- id: ${candidate.id}`, `  name: ${candidate.name}`]).join("\n");
  const markerTemplate = normalizeMarkerTemplate(options.markerTemplate).replace("{{speaker_id}}", "candidate-id");
  const promptTemplate = normalizePromptSetting(options.promptTemplate, DEFAULT_GROUP_SORT_PROMPT_TEMPLATE);
  return promptTemplate
    .replaceAll("{{candidates}}", candidatesText)
    .replaceAll("{{marker}}", markerTemplate)
    .replaceAll("{{excluded_candidate_id}}", excludedCandidateId);
}

export function normalizeMarkerTemplate(value) {
  const marker = typeof value === "string" ? value.trim() : "";
  return marker && marker.split("{{speaker_id}}").length === 2 ? marker : DEFAULT_NEXT_SPEAKER_MARKER_TEMPLATE;
}

export function parseTerminalNextSpeakerMarker(content, markerTemplate = DEFAULT_NEXT_SPEAKER_MARKER_TEMPLATE) {
  const match = String(content || "").match(markerRegex(markerTemplate));
  if (!match) return null;
  const speakerId = match[1].trim().replace(/^;+|;+$/gu, "");
  return speakerId ? { speakerId } : null;
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

export function stripTerminalNextSpeakerMarker(content, markerTemplate = DEFAULT_NEXT_SPEAKER_MARKER_TEMPLATE) {
  return String(content || "").replace(markerRegex(markerTemplate), "").trimEnd();
}

export function deriveNextSpeaker({ state, messages, candidates, candidateHash }) {
  const normalizedState = normalizeGroupSortState(state);
  if (!candidateHash || normalizedState.candidateHash !== candidateHash) return null;
  const candidateById = new Map((candidates || []).map((candidate) => [candidate.id, candidate]));
  const latest = [...(messages || [])].reverse().find((message) => message?.id && isAnchorableMessage(message));
  if (!latest) return null;
  const swipeIndex = Number.isInteger(latest.activeSwipeIndex) ? latest.activeSwipeIndex : 0;
  const anchor = normalizedState.byAnchor[anchorKey(latest.id, swipeIndex)];
  if (!anchor || anchor.candidateHash !== candidateHash) return null;
  const latestParticipant = resolveMessageParticipantCandidate(latest, candidates);
  if (latestParticipant?.id && anchor.nextSpeakerId === latestParticipant.id) return null;
  return candidateById.get(anchor.nextSpeakerId) || null;
}

export function filterNextSpeakerCandidates(candidates, excludedCandidateId) {
  const excluded = readNonEmptyString(excludedCandidateId);
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate?.id && candidate.id !== excluded);
}

export function resolveLatestParticipantCandidate(messages, candidates) {
  for (const message of [...(Array.isArray(messages) ? messages : [])].reverse()) {
    const participant = resolveMessageParticipantCandidate(message, candidates);
    if (participant) return participant;
  }
  return null;
}

export function resolveMessageParticipantCandidate(message, candidates) {
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const byId = new Map(candidateList.map((candidate) => [candidate.id, candidate]));
  if (message?.role === "assistant") {
    const characterId = readNonEmptyString(message.characterId);
    return characterId ? byId.get(characterId) || null : null;
  }
  if (message?.role === "user") {
    return candidateList.find((candidate) => candidate.kind === "persona") || null;
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

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizePromptSetting(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function markerRegex(markerTemplate) {
  const normalized = normalizeMarkerTemplate(markerTemplate);
  if (normalized === DEFAULT_NEXT_SPEAKER_MARKER_TEMPLATE) return NEXT_SPEAKER_MARKER_RE;
  const [prefix, suffix] = normalized.split("{{speaker_id}}");
  return new RegExp(`(?:\\r?\\n\\s*)?${escapeRegex(prefix)}\\s*([^\\s]+?)\\s*${escapeRegex(suffix)}\\s*$`, "u");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAnchorableMessage(message) {
  return message?.role === "user" || message?.role === "assistant" || !message?.role;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortJson(v)]));
}
