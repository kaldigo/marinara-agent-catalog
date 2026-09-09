import { applyGmNoteUpdates, mergeGmNotesIntoPlayerStats, readGmNotesFromPlayerStats } from "../../../_tracker-codecs/gm-notes.js";
import { detailsToCharacterCustomFields, mergePersonaDetailFields, normalizeTrackerName } from "../../../_tracker-codecs/profile-details.js";
import { UNIFIED_TRACKER_NAMESPACE, normalizeUnifiedSettings } from "./settings.js";

const WORLD_KEYS = Object.freeze(["date", "time", "location", "weather", "temperature"]);
const CHARACTER_TEXT_KEYS = Object.freeze(["outfit", "location", "movement", "activity", "mood", "appearance"]);

function record(value) {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, max = 1_000) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, max) : "";
}

function explicitAliases(value) {
  if (typeof value !== "string") return [];
  const aliases = new Set();
  for (const pattern of [/"([^"\n]{1,80})"/gu, /“([^”\n]{1,80})”/gu, /'([^'\n]{1,80})'/gu, /‘([^’\n]{1,80})’/gu, /\(([^()\n]{1,80})\)/gu]) {
    for (const match of value.matchAll(pattern)) {
      const key = normalizeTrackerName(match[1]);
      if (key) aliases.add(key);
    }
  }
  return [...aliases];
}

function uniqueNameMap(candidates) {
  const map = new Map();
  const duplicates = new Set();
  for (const candidate of candidates) {
    const key = normalizeTrackerName(candidate?.name);
    if (!key) continue;
    if (map.has(key)) duplicates.add(key);
    else map.set(key, candidate);
  }
  for (const key of duplicates) map.delete(key);
  return map;
}

function matchCandidate(row, candidates, byName) {
  const id = text(row?.id ?? row?.characterId, 160).toLocaleLowerCase();
  if (id) {
    const exact = candidates.find((candidate) => text(candidate.id, 160).toLocaleLowerCase() === id);
    if (exact) return exact;
  }
  const exactName = byName.get(normalizeTrackerName(row?.name));
  if (exactName) return exactName;
  const aliases = explicitAliases(row?.name).map((key) => byName.get(key)).filter(Boolean);
  return new Set(aliases.map((candidate) => candidate.id)).size === 1 ? aliases[0] : null;
}

function historyCandidates(history) {
  const rows = [];
  for (const value of Array.isArray(history) ? history : []) {
    const row = record(value);
    if (!row) continue;
    rows.push({ id: text(row.characterId ?? row.id, 160), name: text(row.name, 160), previous: row, historical: true });
  }
  return rows;
}

function previousMap(state, history) {
  const current = Array.isArray(state?.presentCharacters) ? state.presentCharacters : [];
  return uniqueNameMap([
    ...current.map((row) => ({ id: text(row?.characterId, 160), name: text(row?.name, 160), previous: row })),
    ...historyCandidates(history),
  ]);
}

function normalizeStats(incoming, previous, configured) {
  const configuredRows = Array.isArray(configured) ? configured : [];
  if (configuredRows.length === 0) return undefined;
  const incomingByName = uniqueNameMap(Array.isArray(incoming) ? incoming : []);
  const previousByName = uniqueNameMap(Array.isArray(previous) ? previous : []);
  return configuredRows.map((schema) => {
    const key = normalizeTrackerName(schema?.name);
    const update = incomingByName.get(key);
    const old = previousByName.get(key);
    const rawValue = Number(update?.value ?? old?.value ?? schema?.value ?? 0);
    return {
      ...schema,
      ...(old ?? {}),
      name: schema.name,
      value: Number.isFinite(rawValue) ? rawValue : Number(schema?.value ?? 0),
      max: Number.isFinite(Number(schema?.max)) ? Number(schema.max) : Number(old?.max ?? update?.max ?? 100),
      color: schema?.color ?? old?.color ?? update?.color ?? "var(--primary)",
    };
  });
}

function characterLockKey(character, index, field) {
  const id = text(character?.characterId, 160);
  const name = text(character?.name, 160);
  const reference = id
    ? `id:${encodeURIComponent(id).replaceAll(".", "%2E")}`
    : name
      ? `name:${encodeURIComponent(name).replaceAll(".", "%2E")}`
      : `index:${Number.isSafeInteger(index) && index >= 0 ? index : 0}`;
  return `characters.${reference}.${field}`;
}

function normalizeCharacterRow(row, candidate, prior, allowStats, fieldLocks, priorIndex) {
  const next = { ...(prior ?? {}) };
  if (candidate?.id) next.characterId = candidate.id;
  else if (text(row.id ?? row.characterId, 160)) next.characterId = text(row.id ?? row.characterId, 160);
  next.name = candidate?.name || text(row.name, 160) || text(prior?.name, 160);
  for (const key of CHARACTER_TEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) next[key] = row[key] == null ? null : text(row[key]);
  }
  if (prior && !candidate?.persona) {
    for (const key of ["mood", "appearance"]) {
      if (fieldLocks?.[characterLockKey(prior, priorIndex, key)] !== true) continue;
      if (Object.prototype.hasOwnProperty.call(prior, key)) next[key] = prior[key];
      else delete next[key];
    }
  }
  next.customFields = detailsToCharacterCustomFields(row, prior?.customFields);
  if (allowStats) {
    const configured = candidate?.stats ?? prior?.stats;
    const stats = normalizeStats(row.stats, prior?.stats, configured);
    if (stats) next.stats = stats;
  } else if (prior?.stats !== undefined) next.stats = prior.stats;
  return next;
}

export function validateUnifiedResult(data, settingsValue) {
  const settings = normalizeUnifiedSettings(settingsValue);
  const source = record(data);
  if (!source || Number(source.schemaVersion) !== 1) throw new Error("Unified Tracker requires schemaVersion 1");
  const required = [];
  if (settings.sections.world) required.push(["world", record(source.world)]);
  if (settings.sections.characters || settings.sections.personaStats) required.push(["characters", Array.isArray(source.characters) ? source.characters : null]);
  if (settings.sections.quests) required.push(["quests", record(source.quests)]);
  if (settings.sections.gmNotes) required.push(["gmNotes", record(source.gmNotes)]);
  const missing = required.filter(([, value]) => value === null).map(([name]) => name);
  if (missing.length > 0) throw new Error(`Unified Tracker result is missing enabled section(s): ${missing.join(", ")}`);
  if (settings.sections.quests && !Array.isArray(source.quests.updates)) throw new Error("Unified Tracker quests.updates must be an array");
  if (settings.sections.gmNotes && !Array.isArray(source.gmNotes.updates)) throw new Error("Unified Tracker gmNotes.updates must be an array");
  return { source, settings };
}

export function normalizeUnifiedResult(data, settingsValue, scope = {}) {
  const { source, settings } = validateUnifiedResult(data, settingsValue);
  const context = scope.agentContext ?? {};
  const state = scope.state ?? {};
  const personaId = text(context?.memory?._personaId, 160);
  const persona = context.persona ? {
    id: personaId,
    name: text(context.persona.name, 160),
    persona: true,
    stats: context.persona?.personaStats?.bars,
  } : null;
  const saved = (Array.isArray(context.characters) ? context.characters : []).map((candidate) => ({
    id: text(candidate.id, 160),
    name: text(candidate.name, 160),
    stats: candidate?.rpgStats?.enabled ? candidate.rpgStats.pools : [],
  }));
  const candidates = [...(persona ? [persona] : []), ...saved];
  const candidateNames = uniqueNameMap(candidates);
  const historicalNames = previousMap(state, context.characterTrackerHistory);
  const previousCharacters = Array.isArray(state?.presentCharacters) ? state.presentCharacters : [];
  const previousById = new Map(previousCharacters.map((row) => [text(row?.characterId, 160).toLocaleLowerCase(), row]));
  const normalized = [];
  const indexByIdentity = new Map();
  const inputRows = Array.isArray(source.characters) ? source.characters : [];

  for (const raw of inputRows) {
    const row = record(raw);
    if (!row) continue;
    const candidate = matchCandidate(row, candidates, candidateNames) ?? matchCandidate(row, [...historicalNames.values()], historicalNames);
    const identity = candidate?.id ? `id:${candidate.id.toLocaleLowerCase()}` : `name:${normalizeTrackerName(candidate?.name ?? row.name)}`;
    if (identity === "name:") continue;
    const prior = previousById.get(text(candidate?.id, 160).toLocaleLowerCase()) ?? candidate?.previous ?? historicalNames.get(normalizeTrackerName(candidate?.name ?? row.name))?.previous;
    const allowStats = candidate?.persona ? settings.sections.personaStats : settings.sections.characterStats;
    const priorIndex = previousCharacters.indexOf(prior);
    const next = normalizeCharacterRow(row, candidate, prior, allowStats, state.fieldLocks, priorIndex);
    const existing = indexByIdentity.get(identity);
    if (existing === undefined) {
      indexByIdentity.set(identity, normalized.length);
      normalized.push({ row: next, candidate });
    } else {
      normalized[existing] = { row: { ...normalized[existing].row, ...next }, candidate: candidate ?? normalized[existing].candidate };
    }
  }

  for (const candidate of candidates) {
    const identity = `id:${candidate.id.toLocaleLowerCase()}`;
    if (indexByIdentity.has(identity)) continue;
    const prior = previousById.get(candidate.id.toLocaleLowerCase()) ?? historicalNames.get(normalizeTrackerName(candidate.name))?.previous;
    const priorIndex = previousCharacters.indexOf(prior);
    const next = normalizeCharacterRow({}, candidate, prior, candidate.persona ? settings.sections.personaStats : settings.sections.characterStats, state.fieldLocks, priorIndex);
    indexByIdentity.set(identity, normalized.length);
    normalized.push({ row: next, candidate });
  }

  const personaEntry = normalized.find((entry) => entry.candidate?.persona === true);
  const output = { schemaVersion: 1, characters: normalized.map((entry) => entry.row) };
  if (settings.sections.world) output.world = source.world;
  if (settings.sections.quests) output.quests = source.quests;
  if (settings.sections.gmNotes) output.gmNotes = source.gmNotes;
  return Object.freeze({
    output: Object.freeze(output),
    settings,
    persona: personaEntry?.row ?? null,
    trackedCharacters: Object.freeze(normalized.filter((entry) => !entry.candidate?.persona).map((entry) => entry.row)),
  });
}

export function nativeDerivedResults(result, normalized) {
  const derived = [];
  const base = { ...result, mariBridgeDerived: true, success: true, error: null };
  if (normalized.settings.sections.world) {
    const world = record(normalized.output.world) ?? {};
    const data = { worldCustomFields: Array.isArray(world.customFields) ? world.customFields : [] };
    for (const key of WORLD_KEYS) if (Object.prototype.hasOwnProperty.call(world, key)) data[key] = world[key];
    if (Array.isArray(world.recentEvents)) data.recentEvents = world.recentEvents;
    derived.push({ ...base, type: "game_state_update", data });
  }
  if (normalized.settings.sections.characters) {
    const presentCharacters = normalized.trackedCharacters.map((row) => ({
      ...row,
      ...(record(row.customFields) ? { customFields: { ...row.customFields } } : {}),
      ...(Array.isArray(row.stats) ? { stats: row.stats.map((stat) => ({ ...stat })) } : {}),
    }));
    derived.push({ ...base, type: "character_tracker_update", data: { presentCharacters } });
  }
  if (normalized.settings.sections.personaStats && normalized.persona?.stats) {
    derived.push({ ...base, type: "persona_stats_update", data: { stats: normalized.persona.stats } });
  }
  if (normalized.settings.sections.quests) {
    derived.push({ ...base, type: "quest_update", data: { updates: normalized.output.quests.updates } });
  }
  return derived;
}

export function applyUnifiedPackageState(currentState, normalized, source) {
  const playerStats = record(currentState?.playerStats) ?? {};
  let nextPlayerStats = playerStats;
  if (normalized.settings.sections.characters && normalized.persona) {
    nextPlayerStats = {
      ...nextPlayerStats,
      customTrackerFields: mergePersonaDetailFields(nextPlayerStats.customTrackerFields, normalized.persona, currentState?.fieldLocks),
    };
  }
  if (normalized.settings.sections.gmNotes) {
    const applied = applyGmNoteUpdates(readGmNotesFromPlayerStats(nextPlayerStats), normalized.output.gmNotes.updates, source);
    nextPlayerStats = mergeGmNotesIntoPlayerStats(nextPlayerStats, applied.state);
  }
  const packageState = record(nextPlayerStats.packageState) ?? {};
  nextPlayerStats = {
    ...nextPlayerStats,
    packageState: {
      ...packageState,
      [UNIFIED_TRACKER_NAMESPACE]: {
        schemaVersion: 1,
        source: { messageId: source.messageId, swipeIndex: source.swipeIndex },
        sections: normalized.settings.sections,
        result: normalized.output,
      },
    },
  };
  return nextPlayerStats;
}

export function readUnifiedCheckpoint(gameState) {
  const playerStats = record(gameState?.playerStats);
  const packageState = record(playerStats?.packageState);
  return record(packageState?.[UNIFIED_TRACKER_NAMESPACE]);
}
