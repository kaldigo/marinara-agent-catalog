import fs from "node:fs";
import { createHideCommandOwner } from "../src/shared/message-range.js";
import { readPresenceChatState } from "../src/shared/chat-state.js";
import { buildPresenceExtraPatch, readPresenceState } from "../src/shared/presence-state.js";
import { planRosterBackfill } from "../src/shared/roster.js";
import { activate, selfCheck } from "../src/server/index.js";
import { createPresenceCommandRouter } from "../src/server/command-router.js";

const hideOwner = createHideCommandOwner();
assert(hideOwner({ tokens: ["Sophie", "4-46"] }) === true, "character-scoped hide command is owned");
assert(hideOwner({ tokens: ["4-46"] }) === false, "native hide range passes through");

const router = createPresenceCommandRouter({
  runPresenceCommand: ({ context }) => context.chatId,
  runScopedHideCommand: () => null,
});
assert((await router.run("/presence test", { chatId: "chat-1" })).result === "chat-1", "router passes context");

const clientRuntime = fs.readFileSync(new URL("../src/client/runtime.js", import.meta.url), "utf8");
assert(clientRuntime.includes("bridgeSession.commands.register"), "client registers commands through the installed bridge");
assert(clientRuntime.includes("bridgeSession.ui.register"), "client contributes settings inside the native agent card");
assert(clientRuntime.includes('slot: "agent.settings"'), "client targets the native agent settings extension point");
assert(clientRuntime.includes("data-presence-character-id"), "settings expose a compact avatar character picker");
assert(clientRuntime.includes("Selected characters retain access"), "settings explain always-present behavior");
assert(!clientRuntime.includes("setMariBridgeNativeSettingsHtml"), "client does not replace Marinara's agent settings shell");
assert(!clientRuntime.includes("summary"), "client no longer describes summary behavior");
assert(!clientRuntime.includes("MutationObserver"), "client does not DOM-inject chat settings");
assert(!clientRuntime.includes("watchActiveChatId"), "client uses bridge active-chat state without polling");

const patch = buildPresenceExtraPatch({
  extra: { hiddenFromAI: true, hiddenFromAICharacterIds: ["outside-roster"] },
  rosterIds: ["a", "b"],
  presentCharacterIds: ["a"],
});
assert(patch.hiddenFromAICharacterIds.join(",") === "outside-roster,b", "native hidden IDs project positive presence");
assert(patch.hiddenFromAI === true, "global hidden flag is preserved");
assert(patch.marinaraPresence.presentCharacterIds.join(",") === "a", "positive presence is stored explicitly");

const positiveWins = readPresenceState({
  extra: {
    hiddenFromAICharacterIds: [],
    marinaraPresence: { version: 1, presentCharacterIds: ["a"] },
  },
}, ["a", "b"]);
assert(positiveWins.has("a") && !positiveWins.has("b"), "positive presence is authoritative");
assert(
  readPresenceState({ extra: { hiddenFromAICharacterIds: ["b"] } }, ["a", "b"]).has("a"),
  "legacy messages fall back to native hidden IDs",
);

const backfill = planRosterBackfill({
  previousRosterIds: ["a"],
  currentRosterIds: ["a", "b"],
  messages: [{ id: "m1", extra: { marinaraPresence: { presentCharacterIds: ["a"] } } }],
});
assert(backfill.messagePatches.length === 1, "new character backfill is planned");
assert(backfill.messagePatches[0].patch.hiddenFromAICharacterIds.join(",") === "b", "new character is hidden from history");
assert(backfill.messagePatches[0].patch.marinaraPresence.presentCharacterIds.join(",") === "a", "backfill preserves positive history");
assert(
  planRosterBackfill({
    previousRosterIds: ["a"],
    currentRosterIds: ["a", "b"],
    messages: [{ id: "m1", extra: { marinaraPresence: { presentCharacterIds: ["a"] } } }],
    alwaysPresentCharacterIds: ["b"],
  }).messagePatches[0].patch.marinaraPresence.presentCharacterIds.join(",") === "a,b",
  "always-present characters are included during backfill",
);
assert(readPresenceChatState({ metadata: { marinaraPresencePackage: { rosterCharacterIds: ["a"] } } }).rosterCharacterIds[0] === "a", "chat state keeps roster snapshot");

const registeredRoutes = [];
const registeredRouteHandlers = new Map();
const registeredHostHooks = [];
const registeredMessagePolicies = [];
const registeredChatPolicies = [];
const injectedRequests = [];
let testChat = {
  id: "chat-1",
  characterIds: ["a", "b"],
  metadata: { enableAgents: true, activeAgentIds: ["presence"], inactiveCharacterIds: ["b"] },
};
let currentMessages = [];
let metadataWriteCount = 0;
const runtime = {
  logger: { info() {}, warn() {} },
  persistence: {
    getChat(chatId) {
      return chatId === testChat.id ? testChat : null;
    },
    listMessages() {
      return currentMessages;
    },
    updateChatMetadata({ metadata }) {
      metadataWriteCount += 1;
      testChat = { ...testChat, metadata };
    },
  },
  resources: {
    listCharacters() {
      return [
        { id: "a", data: { name: "Alice" }, comment: "" },
        { id: "b", data: { name: "Bob" }, comment: "" },
      ];
    },
  },
};
const hostApp = {
  addHook(name, handler) {
    registeredHostHooks.push({ name, handler });
  },
  async register(callback, options) {
    assert(options?.prefix === "/api/presence", "activate uses package route prefix");
    await callback({
      get(route, handler) {
        registeredRoutes.push(`GET ${route}`);
        registeredRouteHandlers.set(`GET ${route}`, handler);
      },
      post(route, handler) {
        registeredRoutes.push(`POST ${route}`);
        registeredRouteHandlers.set(`POST ${route}`, handler);
      },
      patch(route, handler) {
        registeredRoutes.push(`PATCH ${route}`);
        registeredRouteHandlers.set(`PATCH ${route}`, handler);
      },
    });
  },
  async inject(request) {
    injectedRequests.push(request);
    if (request.method === "GET" && request.url.startsWith("/api/characters/")) {
      const id = decodeURIComponent(request.url.split("/").pop());
      return { statusCode: 200, payload: JSON.stringify({ id, avatarPath: `/avatars/${id}.png` }) };
    }
    if (request.method === "PATCH" && /^\/api\/chats\/chat-1\/messages\/[^/]+\/extra$/u.test(request.url)) {
      const messageId = decodeURIComponent(request.url.split("/").at(-2));
      currentMessages = currentMessages.map((message) =>
        message.id === messageId ? { ...message, extra: { ...message.extra, ...request.payload } } : message,
      );
      return { statusCode: 200, payload: JSON.stringify({ ok: true }) };
    }
    return { statusCode: 200, payload: "{}" };
  },
};

const bridgeSymbol = Symbol.for("marinara.mari-bridge.v1");
globalThis[bridgeSymbol] = {
  registerConsumer(requirements) {
    assert(requirements.consumerId === "presence", "server activates through the Presence bridge identity");
    assert(requirements.require.includes("host.request"), "Presence requires the bridge host service");
    assert(requirements.require.includes("message.prepare"), "Presence requires the bridge native message preparation slot");
    assert(requirements.require.includes("message.persist"), "Presence requires the bridge native message persisted slot");
    assert(requirements.require.includes("chat.changed"), "Presence requires the bridge native chat change slot");
    assert(!requirements.require.includes("host.lifecycle"), "Presence no longer requires the broad host lifecycle slot");
    const cleanups = [];
    return {
      signal: new AbortController().signal,
      host: {
        async request(input) {
          const response = await hostApp.inject({ method: input.method, url: input.path, payload: input.body, headers: input.headers });
          return response.payload ? JSON.parse(response.payload) : null;
        },
      },
      messages: {
        register(input) {
          registeredMessagePolicies.push(input);
          const cleanup = () => {
            const index = registeredMessagePolicies.indexOf(input);
            if (index >= 0) registeredMessagePolicies.splice(index, 1);
          };
          cleanups.push(cleanup);
          return cleanup;
        },
      },
      chats: {
        register(input) {
          registeredChatPolicies.push(input);
          const cleanup = () => {
            const index = registeredChatPolicies.indexOf(input);
            if (index >= 0) registeredChatPolicies.splice(index, 1);
          };
          cleanups.push(cleanup);
          return cleanup;
        },
      },
      addCleanup(cleanup) { cleanups.push(cleanup); },
      async close() { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); },
    };
  },
};

await activate({ app: hostApp, api: { runtime } });
assert(registeredRoutes.includes("GET /chat/:chatId/state"), "state route registered");
assert(registeredRoutes.includes("POST /chat/:chatId/command"), "command route registered");
assert(registeredRoutes.includes("POST /chat/:chatId/ensure"), "ensure route registered");
assert(registeredMessagePolicies.length === 1, "message save policy is registered through native message slots");
assert(typeof registeredMessagePolicies[0].prepare === "function", "new messages use native pre-persist preparation");
assert(typeof registeredMessagePolicies[0].afterPersist === "function", "message rewrites use the native persisted notification");
assert(registeredChatPolicies.length === 1, "chat changes use the native chat change slot");
assert(registeredHostHooks.length === 0, "Presence installs no broad Fastify lifecycle hook");

const stateResponse = await registeredRouteHandlers.get("GET /chat/:chatId/state")(
  { params: { chatId: "chat-1" } },
  replyStub(),
);
assert(stateResponse.roster[0].avatarUrl === "/avatars/a.png", "state route supplies picker avatars");
assert(!Object.prototype.hasOwnProperty.call(stateResponse, "summaries"), "state route leaves summaries alone");

currentMessages = [{ id: "old", role: "user", extra: {} }];
await registeredRouteHandlers.get("POST /chat/:chatId/ensure")(
  { params: { chatId: "chat-1" } },
  replyStub(),
);
assert(currentMessages[0].extra.marinaraPresence.presentCharacterIds.join(",") === "a,b", "first enable initializes old history as everyone present");
assert(testChat.metadata.marinaraPresencePackage.rosterCharacterIds.join(",") === "a,b", "first enable snapshots roster");

currentMessages = [{ id: "package-era", role: "user", extra: { hiddenFromAICharacterIds: ["b"] } }];
const migrationEnsure = await registeredRouteHandlers.get("POST /chat/:chatId/ensure")(
  { params: { chatId: "chat-1" } },
  replyStub(),
);
assert(migrationEnsure.roster.initializedMessages === 1, "ensure initializes missing positive records in package-era chats");
assert(currentMessages[0].extra.marinaraPresence.presentCharacterIds.join(",") === "a", "package-era migration preserves native visibility");

const postedInput = { chatId: "chat-1", role: "user", content: "Private", extra: { submissionId: "submission-1" } };
const postedPatch = await registeredMessagePolicies[0].prepare({ input: postedInput });
currentMessages.push({ id: "posted", ...postedInput, ...postedPatch });
assert(currentMessages.find((message) => message.id === "posted").extra.marinaraPresence.presentCharacterIds.join(",") === "a", "post-only message stores active positive presence");
assert(currentMessages.find((message) => message.id === "posted").extra.hiddenFromAICharacterIds.join(",") === "b", "post-only message projects native hidden IDs");
assert(currentMessages.find((message) => message.id === "posted").extra.submissionId === "submission-1", "native preparation preserves unrelated message extras");

await registeredRouteHandlers.get("PATCH /chat/:chatId/settings")(
  { params: { chatId: "chat-1" }, body: { alwaysPresentCharacterIds: ["b"] } },
  replyStub(),
);
assert(currentMessages.find((message) => message.id === "posted").extra.marinaraPresence.presentCharacterIds.join(",") === "a,b", "always-present setting updates positive presence");
assert(currentMessages.find((message) => message.id === "posted").extra.hiddenFromAICharacterIds.length === 0, "always-present setting updates native hidden IDs");

testChat = {
  ...testChat,
  metadata: { ...testChat.metadata, marinaraPresencePackage: { ...testChat.metadata.marinaraPresencePackage, alwaysPresentCharacterIds: [] } },
};
currentMessages = [{ id: "before", role: "user", extra: { marinaraPresence: { presentCharacterIds: ["a", "b"] }, hiddenFromAICharacterIds: [] } }];
const generatedUserInput = { chatId: "chat-1", role: "user", extra: { submissionId: "submission-1" } };
const generatedUserPatch = await registeredMessagePolicies[0].prepare({ input: generatedUserInput });
currentMessages.push({ id: "generated-user", ...generatedUserInput, ...generatedUserPatch });
assert(currentMessages.find((message) => message.id === "generated-user").extra.marinaraPresence.presentCharacterIds.join(",") === "a", "generated user message is stamped before its native save");
const generatedAssistantInput = { chatId: "chat-1", role: "assistant", characterId: "a", extra: {} };
const generatedAssistantPatch = await registeredMessagePolicies[0].prepare({ input: generatedAssistantInput });
currentMessages.push({ id: "generated-assistant", ...generatedAssistantInput, ...generatedAssistantPatch });
assert(currentMessages.find((message) => message.id === "generated-assistant").extra.marinaraPresence.presentCharacterIds.join(",") === "a", "generated assistant message is stamped");

currentMessages = [{ id: "regenerated", chatId: "chat-1", role: "assistant", characterId: "a", extra: { hiddenFromAICharacterIds: [] } }];
await registeredMessagePolicies[0].afterPersist({
  chatId: "chat-1",
  messageId: "regenerated",
  swipeIndex: 1,
  kind: "regenerate",
  message: currentMessages[0],
});
assert(currentMessages[0].extra.marinaraPresence.presentCharacterIds.join(",") === "a", "regenerate updates existing message visibility after generation");

currentMessages = [{ id: "history", role: "user", extra: { marinaraPresence: { presentCharacterIds: ["a"] }, hiddenFromAICharacterIds: ["b"] } }];
testChat = { ...testChat, characterIds: ["a", "b"], metadata: { ...testChat.metadata, inactiveCharacterIds: [] } };
const metadataWritesBeforeChatChange = metadataWriteCount;
await registeredChatPolicies[0].onChanged({
  chatId: "chat-1",
  source: "metadata",
  changedKeys: ["inactiveCharacterIds"],
  chat: testChat,
});
assert(metadataWriteCount === metadataWritesBeforeChatChange + 1, "chat change callback runs roster reconciliation");
assert(testChat.metadata.marinaraPresencePackage.rosterCharacterIds.join(",") === "a,b", "chat change callback reconciles the active roster");

currentMessages = [
  { id: "positive", role: "user", extra: { hiddenFromAICharacterIds: [], marinaraPresence: { presentCharacterIds: ["a"] } } },
  { id: "legacy", role: "user", extra: { hiddenFromAICharacterIds: ["b"] } },
  { id: "global", role: "user", extra: { hiddenFromAI: true, hiddenFromAICharacterIds: ["b"] } },
];
const resyncResult = await registeredRouteHandlers.get("POST /chat/:chatId/command")(
  { params: { chatId: "chat-1" }, body: { text: "/presence resync" } },
  replyStub(),
);
assert(resyncResult.updated === 2 && resyncResult.skippedGlobal === 1, "resync reports updated and skipped messages");
assert(currentMessages.find((message) => message.id === "positive").extra.hiddenFromAICharacterIds.join(",") === "b", "resync repairs native IDs from positive presence");
assert(currentMessages.find((message) => message.id === "legacy").extra.marinaraPresence.presentCharacterIds.join(",") === "a", "resync adopts legacy native state into positive presence");
assert(!currentMessages.find((message) => message.id === "global").extra.marinaraPresence, "resync leaves globally hidden messages unchanged");
assert(!injectedRequests.some((request) => request.url.includes("summary") || request.url.includes("lorebook")), "Presence does not touch summaries or lorebooks");

await selfCheck({ api: { runtime } });
delete globalThis[bridgeSymbol];
const serverRoutesSource = fs.readFileSync(new URL("../src/server/routes.js", import.meta.url), "utf8");
assert(!serverRoutesSource.includes("stampGeneratedUserMessageSoon"), "Presence no longer polls for generated user messages");
assert(!serverRoutesSource.includes("setTimeout"), "Presence server lifecycle contains no polling timer");
console.log("Presence checks passed.");

function replyStub() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      return payload;
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Presence check failed: ${message}`);
}
