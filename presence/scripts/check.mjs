import { createSlashCommandRouter, matchSlashCommand } from "../../_mari-bridge/src/commands.js";
import { diffSummaryEntries } from "../../_mari-bridge/src/summary-tracking.js";
import { buildPresenceExtraPatch, readPresenceState } from "../src/shared/presence-state.js";
import { planRosterBackfill } from "../src/shared/roster.js";
import { activate, selfCheck } from "../src/server/index.js";
import { buildSummaryAudience, buildSummaryLorebookEntries } from "../src/server/summary-mirror.js";

const command = {
  id: "presence-hide",
  hijacks: ["/hide", "/unhide"],
  owns: ({ tokens }) => tokens[0] === "Sophie",
  handler: () => null,
};

assert(matchSlashCommand("/hide Sophie 4-46", [command])?.hijacked === true, "hijacked hide command");
assert(matchSlashCommand("/hide 4-46", [command]) === null, "native hide command passes through");

const router = createSlashCommandRouter();
router.register({
  id: "context-check",
  commands: ["/presence"],
  handler: ({ context }) => context.chatId,
});
assert((await router.run("/presence test", { chatId: "chat-1" })).result === "chat-1", "router passes context");

const events = diffSummaryEntries([], [{ id: "s1", content: "Summary", enabled: true }], { source: "generation" });
assert(events[0]?.type === "generated", "summary generation event");

const patch = buildPresenceExtraPatch({
  extra: { hiddenFromAI: true, hiddenFromAICharacterIds: ["outside-roster"] },
  rosterIds: ["a", "b"],
  presentCharacterIds: ["a"],
});
assert(patch.hiddenFromAICharacterIds.includes("b"), "presence hidden character added");
assert(patch.hiddenFromAICharacterIds.includes("outside-roster"), "non-roster hidden character preserved");
assert(patch.hiddenFromAI === true, "global hidden flag preserved");
assert(!Object.prototype.hasOwnProperty.call(patch, "marinaraPresencePackage"), "message patch does not stamp shadow metadata");

const nobodyPresent = readPresenceState(
  { extra: { hiddenFromAICharacterIds: ["a", "b"] } },
  ["a", "b"],
);
assert(nobodyPresent.size === 0, "empty stored presence means nobody present");
assert(
  readPresenceState({ extra: { hiddenFromAICharacterIds: ["b"] } }, ["a", "b"]).has("a") &&
    !readPresenceState({ extra: { hiddenFromAICharacterIds: ["b"] } }, ["a", "b"]).has("b"),
  "presence reads per-character hide as canonical state",
);

const backfill = planRosterBackfill({
  previousRosterIds: ["a"],
  currentRosterIds: ["a", "b"],
  messages: [{ id: "m1", extra: {} }],
});
assert(backfill.messagePatches.length === 1, "new character backfill planned");
assert(
  planRosterBackfill({ previousRosterIds: [], currentRosterIds: ["a"], messages: [{ id: "m1", extra: {} }] })
    .messagePatches.length === 0,
  "backfill waits for a previous roster snapshot",
);

const messagesById = new Map([
  ["m1", { id: "m1", extra: { hiddenFromAICharacterIds: ["b"] } }],
  ["m2", { id: "m2", extra: { hiddenFromAICharacterIds: [] } }],
]);
assert(
  buildSummaryAudience({ summary: { id: "s1", messageIds: ["m1"] }, messagesById, rosterIds: ["a", "b"] }).join(",") ===
    "a",
  "summary audience excludes absent characters",
);

const entries = buildSummaryLorebookEntries({
  chatId: "chat-1",
  summaries: [{ id: "s1", content: "Inside <tag>raw</tag>", enabled: true }],
  audienceBySummaryId: new Map([["s1", ["a"]]]),
});
assert(entries.length === 3, "summary mirror wrapper and entry");
assert(entries[1].name === "s1", "summary id used as entry name");
assert(entries.every((entry) => ["any", "include", "exclude"].includes(entry.characterFilterMode)), "valid character filters");
assert(entries.every((entry) => ["any", "include", "exclude"].includes(entry.generationTriggerFilterMode)), "valid trigger filters");
assert(entries.every((entry) => entry.dynamicState?.owner === "presence"), "summary mirror ownership is schema-shaped");

const registeredRoutes = [];
const registeredHooks = [];
const injectedRequests = [];
let testChat = {
  id: "chat-1",
  characterIds: ["a", "b"],
  metadata: { enableAgents: true, activeAgentIds: ["presence"], inactiveCharacterIds: ["b"] },
};
let currentMessages = [];
await activate({
  app: {
    addHook(name, handler) {
      registeredHooks.push({ name, handler });
    },
    async register(callback, options) {
      assert(options?.prefix === "/api/presence", "activate uses package route prefix");
      await callback({
        get(route) {
          registeredRoutes.push(`GET ${route}`);
        },
        post(route) {
          registeredRoutes.push(`POST ${route}`);
        },
      });
    },
    async inject(request) {
      injectedRequests.push(request);
      if (request.method === "POST" && request.url === "/api/lorebooks") {
        return { statusCode: 200, payload: JSON.stringify({ id: "presence-lorebook", enabled: true }) };
      }
      if (request.method === "GET" && request.url === "/api/lorebooks/presence-lorebook/entries") {
        return { statusCode: 200, payload: "[]" };
      }
      return { statusCode: 200, payload: "{}" };
    },
  },
  api: {
    runtime: {
      logger: { info() {}, warn() {} },
      persistence: {
        getChat(chatId) {
          return chatId === testChat.id ? testChat : null;
        },
        listMessages() {
          return currentMessages;
        },
        updateChatMetadata() {},
      },
      resources: { listCharacters() { return []; } },
    },
  },
});
assert(registeredRoutes.includes("GET /chat/:chatId/state"), "activate registers state route");
assert(registeredRoutes.includes("POST /chat/:chatId/command"), "activate registers command route");
assert(registeredRoutes.includes("POST /chat/:chatId/ensure"), "activate registers chat lifecycle ensure route");
assert(registeredHooks.some((hook) => hook.name === "onSend"), "activate registers message save hook");
assert(registeredHooks.some((hook) => hook.name === "preHandler"), "activate registers generation capture hook");
assert(registeredHooks.some((hook) => hook.name === "onResponse"), "activate registers generation completion hook");
await registeredHooks
  .find((hook) => hook.name === "onSend")
  .handler(
    { method: "POST", url: "/api/chats/chat-1/messages" },
    { statusCode: 200 },
    JSON.stringify({ id: "m1", chatId: "chat-1", role: "user", extra: {} }),
  );
const messagePatch = injectedRequests.find((request) => request.url.includes("/messages/m1/extra"));
assert(messagePatch, "message save hook patches created message extra");
assert(!Object.prototype.hasOwnProperty.call(messagePatch.payload, "marinaraPresencePackage"), "message save uses native presence only");
assert(messagePatch.payload.hiddenFromAICharacterIds.join(",") === "b", "message save hides inactive character");

const disabledRequestCount = injectedRequests.length;
testChat = {
  ...testChat,
  metadata: { enableAgents: true, activeAgentIds: [], inactiveCharacterIds: ["b"] },
};
await registeredHooks
  .find((hook) => hook.name === "onSend")
  .handler(
    { method: "POST", url: "/api/chats/chat-1/messages" },
    { statusCode: 200 },
    JSON.stringify({ id: "m-disabled", chatId: "chat-1", role: "user", extra: {} }),
  );
assert(injectedRequests.length === disabledRequestCount, "disabled Presence tracker does not stamp created messages");

testChat = {
  ...testChat,
  metadata: {
    enableAgents: true,
    activeAgentIds: ["presence"],
    inactiveCharacterIds: ["b"],
  },
};
currentMessages = [{ id: "m1", role: "user", extra: {} }];
const generateRequest = { method: "POST", url: "/api/generate", body: { chatId: "chat-1" }, headers: {} };
await registeredHooks.find((hook) => hook.name === "preHandler").handler(generateRequest, {});
testChat = {
  ...testChat,
  metadata: {
    ...testChat.metadata,
    summaryEntries: [{ id: "summary-1", content: "Generated summary", enabled: true, messageIds: ["m1", "m2"] }],
  },
};
currentMessages = [
  { id: "m1", role: "user", extra: {} },
  { id: "m2", role: "user", extra: {} },
  { id: "m3", role: "assistant", characterId: "a", extra: {} },
];
await registeredHooks.find((hook) => hook.name === "onResponse").handler(generateRequest, { statusCode: 200 });
assert(
  injectedRequests.some((request) => request.url.includes("/messages/m2/extra")),
  "normal generate stamps created user message",
);
assert(
  injectedRequests.some((request) => request.url.includes("/messages/m3/extra")),
  "normal generate stamps created assistant message",
);
assert(
  injectedRequests.some(
    (request) =>
      request.method === "PATCH" &&
      request.url === "/api/chats/chat-1/summary-entries" &&
      request.payload?.entryId === "summary-1" &&
      request.payload?.enabled === false,
  ),
  "normal generate reconciles and disables native summary entries",
);

const afterGenerateRequestCount = injectedRequests.length;
currentMessages = [{ id: "m1", role: "user", extra: {} }];
const dryRunRequest = { method: "POST", url: "/api/generate/dryRun", body: { chatId: "chat-1" }, headers: {} };
await registeredHooks.find((hook) => hook.name === "preHandler").handler(dryRunRequest, {});
currentMessages = [
  { id: "m1", role: "user", extra: {} },
  { id: "dry-run-result", role: "assistant", characterId: "a", extra: {} },
];
await registeredHooks.find((hook) => hook.name === "onResponse").handler(dryRunRequest, { statusCode: 200 });
assert(injectedRequests.length === afterGenerateRequestCount, "dry run generation does not stamp messages");

await selfCheck({
  api: {
    runtime: {
      persistence: { getChat() {} },
      resources: { listCharacters() {} },
    },
  },
});

function assert(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

console.log("Presence checks passed.");
