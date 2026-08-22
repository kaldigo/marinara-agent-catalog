export const GM_NOTES_AGENT_ID = "gm-notes";
export const GM_NOTES_RESULT_TYPE = "gm_notes_update";
export const GM_NOTES_NAMESPACE = "gm-notes";
export const GM_NOTES_MAX = 20;
export const GM_NOTE_KINDS = Object.freeze(["reminder", "thread", "debug"]);

const KIND_SET = new Set(GM_NOTE_KINDS);

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function text(value, max = 600) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, max) : "";
}

function sourceStamp(value, fallback = {}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze({
    messageId: text(record.messageId ?? fallback.messageId, 160),
    swipeIndex: Number.isInteger(Number(record.swipeIndex ?? fallback.swipeIndex))
      ? Math.max(0, Number(record.swipeIndex ?? fallback.swipeIndex))
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = KIND_SET.has(value.kind) ? value.kind : null;
  const noteText = text(value.text);
  if (!kind || !noteText) return null;
  const createdSource = sourceStamp(value.createdSource, fallbackSource);
  const updatedSource = sourceStamp(value.updatedSource, createdSource);
  return Object.freeze({
    id: text(value.id, 160) || noteId(kind, noteText, createdSource, index),
    kind,
    text: noteText,
    createdSource,
    updatedSource,
  });
}

export function normalizeGmNotesState(value, fallbackSource = {}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const notes = [];
  const ids = new Set();
  for (const [index, candidate] of (Array.isArray(record.notes) ? record.notes : []).entries()) {
    const note = normalizeGmNote(candidate, fallbackSource, index);
    if (!note || ids.has(note.id)) continue;
    ids.add(note.id);
    notes.push(note);
  }
  return Object.freeze({ schemaVersion: 1, notes: Object.freeze(notes.slice(-GM_NOTES_MAX)) });
}

export function readGmNotesFromPlayerStats(playerStats) {
  const parsed = parseMaybeJson(playerStats);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return normalizeGmNotesState(null);
  const packageState = parseMaybeJson(parsed.packageState);
  const namespace = packageState && typeof packageState === "object" && !Array.isArray(packageState)
    ? packageState[GM_NOTES_NAMESPACE]
    : null;
  return normalizeGmNotesState(parseMaybeJson(namespace));
}

export function mergeGmNotesIntoPlayerStats(playerStats, gmNotesState) {
  const parsed = parseMaybeJson(playerStats);
  const base = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const parsedPackageState = parseMaybeJson(base.packageState);
  const packageState = parsedPackageState && typeof parsedPackageState === "object" && !Array.isArray(parsedPackageState)
    ? parsedPackageState
    : {};
  return {
    ...base,
    packageState: {
      ...packageState,
      [GM_NOTES_NAMESPACE]: normalizeGmNotesState(gmNotesState),
    },
  };
}

export function applyGmNoteUpdates(currentState, rawUpdates, source = {}) {
  const before = normalizeGmNotesState(currentState, source);
  const notes = before.notes.map((note) => ({ ...note }));
  const updates = Array.isArray(rawUpdates) ? rawUpdates : [];
  const stamp = sourceStamp(source);
  let createIndex = 0;

  for (const update of updates) {
    if (!update || typeof update !== "object" || Array.isArray(update)) continue;
    const action = text(update.action, 24).toLowerCase();
    const id = text(update.id, 160);
    if (["remove", "delete", "resolve"].includes(action)) {
      if (!id) continue;
      const index = notes.findIndex((note) => note.id === id);
      if (index >= 0) notes.splice(index, 1);
      continue;
    }
    const kind = KIND_SET.has(update.kind) ? update.kind : null;
    const noteText = text(update.text);
    if (action === "update") {
      if (!id) continue;
      const index = notes.findIndex((note) => note.id === id);
      if (index < 0) continue;
      const previous = notes[index];
      notes[index] = {
        ...previous,
        ...(kind ? { kind } : {}),
        ...(noteText ? { text: noteText } : {}),
        updatedSource: stamp,
      };
      continue;
    }
    if (action !== "create" || !kind || !noteText) continue;
    const duplicate = notes.find((note) => note.kind === kind && note.text.toLocaleLowerCase() === noteText.toLocaleLowerCase());
    if (duplicate) continue;
    const nextId = id || noteId(kind, noteText, stamp, createIndex++);
    if (notes.some((note) => note.id === nextId)) continue;
    notes.push({ id: nextId, kind, text: noteText, createdSource: stamp, updatedSource: stamp });
  }

  const state = normalizeGmNotesState({ schemaVersion: 1, notes: notes.slice(-GM_NOTES_MAX) }, stamp);
  return Object.freeze({
    changed: JSON.stringify(before) !== JSON.stringify(state),
    state,
  });
}

export function formatGmNotesForCommittedContext(playerStats) {
  const state = readGmNotesFromPlayerStats(playerStats);
  if (state.notes.length === 0) return "";
  const prefix = { reminder: "[R]", thread: "[T]", debug: "[D]" };
  return state.notes.map((note) => `${prefix[note.kind]} ${note.text}`).join("\n");
}

export function gmNotesAgentState(playerStats) {
  const state = readGmNotesFromPlayerStats(playerStats);
  return state.notes.length > 0 ? state : null;
}
