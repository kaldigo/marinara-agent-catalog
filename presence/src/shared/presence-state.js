import { PRESENCE_PACKAGE_KEY, PRESENCE_SCHEMA_VERSION } from "./constants.js";

export function buildPresenceExtraPatch({ extra, rosterIds, presentCharacterIds, now = new Date().toISOString() }) {
  const normalizedExtra = normalizeObject(extra);
  const roster = uniqueStrings(rosterIds);
  const rosterSet = new Set(roster);
  const present = uniqueStrings(presentCharacterIds).filter((id) => rosterSet.has(id));
  const presentSet = new Set(present);
  const previousPresence = normalizeObject(normalizedExtra[PRESENCE_PACKAGE_KEY]);
  const previousOwned = new Set(uniqueStrings(previousPresence.ownedHiddenFromAICharacterIds));
  const currentHidden = uniqueStrings(normalizedExtra.hiddenFromAICharacterIds);
  const manualHidden = currentHidden.filter((id) => !previousOwned.has(id));
  const ownedHidden = roster.filter((id) => !presentSet.has(id));
  const hiddenFromAICharacterIds = uniqueStrings([...manualHidden, ...ownedHidden]);

  return {
    hiddenFromAI: normalizedExtra.hiddenFromAI === true ? true : false,
    hiddenFromAICharacterIds,
    [PRESENCE_PACKAGE_KEY]: {
      version: PRESENCE_SCHEMA_VERSION,
      presentCharacterIds: present,
      ownedHiddenFromAICharacterIds: ownedHidden,
      updatedAt: now,
    },
  };
}

export function readPresenceState(message, rosterIds) {
  const extra = normalizeObject(message?.extra);
  const presence = normalizeObject(extra[PRESENCE_PACKAGE_KEY]);
  const roster = uniqueStrings(rosterIds);
  const rosterSet = new Set(roster);
  if (Array.isArray(presence.presentCharacterIds)) {
    return new Set(uniqueStrings(presence.presentCharacterIds).filter((id) => rosterSet.has(id)));
  }
  return new Set(roster);
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
