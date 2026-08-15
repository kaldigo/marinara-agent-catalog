import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverUrl = pathToFileURL(path.resolve(__dirname, "..", "dist", "package", "server.mjs"));
serverUrl.searchParams.set("smoke", String(Date.now()));
const { activate, selfCheck } = await import(serverUrl.href);

assert.equal(typeof activate, "function", "prepared server exports activate");
assert.equal(typeof selfCheck, "function", "prepared server exports selfCheck");

const messages = [
  {
    id: "message-1",
    chatId: "chat-1",
    role: "user",
    extra: JSON.stringify({
      personaSnapshot: {
        personaId: "persona-1",
        name: "Historical Persona",
        avatarUrl: "/historical.png",
        nameColor: "#111111",
        dialogueColor: "#222222",
        boxColor: "#333333",
      },
    }),
  },
  { id: "message-2", chatId: "chat-1", role: "user", extra: "{}" },
  { id: "message-3", chatId: "chat-1", role: "assistant", extra: "{}" },
];
const routes = new Map();
const patches = [];
const logs = [];

const runtime = {
  persistence: {
    async getChat(chatId) {
      return chatId === "chat-1" ? { id: "chat-1", personaId: "persona-current" } : null;
    },
    async listMessages(chatId) {
      return chatId === "chat-1" ? messages : [];
    },
  },
  resources: {
    async listPersonas(ids) {
      const records = {
        "persona-1": {
          id: "persona-1",
          data: { name: "Persona One", nameColor: "#aaaaaa", dialogueColor: "#bbbbbb", boxColor: "#cccccc" },
        },
        "persona-current": {
          id: "persona-current",
          data: { name: "Current Persona", nameColor: "#dddddd", dialogueColor: "#eeeeee", boxColor: "#ffffff" },
        },
      };
      return ids.flatMap((id) => records[id] || []);
    },
  },
  logger: { info(message) { logs.push(message); } },
};

const app = {
  async register(plugin, options = {}) {
    const prefix = options.prefix || "";
    const scoped = {
      post(route, handler) {
        routes.set(`${prefix}${route}`, handler);
      },
      inject: app.inject,
    };
    await plugin(scoped);
  },
  async inject(request) {
    patches.push(request);
    return { statusCode: 200, payload: JSON.stringify({ id: "updated" }) };
  },
};
const context = { app, api: { runtime } };

await selfCheck(context);
await assert.rejects(
  () => selfCheck({ app, api: { runtime: { persistence: {}, resources: runtime.resources } } }),
  /chat persistence host is unavailable/u,
);
await activate(context);

assert.deepEqual(logs, ["Persona Reapply package activated."]);
const single = routes.get("/api/persona-reapply/chat/:chatId/messages/:messageId");
const bulk = routes.get("/api/persona-reapply/chat/:chatId/all");
assert.equal(typeof single, "function", "single-message route activates at the package prefix");
assert.equal(typeof bulk, "function", "bulk route activates at the package prefix");

const singleResult = await single(
  { params: { chatId: "chat-1", messageId: "message-1" } },
  createReply(),
);
assert.equal(singleResult.updated, 1);
assert.equal(singleResult.update.messageId, "message-1");
assert.equal(singleResult.update.personaSnapshot.name, "Historical Persona");
assert.equal(singleResult.update.personaSnapshot.nameColor, "#aaaaaa");
assert.equal(patches[0].method, "PATCH");
assert.equal(patches[0].url, "/api/chats/chat-1/messages/message-1/extra");

const assistantResult = await single(
  { params: { chatId: "chat-1", messageId: "message-3" } },
  createReply(),
);
assert.deepEqual(assistantResult, { statusCode: 409, error: "Only persona messages can be refreshed" });

const missingChatResult = await bulk({ params: { chatId: "missing" } }, createReply());
assert.deepEqual(missingChatResult, { statusCode: 404, error: "Chat not found" });

const bulkResult = await bulk({ params: { chatId: "chat-1" } }, createReply());
assert.equal(bulkResult.updated, 2);
assert.equal(bulkResult.skipped, 0);
assert.equal(bulkResult.updates[0].personaSnapshot.name, "Historical Persona");
assert.equal(bulkResult.updates[1].personaSnapshot.name, "Current Persona");
assert.equal(patches.length, 3, "single and bulk writes reach Marinara's message-extra route");

console.log("Persona Reapply prepared server activation and route smoke checks passed.");

function createReply() {
  return {
    status(statusCode) {
      return {
        send(body) {
          return { statusCode, ...body };
        },
      };
    },
  };
}
