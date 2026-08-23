import assert from "node:assert/strict";
import {
  applyGmNoteUpdates,
  formatGmNotesForCommittedContext,
  mergeGmNotesIntoPlayerStats,
  readGmNotesFromPlayerStats,
} from "../src/shared/state.js";

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
assert.equal(
  formatGmNotesForCommittedContext(merged),
  "[R] Never reveal the true name.\n[T] The western gate remains sealed.",
);

const bridgeSymbol = Symbol.for("marinara.mari-bridge.v1");
let resultRegistration = null;
let contextRegistration = null;
let requirements = null;
globalThis[bridgeSymbol] = {
  registerConsumer(input) {
    requirements = input;
    return {
      agentResults: { register(value) { resultRegistration = value; return () => {}; } },
      trackerContext: { register(value) { contextRegistration = value; return () => {}; } },
      addCleanup() {},
      async close() {},
    };
  },
};
const { activate } = await import(`../src/server/index.js?check=${Date.now()}`);
await activate({ package: { id: "gm-notes" }, api: { runtime: { logger: { info() {} } } } });
assert.equal(requirements.consumerId, "gm-notes");
assert(!requirements.require.includes("host.request"));
assert.equal(resultRegistration.resultType, "gm_notes_update");
assert.equal(contextRegistration.id, "gm-notes");
assert.equal(contextRegistration.formatCommitted({ latestGameState: { playerStats: merged } }).label, "GM Notes");
delete globalThis[bridgeSymbol];

console.log("GM Notes state checks passed.");
