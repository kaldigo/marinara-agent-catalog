import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRefreshedPersonaSnapshot,
  parseMessageExtra,
  personaData,
  selectMessagePersonaId,
} from "../src/server/reapply.js";
import { createPersonaReapplyRoutes } from "../src/server/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

assert.deepEqual(parseMessageExtra('{"personaSnapshot":{"personaId":"p1"}}'), {
  personaSnapshot: { personaId: "p1" },
});
assert.deepEqual(parseMessageExtra("not-json"), {});
assert.deepEqual(personaData({ id: "p1", data: '{"name":"Alex"}' }), { name: "Alex" });

const original = {
  personaId: "p1",
  name: "Historical Alex",
  avatarUrl: "/old.png",
  avatarCrop: "old crop",
  description: "old description",
  nameColor: "#111111",
  dialogueColor: "#222222",
  boxColor: "#333333",
};
const refreshed = buildRefreshedPersonaSnapshot(
  original,
  {
    name: "Current Alex",
    avatarPath: "/new.png",
    avatarCrop: "new crop",
    nameColor: "#aaaaaa",
    dialogueColor: "#bbbbbb",
    boxColor: "rgba(1, 2, 3, 0.5)",
  },
  "p1",
);
assert.equal(refreshed.name, "Historical Alex", "historical name is preserved");
assert.equal(refreshed.avatarUrl, "/old.png", "historical avatar is preserved");
assert.equal(refreshed.description, "old description", "unrelated historical fields are preserved");
assert.equal(refreshed.nameColor, "#aaaaaa");
assert.equal(refreshed.dialogueColor, "#bbbbbb");
assert.equal(refreshed.boxColor, "rgba(1, 2, 3, 0.5)");

const seeded = buildRefreshedPersonaSnapshot(
  null,
  { name: "Alex", avatarPath: "/alex.png", avatarCrop: "crop", nameColor: "red" },
  "p1",
);
assert.deepEqual(seeded, {
  personaId: "p1",
  name: "Alex",
  avatarUrl: "/alex.png",
  avatarCrop: "crop",
  nameColor: "red",
  dialogueColor: null,
  boxColor: null,
});

assert.equal(
  selectMessagePersonaId(
    { extra: JSON.stringify({ personaSnapshot: { personaId: "historical" } }) },
    { personaId: "current" },
  ),
  "historical",
  "saved persona identity wins",
);
assert.equal(selectMessagePersonaId({ extra: "{}" }, { personaId: "current" }), "current");

const registeredRoutes = new Map();
const hostPatches = [];
const routeApp = {
  post(pathname, handler) {
    registeredRoutes.set(pathname, handler);
  },
  async inject(request) {
    hostPatches.push(request);
    return { statusCode: 200, payload: JSON.stringify({ id: "updated" }) };
  },
};
const runtime = {
  persistence: {
    async getChat() {
      return { id: "chat-1", personaId: "current" };
    },
    async listMessages() {
      return [
        {
          id: "message-1",
          chatId: "chat-1",
          role: "user",
          extra: JSON.stringify({ personaSnapshot: original }),
        },
        { id: "message-2", chatId: "chat-1", role: "user", extra: "{}" },
        { id: "message-3", chatId: "chat-1", role: "assistant", extra: "{}" },
      ];
    },
  },
  resources: {
    async listPersonas(ids) {
      const available = {
        p1: { id: "p1", data: { name: "Alex", nameColor: "red", dialogueColor: "blue", boxColor: "black" } },
        current: { id: "current", data: { name: "Current", nameColor: "green" } },
      };
      return ids.flatMap((id) => available[id] || []);
    },
  },
};
createPersonaReapplyRoutes({ app: routeApp, runtime });
const bulkHandler = registeredRoutes.get("/chat/:chatId/all");
assert.equal(typeof bulkHandler, "function", "bulk refresh route is registered");
const bulkResult = await bulkHandler(
  { params: { chatId: "chat-1" } },
  { status(code) { return { send(body) { return { code, ...body }; } }; } },
);
assert.equal(bulkResult.updated, 2, "bulk route updates only user messages");
assert.equal(bulkResult.skipped, 0);
assert.equal(hostPatches.length, 2);
assert.equal(hostPatches[0].url, "/api/chats/chat-1/messages/message-1/extra");
assert.equal(hostPatches[0].payload.personaSnapshot.name, "Historical Alex");
assert.equal(hostPatches[0].payload.personaSnapshot.nameColor, "red");
assert.equal(hostPatches[1].payload.personaSnapshot.personaId, "current", "missing snapshots use the chat persona");
assert.equal(hostPatches[1].payload.personaSnapshot.name, "Current");

const client = fs.readFileSync(path.join(projectRoot, "src", "client", "runtime.js"), "utf8");
assert(client.includes("registerMessageActionContribution"), "client registers a message action");
assert(client.includes('commands: ["/reapply-persona"]'), "client registers /reapply-persona");
assert(client.includes("window.confirm"), "whole-chat command confirms before writing");
assert(client.includes("applyUpdateToVisibleMessage"), "client immediately refreshes visible message styling");
assert(!client.includes("🎨"), "message action uses a vector icon rather than an emoji");
assert(client.includes("persona-reapply-message-icon"), "message action includes its vector icon");

console.log("Persona Reapply source checks passed.");
