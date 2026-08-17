import { PRESENCE_MESSAGE_KEY, PRESENCE_SCHEMA_VERSION } from "./constants.js";

export function buildPresenceExtraPatch({ extra, rosterIds, presentCharacterIds, alwaysPresentCharacterIds = [] }) {
  const normalizedExtra = normalizeObject(extra);
  const roster = uniqueStrings(rosterIds);
  const rosterSet = new Set(roster);
  const present = uniqueStrings([...uniqueStrings(presentCharacterIds), ...uniqueStrings(alwaysPresentCharacterIds)])
    .filter((id) => rosterSet.has(id));
  const presentSet = new Set(present);
  const currentHidden = uniqueStrings(normalizedExtra.hiddenFromAICharacterIds);
  const nonRosterHidden = currentHidden.filter((id) => !rosterSet.has(id));
  const hiddenRosterIds = roster.filter((id) => !presentSet.has(id));
  const hiddenFromAICharacterIds = uniqueStrings([...nonRosterHidden, ...hiddenRosterIds]);

  return {
    hiddenFromAI: normalizedExtra.hiddenFromAI === true ? true : false,
    hiddenFromAICharacterIds,
    [PRESENCE_MESSAGE_KEY]: {
      version: PRESENCE_SCHEMA_VERSION,
      presentCharacterIds: present,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function readPresenceState(message, rosterIds) {
  const extra = normalizeObject(message?.extra);
  const roster = uniqueStrings(rosterIds);
  const rosterSet = new Set(roster);
  const storedPresence = normalizeObject(extra[PRESENCE_MESSAGE_KEY]);
  if (Array.isArray(storedPresence.presentCharacterIds)) {
    return new Set(uniqueStrings(storedPresence.presentCharacterIds).filter((id) => rosterSet.has(id)));
  }
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
