export const PERSONA_DETAIL_FIELDS = Object.freeze(["Outfit", "Location", "Movement", "Activity"]);
export const CHARACTER_DETAIL_FIELDS = Object.freeze(["Location", "Movement", "Activity"]);

export function normalizeTrackerName(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function encodeSegment(value) {
  return encodeURIComponent(String(value ?? "").trim() || "_").replace(/\./gu, "%2E");
}

function valueLocked(fieldLocks, name) {
  return fieldLocks?.[`player.custom.name:${encodeSegment(name)}.value`] === true;
}

export function mergePersonaDetailFields(currentFields, update, fieldLocks) {
  const current = Array.isArray(currentFields) ? currentFields : [];
  const incoming = update && typeof update === "object" && !Array.isArray(update) ? update : {};
  const canonical = new Map(PERSONA_DETAIL_FIELDS.map((name) => [normalizeTrackerName(name), name]));
  const existing = new Map();
  for (const field of current) {
    const key = normalizeTrackerName(field?.name);
    if (canonical.has(key) && !existing.has(key)) existing.set(key, field);
  }
  const promoted = [];
  for (const name of PERSONA_DETAIL_FIELDS) {
    const key = normalizeTrackerName(name);
    const previous = existing.get(key);
    const incomingKey = Object.keys(incoming).find((candidate) => normalizeTrackerName(candidate) === key);
    if (incomingKey === undefined && !previous) continue;
    const value = valueLocked(fieldLocks, previous?.name ?? name)
      ? previous?.value ?? ""
      : incomingKey === undefined ? previous?.value ?? "" : String(incoming[incomingKey] ?? "");
    promoted.push({ ...(previous ?? {}), name, value });
  }
  return [...promoted, ...current.filter((field) => !canonical.has(normalizeTrackerName(field?.name)))];
}

export function detailsToCharacterCustomFields(row, previous = {}) {
  const next = { ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}) };
  for (const name of CHARACTER_DETAIL_FIELDS) {
    const key = name.charAt(0).toLocaleLowerCase() + name.slice(1);
    if (Object.prototype.hasOwnProperty.call(row, key)) next[name] = String(row[key] ?? "");
  }
  return next;
}
