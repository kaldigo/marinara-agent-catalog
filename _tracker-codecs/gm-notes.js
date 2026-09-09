export const GM_NOTES_NAMESPACE = "gm-notes";
export const GM_NOTES_AGENT_ID = "gm-notes";
export const GM_NOTES_RESULT_TYPE = "gm_notes_update";
export const GM_NOTE_KINDS = Object.freeze(["reminder", "thread", "debug"]);

const KIND_SET = new Set(GM_NOTE_KINDS);

function record(value) {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, max = 600) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, max) : "";
}

function sourceStamp(value, fallback = {}) {
  const source = record(value) ?? {};
  return Object.freeze({
    messageId: text(source.messageId ?? fallback.messageId, 160),
    swipeIndex: Number.isInteger(Number(source.swipeIndex ?? fallback.swipeIndex))
      ? Math.max(0, Number(source.swipeIndex ?? fallback.swipeIndex))
      : 0,
  });
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function noteId(kind, noteText, source, index) {
  return `gmn-${stableHash(`${kind}\u0000${noteText}\u0000${source.messageId}\u0000${source.swipeIndex}\u0000${index}`)}`;
}

export function normalizeGmNote(value, fallbackSource = {}, index = 0) {
  const candidate = record(value);
  if (!candidate) return null;
  const kind = KIND_SET.has(candidate.kind) ? candidate.kind : null;
  const noteText = text(candidate.text);
  if (!kind || !noteText) return null;
  const createdSource = sourceStamp(candidate.createdSource, fallbackSource);
  return Object.freeze({
    id: text(candidate.id, 160) || noteId(kind, noteText, createdSource, index),
    kind,
    text: noteText,
    locked: candidate.locked === true,
    createdSource,
    updatedSource: sourceStamp(candidate.updatedSource, createdSource),
  });
}

export function normalizeGmNotesState(value, fallbackSource = {}) {
  const source = record(value) ?? {};
  const notes = [];
  const ids = new Set();
  for (const [index, candidate] of (Array.isArray(source.notes) ? source.notes : []).entries()) {
    const note = normalizeGmNote(candidate, fallbackSource, index);
    if (!note || ids.has(note.id)) continue;
    ids.add(note.id);
    notes.push(note);
  }
  return Object.freeze({ schemaVersion: 1, notes: Object.freeze(notes) });
}

export function readGmNotesFromPlayerStats(playerStats) {
  const parsed = record(playerStats);
  const packageState = record(parsed?.packageState);
  return normalizeGmNotesState(record(packageState?.[GM_NOTES_NAMESPACE]));
}

export function mergeGmNotesIntoPlayerStats(playerStats, gmNotesState) {
  const base = record(playerStats) ?? {};
  const packageState = record(base.packageState) ?? {};
  return {
    ...base,
    packageState: { ...packageState, [GM_NOTES_NAMESPACE]: normalizeGmNotesState(gmNotesState) },
  };
}

export function applyGmNoteUpdates(currentState, rawUpdates, source = {}) {
  const before = normalizeGmNotesState(currentState, source);
  const notes = before.notes.map((note) => ({ ...note }));
  const stamp = sourceStamp(source);
  let createIndex = 0;
  for (const update of Array.isArray(rawUpdates) ? rawUpdates : []) {
    const candidate = record(update);
    if (!candidate) continue;
    const action = text(candidate.action, 24).toLowerCase();
    const id = text(candidate.id, 160);
    if (["remove", "delete", "resolve"].includes(action)) {
      const index = notes.findIndex((note) => note.id === id);
      if (index >= 0 && notes[index].locked !== true) notes.splice(index, 1);
      continue;
    }
    const kind = KIND_SET.has(candidate.kind) ? candidate.kind : null;
    const noteText = text(candidate.text);
    if (action === "update") {
      const index = notes.findIndex((note) => note.id === id);
      if (index < 0 || notes[index].locked === true) continue;
      notes[index] = {
        ...notes[index],
        ...(kind ? { kind } : {}),
        ...(noteText ? { text: noteText } : {}),
        updatedSource: stamp,
      };
      continue;
    }
    if (action !== "create" || !kind || !noteText) continue;
    if (notes.some((note) => note.kind === kind && note.text.toLocaleLowerCase() === noteText.toLocaleLowerCase())) continue;
    const nextId = id || noteId(kind, noteText, stamp, createIndex++);
    if (notes.some((note) => note.id === nextId)) continue;
    notes.push({ id: nextId, kind, text: noteText, locked: false, createdSource: stamp, updatedSource: stamp });
  }
  const state = normalizeGmNotesState({ notes }, stamp);
  return Object.freeze({ changed: JSON.stringify(before) !== JSON.stringify(state), state });
}

export function formatGmNotesForCommittedContext(playerStats) {
  const state = readGmNotesFromPlayerStats(playerStats);
  const prefix = { reminder: "[REMINDER]", thread: "[OPEN THREAD]", debug: "[VERIFY]" };
  return GM_NOTE_KINDS.flatMap((kind) => state.notes
    .filter((note) => note.kind === kind)
    .map((note) => `${prefix[kind]} ${note.text}`)).join("\n");
}

export function gmNotesAgentState(playerStats) {
  const state = readGmNotesFromPlayerStats(playerStats);
  return state.notes.length > 0 ? state : null;
}

export function buildGmNotesAgentSuitePatch(gameState, parsed) {
  if (!Array.isArray(parsed)) return { error: "GM Notes must be a JSON array" };
  const fallbackSource = {
    messageId: text(gameState?.messageId, 160) || "manual",
    swipeIndex: Number.isInteger(Number(gameState?.swipeIndex)) ? Math.max(0, Number(gameState.swipeIndex)) : 0,
  };
  const normalized = normalizeGmNotesState({ notes: parsed }, fallbackSource);
  if (normalized.notes.length !== parsed.length) {
    return { error: "Every GM note must have a unique ID, a valid kind, and non-empty text" };
  }
  return { playerStats: mergeGmNotesIntoPlayerStats(gameState?.playerStats, normalized) };
}
