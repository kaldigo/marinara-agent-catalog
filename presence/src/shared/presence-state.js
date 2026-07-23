export function buildPresenceExtraPatch({ extra, rosterIds, presentCharacterIds }) {
  const normalizedExtra = normalizeObject(extra);
  const roster = uniqueStrings(rosterIds);
  const rosterSet = new Set(roster);
  const present = uniqueStrings(presentCharacterIds).filter((id) => rosterSet.has(id));
  const presentSet = new Set(present);
  const currentHidden = uniqueStrings(normalizedExtra.hiddenFromAICharacterIds);
  const nonRosterHidden = currentHidden.filter((id) => !rosterSet.has(id));
  const hiddenRosterIds = roster.filter((id) => !presentSet.has(id));
  const hiddenFromAICharacterIds = uniqueStrings([...nonRosterHidden, ...hiddenRosterIds]);

  return {
    hiddenFromAI: normalizedExtra.hiddenFromAI === true ? true : false,
    hiddenFromAICharacterIds,
  };
}

export function readPresenceState(message, rosterIds) {
  const extra = normalizeObject(message?.extra);
  const roster = uniqueStrings(rosterIds);
  const rosterSet = new Set(roster);
  const hidden = new Set(uniqueStrings(extra.hiddenFromAICharacterIds).filter((id) => rosterSet.has(id)));
  return new Set(roster.filter((id) => !hidden.has(id)));
}

export function normalizeObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).map((id) => id.trim()).filter(Boolean))];
}
