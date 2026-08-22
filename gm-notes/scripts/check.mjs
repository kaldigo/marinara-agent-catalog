import assert from "node:assert/strict";
import {
  GM_NOTES_MAX,
  applyGmNoteUpdates,
  formatGmNotesForCommittedContext,
  mergeGmNotesIntoPlayerStats,
  readGmNotesFromPlayerStats,
} from "../src/shared/state.js";
import { createGmNotesRoutes } from "../src/server/routes.js";

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

const many = applyGmNoteUpdates(null, Array.from({ length: GM_NOTES_MAX + 5 }, (_, index) => ({
  action: "create",
  kind: "thread",
  text: `Thread ${index}`,
})), source);
assert.equal(many.state.notes.length, GM_NOTES_MAX);
assert.equal(many.state.notes[0].text, "Thread 5");

const existingPlayerStats = { inventory: [{ name: "Key" }], packageState: { other: { keep: true } } };
const merged = mergeGmNotesIntoPlayerStats(existingPlayerStats, created.state);
assert.deepEqual(merged.inventory, existingPlayerStats.inventory);
assert.deepEqual(merged.packageState.other, { keep: true });
assert.equal(readGmNotesFromPlayerStats(JSON.stringify(merged)).notes.length, 2);
assert.equal(
  formatGmNotesForCommittedContext(merged),
  "[R] Never reveal the true name.\n[T] The western gate remains sealed.",
);

const hostCalls = [];
const bridgeSession = {
  host: {
    async request(input) {
      hostCalls.push(input);
      if (input.method === "PATCH") return { ok: true };
      if (input.path.endsWith("/game-state")) {
        return { messageId: "message-9", swipeIndex: 3, playerStats: existingPlayerStats };
      }
      return { metadata: { enableAgents: true, activeAgentIds: ["gm-notes"] } };
    },
  },
};
const handlers = {};
await createGmNotesRoutes(bridgeSession)({
  get(_path, handler) { handlers.get = handler; },
  patch(_path, handler) { handlers.patch = handler; },
});
const routeView = await handlers.get({ params: { chatId: "chat-1" } });
assert.equal(routeView.enabled, true);
const routeUpdated = await handlers.patch(
  { params: { chatId: "chat-1" }, body: { updates: [{ action: "create", kind: "debug", text: "Route check" }] } },
  { code() { return this; }, send(value) { return value; } },
);
assert.equal(routeUpdated.notes.length, 1);
const hostPatch = hostCalls.find((call) => call.method === "PATCH");
assert.equal(hostPatch.body.messageId, "message-9");
assert.equal(hostPatch.body.swipeIndex, 3);
assert.deepEqual(hostPatch.body.playerStats.packageState.other, { keep: true });

console.log("GM Notes state checks passed.");
