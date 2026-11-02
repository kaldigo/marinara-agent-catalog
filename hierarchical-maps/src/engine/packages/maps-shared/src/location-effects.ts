export const LOCATION_EFFECTS_KEY = "worldMapsKaldigo";
type RecordValue = Record<string, any>;
export function record(value: unknown): RecordValue {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

/** Own only enabled flags we temporarily changed; preserve counters and every unrelated field. */
export function applyLocationEffects(metadata: RecordValue, excludedIds: readonly string[], imageUrl: string | null | undefined, locationId: string | null): RecordValue {
  const settings = record(metadata[LOCATION_EFFECTS_KEY]);
  const prior = record(settings.disabledEntries);
  const overrides: RecordValue = Object.assign(Object.create(null), record(metadata.entryStateOverrides));
  const disabled: RecordValue = Object.create(null);
  const wanted = new Set(excludedIds);
  for (const [id, saved] of Object.entries(prior)) {
    const current = { ...record(overrides[id]) };
    if (wanted.has(id)) { disabled[id] = saved; continue; }
    // A different current value belongs to somebody else; do not undo their edit.
    if (current.enabled !== false) continue;
    if (record(saved).hadEnabled) current.enabled = record(saved).enabled;
    else delete current.enabled;
    if (Object.keys(current).length) overrides[id] = current;
    else delete overrides[id];
  }
  for (const id of wanted) {
    const current = { ...record(overrides[id]) };
    if (current.enabled !== false) {
      disabled[id] = { hadEnabled: Object.hasOwn(current, "enabled"), ...(Object.hasOwn(current, "enabled") ? { enabled: current.enabled } : {}) };
      overrides[id] = { ...current, enabled: false };
    }
    // Already disabled before our intervention: leave it disabled when we leave.
  }
  const next: RecordValue = { ...metadata, entryStateOverrides: { ...overrides } };
  const nextSettings: RecordValue = { ...settings, disabledEntries: { ...disabled } };
  const background = record(settings.background);
  if (imageUrl !== undefined) {
    if (imageUrl) {
      const manualOverride = background.currentUrl && metadata.background !== background.currentUrl;
      if (!(manualOverride && background.locationId === locationId)) {
        nextSettings.background = { currentUrl: imageUrl, locationId, previousBackground: background.currentUrl && !manualOverride ? background.previousBackground ?? null : metadata.background ?? null };
        next.background = imageUrl;
      }
    } else {
      if (background.currentUrl && metadata.background === background.currentUrl) next.background = background.previousBackground ?? null;
      delete nextSettings.background;
    }
  }
  next[LOCATION_EFFECTS_KEY] = nextSettings;
  return next;
}
