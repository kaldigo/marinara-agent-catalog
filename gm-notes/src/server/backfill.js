import { createHash } from "node:crypto";
import {
  applyGmNoteUpdates,
  mergeGmNotesIntoPlayerStats,
  readGmNotesFromPlayerStats,
} from "../shared/state.js";

const PACKAGE_ID = "gm-notes";
const BACKFILL_DOCUMENT_KIND = "backfill-progress";
const BACKFILL_BATCH_MESSAGES = 8;
const BACKFILL_DEFAULT_MAX_TOKENS = 2048;
const BACKFILL_MAX_MESSAGE_CHARACTERS = 8_000;
const backfillQueues = new Map();

function record(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedMaxTokens(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(256, Math.min(4096, Math.trunc(parsed))) : BACKFILL_DEFAULT_MAX_TOKENS;
}

function backfillDocumentId(chatId) {
  return createHash("sha256").update(`${PACKAGE_ID}\0${BACKFILL_DOCUMENT_KIND}\0${chatId}`).digest("hex");
}

export function normalizeGmNotesBackfillProgress(value) {
  const source = record(value);
  return {
    version: 1,
    checkpointMessageId:
      typeof source.checkpointMessageId === "string" && source.checkpointMessageId.trim()
        ? source.checkpointMessageId.trim()
        : null,
    checkpointMessageCount: Number.isFinite(Number(source.checkpointMessageCount))
      ? Math.max(0, Math.trunc(Number(source.checkpointMessageCount)))
      : 0,
    completedAt:
      typeof source.completedAt === "string" && source.completedAt.trim() ? source.completedAt.trim() : null,
    updatedAt:
      typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : null,
  };
}

async function readProgressDocument(runtime, chatId) {
  return runtime.persistence.documents.getById(PACKAGE_ID, backfillDocumentId(chatId));
}

async function readBackfillProgress(runtime, chatId) {
  const document = await readProgressDocument(runtime, chatId);
  return normalizeGmNotesBackfillProgress(document?.data);
}

function isDocumentCreateConflict(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    error.code === "FILE_UNIQUE_CONSTRAINT" &&
    error.table === "capability_documents",
  );
}

async function saveBackfillProgress(runtime, chatId, progress) {
  const data = normalizeGmNotesBackfillProgress(progress);
  for (let attempt = 0; attempt < 3; attempt++) {
    const document = await readProgressDocument(runtime, chatId);
    const now = new Date().toISOString();
    if (!document) {
      try {
        await runtime.persistence.documents.create({
          id: backfillDocumentId(chatId),
          packageId: PACKAGE_ID,
          kind: BACKFILL_DOCUMENT_KIND,
          name: chatId,
          description: "Resumable GM Notes historical backfill checkpoint",
          data: { ...data, updatedAt: now },
          createdAt: now,
          updatedAt: now,
        });
        return { ...data, updatedAt: now };
      } catch (error) {
        if (!isDocumentCreateConflict(error)) throw error;
        continue;
      }
    }
    const saved = await runtime.persistence.documents.update({
      id: document.id,
      packageId: PACKAGE_ID,
      expectedRevision: document.revision,
      name: chatId,
      description: document.description,
      data: { ...data, updatedAt: now },
      updatedAt: now,
    });
    if (saved) return normalizeGmNotesBackfillProgress(saved.data);
  }
  throw new Error("GM Notes backfill progress changed while it was being saved. Try again.");
}

function completedRoleplayMessages(messages) {
  const relevant = messages.filter((message) => message.role === "user" || message.role === "assistant");
  const lastAssistantIndex = relevant.findLastIndex((message) => message.role === "assistant");
  return lastAssistantIndex >= 0 ? relevant.slice(0, lastAssistantIndex + 1) : [];
}

export function gmNotesBackfillStart(progress, messages) {
  if (!progress.checkpointMessageId) return 0;
  const checkpointIndex = messages.findIndex((message) => message.id === progress.checkpointMessageId);
  return checkpointIndex >= 0 ? checkpointIndex + 1 : 0;
}

function nextBackfillBatch(messages, start) {
  let end = Math.min(messages.length, start + BACKFILL_BATCH_MESSAGES);
  while (end < messages.length && messages[end - 1]?.role !== "assistant") end += 1;
  return messages.slice(start, end);
}

function transcriptLine(message, names) {
  const speaker =
    message.role === "user"
      ? names.user
      : (names.characters.get(message.characterId) ?? "Assistant");
  const content = String(message.content ?? "").trim().slice(0, BACKFILL_MAX_MESSAGE_CHARACTERS);
  return `[${message.id}] ${speaker}: ${content}`;
}

async function loadSpeakerNames(runtime, chat, messages) {
  const characterIds = [...new Set(messages.flatMap((message) => message.characterId ?? []))];
  const [characters, personas] = await Promise.all([
    characterIds.length > 0 ? runtime.resources.listCharacters(characterIds) : [],
    chat.personaId ? runtime.resources.listPersonas([chat.personaId]) : [],
  ]);
  const charactersById = new Map(
    characters.map((character) => [
      character.id,
      String(record(character.data).name ?? character.comment ?? character.id),
    ]),
  );
  return {
    user: String(record(personas[0]?.data).name ?? "User"),
    characters: charactersById,
  };
}

function trackerContextForBackfill(gameState) {
  const source = record(gameState);
  const playerStats = record(source.playerStats);
  const packageState = record(playerStats.packageState);
  const { [PACKAGE_ID]: _gmNotes, ...otherPackageState } = packageState;
  return {
    date: source.date ?? null,
    time: source.time ?? null,
    location: source.location ?? null,
    weather: source.weather ?? null,
    temperature: source.temperature ?? null,
    presentCharacters: source.presentCharacters ?? null,
    playerStats: {
      ...playerStats,
      ...(Object.keys(otherPackageState).length > 0 ? { packageState: otherPackageState } : { packageState: undefined }),
    },
  };
}

export function buildGmNotesBackfillMessages({
  transcript,
  notes,
  mutableNoteIds,
  currentTrackerState,
}) {
  return [
    {
      role: "system",
      content: [
        "You are backfilling a focused GM continuity ledger from one chronological roleplay batch.",
        "Create only details that could materially affect a later response: durable narration rules or knowledge boundaries, specific unresolved setups or future payoffs, and actual continuity risks that require verification.",
        "Do not summarize scenes, log routine events, capture transient mood/pose/location, or duplicate ordinary native tracker facts.",
        "Existing notes may include manually curated or later notes. You may update or remove only IDs listed in mutableNoteIds. Never update or remove any other existing note, and never infer resolution merely because a batch does not mention something.",
        "Keep each note to one or two concrete sentences. Make the minimum necessary updates.",
        'Return only JSON: {"updates":[{"action":"create","kind":"reminder|thread|debug","text":"concise note"},{"action":"update","id":"mutable-id","kind":"reminder|thread|debug","text":"complete replacement"},{"action":"remove","id":"mutable-id"}]}',
        'If nothing changed, return {"updates":[]}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        existingNotes: notes,
        mutableNoteIds,
        currentNativeTrackerState: currentTrackerState,
        chronologicalBatch: transcript,
      }),
    },
  ];
}

function parsedUpdates(runtime, content) {
  const parsed = runtime.json.parseJsonish(content ?? "");
  const source = record(parsed);
  return Array.isArray(source.updates) ? source.updates : [];
}

export function filterGmNotesBackfillUpdates(updates, mutableNoteIds) {
  const mutable = new Set(mutableNoteIds);
  return (Array.isArray(updates) ? updates : []).filter((update) => {
    if (!update || typeof update !== "object" || Array.isArray(update)) return false;
    const action = String(update.action ?? "").trim().toLowerCase();
    if (action === "create") return true;
    return ["update", "remove", "delete", "resolve"].includes(action) && mutable.has(String(update.id ?? "").trim());
  });
}

function changedNoteCounts(before, after) {
  const beforeById = new Map(before.notes.map((note) => [note.id, note]));
  const afterById = new Map(after.notes.map((note) => [note.id, note]));
  return {
    created: after.notes.filter((note) => !beforeById.has(note.id)).length,
    updated: after.notes.filter((note) => {
      const previous = beforeById.get(note.id);
      return previous && (previous.kind !== note.kind || previous.text !== note.text);
    }).length,
    removed: before.notes.filter((note) => !afterById.has(note.id)).length,
  };
}

function mutableNoteIds(notes, processedMessageIds) {
  return notes.flatMap((note) => (
    note.locked !== true &&
    note.createdSource.messageId !== "manual" &&
    processedMessageIds.has(note.createdSource.messageId)
      ? [note.id]
      : []
  ));
}

async function latestGameState(hostRequest, chatId) {
  const gameState = await hostRequest({
    method: "GET",
    path: `/api/chats/${encodeURIComponent(chatId)}/game-state`,
  });
  if (!gameState || typeof gameState !== "object") {
    throw new Error("GM Notes backfill requires a committed Roleplay GameState.");
  }
  return gameState;
}

async function writeLatestGmNotes(hostRequest, chatId, gameState, state) {
  const playerStats = mergeGmNotesIntoPlayerStats(gameState.playerStats, state);
  return hostRequest({
    method: "PATCH",
    path: `/api/chats/${encodeURIComponent(chatId)}/game-state`,
    body: {
      playerStats,
      manual: true,
      ...(gameState.messageId
        ? { messageId: gameState.messageId, swipeIndex: Number(gameState.swipeIndex) || 0 }
        : {}),
    },
  });
}

async function runBackfillBatchUnlocked({ runtime, hostRequest, chatId, signal }) {
  signal?.throwIfAborted();
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || chat.mode !== "roleplay") throw new Error("GM Notes backfill is available only in Roleplay chats.");
  const messages = completedRoleplayMessages(await runtime.persistence.listMessages(chatId));
  const progress = await readBackfillProgress(runtime, chatId);
  const start = gmNotesBackfillStart(progress, messages);
  const batch = nextBackfillBatch(messages, start);
  if (batch.length === 0) {
    const doneAt = progress.completedAt ?? new Date().toISOString();
    const saved = await saveBackfillProgress(runtime, chatId, {
      ...progress,
      checkpointMessageCount: start,
      completedAt: doneAt,
    });
    return {
      processed: start,
      total: messages.length,
      created: 0,
      updated: 0,
      removed: 0,
      done: true,
      checkpointMessageId: saved.checkpointMessageId,
      completedAt: saved.completedAt,
    };
  }

  const gameStateForPrompt = await latestGameState(hostRequest, chatId);
  const notesForPrompt = readGmNotesFromPlayerStats(gameStateForPrompt.playerStats);
  const processedMessageIds = new Set(messages.slice(0, start + batch.length).map((message) => message.id));
  const allowedMutableIds = mutableNoteIds(notesForPrompt.notes, processedMessageIds);
  const names = await loadSpeakerNames(runtime, chat, batch);
  const prompt = buildGmNotesBackfillMessages({
    transcript: batch.map((message) => transcriptLine(message, names)).join("\n\n"),
    notes: notesForPrompt.notes,
    mutableNoteIds: allowedMutableIds,
    currentTrackerState: trackerContextForBackfill(gameStateForPrompt),
  });
  const agentConfig = await runtime.getAgentConfig();
  const model = await runtime.languageModels.resolveForRequest({
    connectionId: agentConfig?.connectionId ?? null,
    chatConnectionId: chat.connectionId,
  });
  const maxTokens = boundedMaxTokens(agentConfig?.settings?.maxTokens);
  const fitted = model.fitContext(prompt, { maxTokens });
  runtime.logger.debugOverride(
    runtime.isDebugAgentsEnabled(),
    "[gm-notes] Backfill prompt for chat %s, messages %d-%d: %s",
    chatId,
    start + 1,
    start + batch.length,
    JSON.stringify(fitted.messages),
  );
  const completion = await model.chatComplete(fitted.messages, {
    maxTokens: fitted.maxTokens ?? maxTokens,
    temperature: 0,
    reasoningEffort: "none",
    debugMode: runtime.isDebugAgentsEnabled(),
    responseFormat: { type: "json_object" },
    ...(signal ? { signal } : {}),
  });

  signal?.throwIfAborted();
  const latest = await latestGameState(hostRequest, chatId);
  const current = readGmNotesFromPlayerStats(latest.playerStats);
  const currentMutableIds = mutableNoteIds(current.notes, processedMessageIds);
  const updates = filterGmNotesBackfillUpdates(parsedUpdates(runtime, completion.content), currentMutableIds);
  const sourceMessage = batch.at(-1);
  const applied = applyGmNoteUpdates(current, updates, {
    messageId: sourceMessage.id,
    swipeIndex: Number(sourceMessage.activeSwipeIndex) || 0,
  });
  const counts = changedNoteCounts(current, applied.state);
  signal?.throwIfAborted();
  if (applied.changed) await writeLatestGmNotes(hostRequest, chatId, latest, applied.state);

  const processed = start + batch.length;
  const done = processed >= messages.length;
  const saved = await saveBackfillProgress(runtime, chatId, {
    checkpointMessageId: sourceMessage.id,
    checkpointMessageCount: processed,
    completedAt: done ? new Date().toISOString() : null,
  });
  return {
    processed,
    total: messages.length,
    ...counts,
    done,
    checkpointMessageId: saved.checkpointMessageId,
    completedAt: saved.completedAt,
  };
}

export async function runGmNotesBackfillBatch(input) {
  const previous = backfillQueues.get(input.chatId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => runBackfillBatchUnlocked(input));
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  backfillQueues.set(input.chatId, tail);
  try {
    return await run;
  } finally {
    if (backfillQueues.get(input.chatId) === tail) backfillQueues.delete(input.chatId);
  }
}

export async function getGmNotesBackfillStatus(runtime, chatId) {
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || chat.mode !== "roleplay") throw new Error("GM Notes backfill is available only in Roleplay chats.");
  const messages = completedRoleplayMessages(await runtime.persistence.listMessages(chatId));
  const progress = await readBackfillProgress(runtime, chatId);
  const processed = gmNotesBackfillStart(progress, messages);
  const done = processed >= messages.length;
  return {
    processed,
    total: messages.length,
    created: 0,
    updated: 0,
    removed: 0,
    done,
    checkpointMessageId: progress.checkpointMessageId,
    completedAt: done ? progress.completedAt : null,
  };
}
