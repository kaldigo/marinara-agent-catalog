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
  };
}

export function buildVisibilityDeltaPatch({ extra, hiddenCharacterIds = [], visibleCharacterIds = [] }) {
  const normalizedExtra = normalizeObject(extra);
  const hidden = new Set(uniqueStrings(normalizedExtra.hiddenFromAICharacterIds));
  for (const characterId of uniqueStrings(hiddenCharacterIds)) hidden.add(characterId);
  for (const characterId of uniqueStrings(visibleCharacterIds)) hidden.delete(characterId);
  return {
    hiddenFromAI: normalizedExtra.hiddenFromAI === true,
    hiddenFromAICharacterIds: [...hidden],
  };
}

export function visibilityPatchChanges(extra, patch) {
  return visibilityChangedCharacterIds(extra, patch).length > 0;
}

export function assertVisibilityPatchScope({ extra, patch, allowedCharacterIds, operation = "Presence mutation" }) {
  const normalizedExtra = normalizeObject(extra);
  const normalizedPatch = normalizeObject(patch);
  const currentGlobal = normalizedExtra.hiddenFromAI === true;
  const nextGlobal = normalizedPatch.hiddenFromAI === true;
  if (currentGlobal !== nextGlobal) {
    throw new Error(`${operation} attempted to change global Hide From AI state`);
  }
  const allowed = new Set(uniqueStrings(allowedCharacterIds));
  const unexpected = visibilityChangedCharacterIds(normalizedExtra, normalizedPatch)
    .filter((characterId) => !allowed.has(characterId));
  if (unexpected.length) {
    throw new Error(`${operation} attempted to change unrelated character visibility: ${unexpected.join(", ")}`);
  }
  return normalizedPatch;
}

export function visibilityChangedCharacterIds(extra, patch) {
  const current = new Set(uniqueStrings(normalizeObject(extra).hiddenFromAICharacterIds));
  const next = new Set(uniqueStrings(normalizeObject(patch).hiddenFromAICharacterIds));
  return uniqueStrings([
    ...[...current].filter((id) => !next.has(id)),
    ...[...next].filter((id) => !current.has(id)),
  ]);
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
