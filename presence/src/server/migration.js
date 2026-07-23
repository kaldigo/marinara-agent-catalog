import { LEGACY_EXTENSION_KEY, PRESENCE_MIGRATION_VERSION, PRESENCE_PACKAGE_KEY } from "../shared/constants.js";
import { buildPresenceExtraPatch, normalizeObject, uniqueStrings } from "../shared/presence-state.js";

export function planExtensionMigration({ messages, roster, now = new Date().toISOString() }) {
  const rosterList = Array.isArray(roster) ? roster : [];
  const rosterIds = uniqueStrings(rosterList.map((character) => character?.id));
  const names = new Map();
  for (const character of rosterList) {
    const id = String(character?.id || "").trim();
    const name = normalizeName(character?.name);
    if (!id || !name) continue;
    const existing = names.get(name) || [];
    existing.push(id);
    names.set(name, existing);
  }

  const patches = [];
  const unresolved = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id) continue;
    const extra = normalizeObject(message.extra);
    if (extra[PRESENCE_PACKAGE_KEY]) continue;
    const legacy = normalizeObject(extra[LEGACY_EXTENSION_KEY]);
    if (!legacy || !Object.keys(legacy).length) continue;

    const legacyPresentIds = legacy.mode === "default" ? rosterIds : legacy.presentCharacterIds;
    const resolved = resolveLegacyPresentIds(legacyPresentIds, rosterIds, names);
    if (resolved.unresolved.length) {
      unresolved.push({ messageId: message.id, values: resolved.unresolved });
      continue;
    }

    patches.push({
      messageId: message.id,
      patch: {
        ...buildPresenceExtraPatch({
          extra,
          rosterIds,
          presentCharacterIds: resolved.ids,
          now,
        }),
        marinaraPresenceMigration: {
          from: "presence-extension",
          version: PRESENCE_MIGRATION_VERSION,
          migratedAt: now,
        },
      },
    });
  }

  return { patches, unresolved };
}

function resolveLegacyPresentIds(values, rosterIds, names) {
  const rosterSet = new Set(rosterIds);
  const ids = [];
  const unresolved = [];
  for (const value of uniqueStrings(values)) {
    if (rosterSet.has(value)) {
      ids.push(value);
      continue;
    }
    const matches = names.get(normalizeName(value)) || [];
    if (matches.length === 1) ids.push(matches[0]);
    else unresolved.push(value);
  }
  return { ids: uniqueStrings(ids), unresolved };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
