import assert from "node:assert/strict";
import {
  buildGmNotesBackfillMessages,
  filterGmNotesBackfillUpdates,
  gmNotesBackfillStart,
  normalizeGmNotesBackfillProgress,
  runGmNotesBackfillBatch,
} from "../src/server/backfill.js";
import {
  applyGmNoteUpdates,
  buildGmNotesAgentSuitePatch,
  formatGmNotesForCommittedContext,
  mergeGmNotesIntoPlayerStats,
  readGmNotesFromPlayerStats,
} from "../src/shared/state.js";
import { buildNativeJsonHeaders } from "../src/client/request.js";

const privilegedHeaders = buildNativeJsonHeaders(
  { method: "POST", body: "{}", headers: { "X-Test": "preserved" } },
  "  harness-admin-secret  ",
);
assert.equal(privilegedHeaders.get("Accept"), "application/json");
assert.equal(privilegedHeaders.get("Content-Type"), "application/json");
assert.equal(privilegedHeaders.get("x-marinara-csrf"), "1");
assert.equal(privilegedHeaders.get("X-Admin-Secret"), "harness-admin-secret");
assert.equal(privilegedHeaders.get("X-Test"), "preserved");
const ordinaryHeaders = buildNativeJsonHeaders({ method: "GET" }, "");
assert.equal(ordinaryHeaders.has("x-marinara-csrf"), false);
assert.equal(ordinaryHeaders.has("X-Admin-Secret"), false);

const source = { messageId: "message-1", swipeIndex: 2 };
const created = applyGmNoteUpdates(null, [
  { action: "create", kind: "reminder", text: "Never reveal the true name." },
  { action: "create", kind: "thread", text: "The western gate remains sealed." },
], source);
assert.equal(created.changed, true);
assert.equal(created.state.notes.length, 2);
assert.match(created.state.notes[0].id, /^gmn-/u);

const duplicate = applyGmNoteUpdates(created.state, [
  { action: "create", kind: "thread", text: "The western gate remains sealed." },
], source);
assert.equal(duplicate.changed, false);

const reminderId = created.state.notes[0].id;
const updated = applyGmNoteUpdates(created.state, [
  { action: "update", id: reminderId, kind: "debug", text: "Verify the true-name contradiction." },
], { messageId: "message-2", swipeIndex: 0 });
assert.equal(updated.state.notes[0].kind, "debug");
assert.equal(updated.state.notes[0].updatedSource.messageId, "message-2");

const removed = applyGmNoteUpdates(updated.state, [{ action: "remove", id: reminderId }], source);
assert.equal(removed.state.notes.length, 1);

const lockedState = {
  notes: [{ ...created.state.notes[0], locked: true }],
};
const lockedUpdate = applyGmNoteUpdates(lockedState, [
  { action: "update", id: reminderId, kind: "debug", text: "Agent must not replace this." },
  { action: "remove", id: reminderId },
], source);
assert.equal(lockedUpdate.changed, false);
assert.equal(lockedUpdate.state.notes[0].text, "Never reveal the true name.");
assert.equal(lockedUpdate.state.notes[0].locked, true);

const many = applyGmNoteUpdates(null, Array.from({ length: 25 }, (_, index) => ({
  action: "create",
  kind: "thread",
  text: `Thread ${index}`,
})), source);
assert.equal(many.state.notes.length, 25);
assert.equal(many.state.notes[0].text, "Thread 0");
assert.equal(many.state.notes[24].text, "Thread 24");

const existingPlayerStats = { inventory: [{ name: "Key" }], packageState: { other: { keep: true } } };
const merged = mergeGmNotesIntoPlayerStats(existingPlayerStats, created.state);
assert.deepEqual(merged.inventory, existingPlayerStats.inventory);
assert.deepEqual(merged.packageState.other, { keep: true });
assert.equal(readGmNotesFromPlayerStats(JSON.stringify(merged)).notes.length, 2);
const legacyState = readGmNotesFromPlayerStats({
  packageState: {
    "gm-notes": {
      schemaVersion: 1,
      notes: [{
        id: "gmn-legacy",
        kind: "thread",
        text: "The original unresolved thread remains live.",
        createdSource: { messageId: "legacy-message", swipeIndex: 0 },
        updatedSource: { messageId: "legacy-message", swipeIndex: 0 },
      }],
    },
  },
});
assert.equal(legacyState.notes[0].id, "gmn-legacy");
assert.equal(legacyState.notes[0].locked, false);
assert.equal(
  formatGmNotesForCommittedContext(merged),
  "[REMINDER] Never reveal the true name.\n[OPEN THREAD] The western gate remains sealed.",
);
const focusedContext = formatGmNotesForCommittedContext(mergeGmNotesIntoPlayerStats({}, {
  notes: [
    { ...created.state.notes[1], kind: "thread" },
    { ...created.state.notes[0], kind: "reminder" },
    { ...created.state.notes[0], id: "debug-note", kind: "debug", text: "Verify the western gate timeline." },
  ],
}));
assert.equal(
  focusedContext,
  "[REMINDER] Never reveal the true name.\n[OPEN THREAD] The western gate remains sealed.\n[VERIFY] Verify the western gate timeline.",
);
const suitePatch = buildGmNotesAgentSuitePatch(
  { messageId: "message-3", swipeIndex: 1, playerStats: merged },
  created.state.notes.map((note) => ({ ...note, text: `${note.text} Edited` })),
);
assert.deepEqual(suitePatch.playerStats.inventory, existingPlayerStats.inventory);
assert.deepEqual(suitePatch.playerStats.packageState.other, { keep: true });
assert.equal(readGmNotesFromPlayerStats(suitePatch.playerStats).notes[0].text, "Never reveal the true name. Edited");
assert.deepEqual(buildGmNotesAgentSuitePatch({}, {}), { error: "GM Notes must be a JSON array" });
assert.deepEqual(
  buildGmNotesAgentSuitePatch({}, [{ id: "invalid", kind: "unknown", text: "Bad" }]),
  { error: "Every GM note must have a unique ID, a valid kind, and non-empty text" },
);

const backfillMessages = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
assert.equal(gmNotesBackfillStart(normalizeGmNotesBackfillProgress(null), backfillMessages), 0);
assert.equal(gmNotesBackfillStart({ checkpointMessageId: "m2" }, backfillMessages), 2);
assert.equal(gmNotesBackfillStart({ checkpointMessageId: "missing" }, backfillMessages), 0);
assert.deepEqual(
  filterGmNotesBackfillUpdates([
    { action: "create", kind: "thread", text: "A new setup." },
    { action: "update", id: "mutable", kind: "thread", text: "A changed setup." },
    { action: "remove", id: "protected" },
    { action: "resolve", id: "mutable" },
  ], ["mutable"]),
  [
    { action: "create", kind: "thread", text: "A new setup." },
    { action: "update", id: "mutable", kind: "thread", text: "A changed setup." },
    { action: "resolve", id: "mutable" },
  ],
);
const backfillPrompt = buildGmNotesBackfillMessages({
  transcript: "[m1] User: Remember the red door.\n\n[m2] Assistant: I will.",
  notes: [],
  mutableNoteIds: ["mutable"],
  currentTrackerState: { location: "Hall" },
});
assert.match(backfillPrompt[0].content, /one chronological roleplay batch/u);
assert.match(backfillPrompt[0].content, /Never update or remove any other existing note/u);
assert.match(backfillPrompt[0].content, /never infer resolution/u);
assert.match(backfillPrompt[1].content, /"mutableNoteIds":\["mutable"\]/u);

let backfillDocument = null;
let completionSignal = null;
let backfillGameState = {
  messageId: "m2",
  swipeIndex: 0,
  playerStats: mergeGmNotesIntoPlayerStats({}, {
    notes: [{
      id: "manual-note",
      kind: "reminder",
      text: "A manually curated instruction.",
      locked: false,
      createdSource: { messageId: "manual", swipeIndex: 0 },
      updatedSource: { messageId: "manual", swipeIndex: 0 },
    }],
  }),
};
const backfillRuntime = {
  persistence: {
    async getChat(chatId) {
      return chatId === "chat-1" ? { id: chatId, mode: "roleplay", connectionId: "chat-connection" } : null;
    },
    async listMessages() {
      return [
        { id: "m1", role: "user", content: "Remember the red door.", activeSwipeIndex: 0 },
        { id: "m2", role: "assistant", characterId: "character-1", content: "I will.", activeSwipeIndex: 0 },
        { id: "m3", role: "user", content: "This incomplete turn must not be processed.", activeSwipeIndex: 0 },
      ];
    },
    documents: {
      async getById() { return backfillDocument; },
      async create(input) {
        backfillDocument = { ...input, revision: 1 };
        return backfillDocument;
      },
      async update(input) {
        if (!backfillDocument || input.expectedRevision !== backfillDocument.revision) return null;
        backfillDocument = { ...backfillDocument, ...input, revision: backfillDocument.revision + 1 };
        return backfillDocument;
      },
    },
  },
  resources: {
    async listCharacters() { return [{ id: "character-1", data: { name: "Guide" } }]; },
    async listPersonas() { return []; },
  },
  async getAgentConfig() { return { settings: { maxTokens: 1024 } }; },
  languageModels: {
    async resolveForRequest() {
      return {
        fitContext(messages, options) { return { messages, maxTokens: options.maxTokens }; },
        async chatComplete(_messages, options) {
          completionSignal = options.signal;
          return {
            content: JSON.stringify({
              updates: [
                { action: "remove", id: "manual-note" },
                { action: "create", kind: "thread", text: "The red door promise remains open." },
              ],
            }),
          };
        },
      };
    },
  },
  json: { parseJsonish: JSON.parse },
  logger: { debugOverride() {} },
  isDebugAgentsEnabled() { return false; },
};
async function backfillHostRequest(request) {
  if (request.method === "GET") return backfillGameState;
  assert.equal(request.method, "PATCH");
  backfillGameState = { ...backfillGameState, ...request.body };
  return backfillGameState;
}
const backfillController = new AbortController();
const backfilled = await runGmNotesBackfillBatch({
  runtime: backfillRuntime,
  hostRequest: backfillHostRequest,
  chatId: "chat-1",
  signal: backfillController.signal,
});
assert.deepEqual(
  { processed: backfilled.processed, total: backfilled.total, created: backfilled.created, removed: backfilled.removed, done: backfilled.done },
  { processed: 2, total: 2, created: 1, removed: 0, done: true },
);
assert.equal(backfillDocument.data.checkpointMessageId, "m2");
assert.equal(backfillDocument.data.checkpointMessageCount, 2);
assert.equal(completionSignal, backfillController.signal);
const backfilledNotes = readGmNotesFromPlayerStats(backfillGameState.playerStats).notes;
assert.equal(backfilledNotes.find((note) => note.id === "manual-note")?.text, "A manually curated instruction.");
assert.equal(backfilledNotes.find((note) => note.text === "The red door promise remains open.")?.createdSource.messageId, "m2");
const resumed = await runGmNotesBackfillBatch({ runtime: backfillRuntime, hostRequest: backfillHostRequest, chatId: "chat-1" });
assert.equal(resumed.done, true);
assert.equal(resumed.processed, 2);
assert.equal(readGmNotesFromPlayerStats(backfillGameState.playerStats).notes.length, 2);
const cancelledController = new AbortController();
cancelledController.abort();
await assert.rejects(
  runGmNotesBackfillBatch({
    runtime: backfillRuntime,
    hostRequest: backfillHostRequest,
    chatId: "chat-1",
    signal: cancelledController.signal,
  }),
  (error) => error?.name === "AbortError",
);

const bridgeSymbol = Symbol.for("marinara.mari-bridge.v1");
let resultRegistration = null;
let contextRegistration = null;
let requirements = null;
let routesRegistration = null;
globalThis[bridgeSymbol] = {
  registerConsumer(input) {
    requirements = input;
    return {
      agentResults: { register(value) { resultRegistration = value; return () => {}; } },
      trackerContext: { register(value) { contextRegistration = value; return () => {}; } },
      host: { async request() { return {}; } },
      addCleanup() {},
      async close() {},
    };
  },
};
const { activate } = await import(`../src/server/index.js?check=${Date.now()}`);
await activate({
  package: { id: "gm-notes" },
  api: {
    runtime: { logger: { info() {} } },
    async registerPrivilegedRoutes(plugin, options) {
      routesRegistration = { plugin, options };
      return () => {};
    },
  },
});
assert.equal(requirements.consumerId, "gm-notes");
assert.equal(requirements.api.minMinor, 8);
assert(requirements.require.includes("host.request"));
assert.equal(routesRegistration.options.prefix, "/api/gm-notes");
assert.equal(typeof routesRegistration.plugin, "function");
assert.equal(resultRegistration.resultType, "gm_notes_update");
assert.equal(contextRegistration.id, "gm-notes");
assert.equal(contextRegistration.formatCommitted({ latestGameState: { playerStats: merged } }).label, "GM Notes");
delete globalThis[bridgeSymbol];

console.log("GM Notes state checks passed.");
