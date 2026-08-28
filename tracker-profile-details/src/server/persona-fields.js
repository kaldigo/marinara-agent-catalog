export const PERSONA_DETAIL_FIELDS = Object.freeze(["Outfit", "Location", "Movement", "Activity"]);

function normalizeName(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function encodeSegment(value) {
  return encodeURIComponent(String(value ?? "").trim() || "_").replace(/\./gu, "%2E");
}

function fieldLocked(fieldLocks, name) {
  return fieldLocks?.[`player.custom.name:${encodeSegment(name)}.value`] === true;
}

export function mergePersonaDetailFields(currentFields, update, fieldLocks) {
  const current = Array.isArray(currentFields) ? currentFields : [];
  const incoming = update && typeof update === "object" && !Array.isArray(update) ? update : {};
  const canonicalByName = new Map(PERSONA_DETAIL_FIELDS.map((name) => [normalizeName(name), name]));
  const existing = new Map();
  for (const field of current) {
    const normalized = normalizeName(field?.name);
    if (canonicalByName.has(normalized) && !existing.has(normalized)) existing.set(normalized, field);
  }

  const promoted = [];
  for (const name of PERSONA_DETAIL_FIELDS) {
    const normalized = normalizeName(name);
    const previous = existing.get(normalized);
    const incomingKey = Object.keys(incoming).find((key) => normalizeName(key) === normalized);
    if (incomingKey === undefined && !previous) continue;
    const value = fieldLocked(fieldLocks, previous?.name ?? name)
      ? previous?.value ?? ""
      : incomingKey === undefined
        ? previous?.value ?? ""
        : String(incoming[incomingKey] ?? "");
    promoted.push({ ...(previous ?? {}), name, value });
  }

  const unrelated = current.filter((field) => !canonicalByName.has(normalizeName(field?.name)));
  return [...promoted, ...unrelated];
}

export async function applyPersonaDetailResult(scope) {
  const data = scope?.result?.data;
  const update = data?.trackerFields ?? data?.fields;
  if (!update || typeof update !== "object" || Array.isArray(update)) return null;
  const currentState = await scope.state.read();
  if (!currentState || typeof currentState !== "object") return null;
  const currentPlayerStats = currentState.playerStats && typeof currentState.playerStats === "object" && !Array.isArray(currentState.playerStats)
    ? currentState.playerStats
    : {};
  const customTrackerFields = mergePersonaDetailFields(currentPlayerStats.customTrackerFields, update, currentState.fieldLocks);
  const nextPlayerStats = { ...currentPlayerStats, customTrackerFields };
  await scope.state.update({ playerStats: nextPlayerStats });
  scope.emitPatch?.({ playerStats: nextPlayerStats });
  return nextPlayerStats;
}
