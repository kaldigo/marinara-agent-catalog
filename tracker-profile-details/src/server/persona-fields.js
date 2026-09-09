import { PERSONA_DETAIL_FIELDS, mergePersonaDetailFields, normalizeTrackerName } from "../../../_tracker-codecs/profile-details.js";

const DETAIL_NAMES = new Set(PERSONA_DETAIL_FIELDS.map(normalizeTrackerName));

function record(value) {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export { PERSONA_DETAIL_FIELDS, mergePersonaDetailFields };

export function filterPersonaDetailFieldsFromCustomTracker(_scope, fields) {
  return Array.isArray(fields) ? fields.filter((field) => !DETAIL_NAMES.has(normalizeTrackerName(field?.name))) : fields;
}

export function formatPersonaDetailContext(scope) {
  const playerStats = record(record(scope?.latestGameState)?.playerStats);
  const values = new Map();
  for (const field of Array.isArray(playerStats?.customTrackerFields) ? playerStats.customTrackerFields : []) {
    const key = normalizeTrackerName(field?.name);
    const value = typeof field?.value === "string" ? field.value.trim() : "";
    if (DETAIL_NAMES.has(key) && value && !values.has(key)) values.set(key, value);
  }
  const lines = PERSONA_DETAIL_FIELDS.flatMap((name) => values.has(normalizeTrackerName(name)) ? [`${name}: ${values.get(normalizeTrackerName(name))}`] : []);
  return lines.length ? { label: "Persona Details", content: lines.join("\n") } : null;
}

export async function applyPersonaDetailResult(scope) {
  const update = scope?.result?.data?.trackerFields ?? scope?.result?.data?.fields;
  if (!record(update)) return null;
  const currentState = await scope.state.read();
  if (!record(currentState)) return null;
  const currentPlayerStats = record(currentState.playerStats) ?? {};
  const nextPlayerStats = { ...currentPlayerStats, customTrackerFields: mergePersonaDetailFields(currentPlayerStats.customTrackerFields, update, currentState.fieldLocks) };
  await scope.state.update({ playerStats: nextPlayerStats });
  scope.emitPatch?.({ playerStats: nextPlayerStats });
  return nextPlayerStats;
}
