export const GROUP_SORT_ORDER_AGENT_TYPE = "group-sort-order";
export const DEFAULT_GROUP_SORT_SELECTOR_PROMPT = [
  "You are a hidden response orchestrator for a roleplay group chat.",
  "Choose which character or characters should respond next from the supplied candidates.",
  "Use the latest message, recent scene context, relevance, personality, talkativeness, and who spoke recently.",
  "Usually choose one character. Choose multiple only when several characters have a strong immediate reason to respond.",
  "Do not always choose the first candidate, and avoid choosing the character who just spoke unless the context requires it.",
  'Return ONLY a valid JSON array of character IDs, such as ["character-id"]. No prose or markdown.',
].join("\n");

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

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}
