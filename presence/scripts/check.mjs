import fs from "node:fs";
import { createHideCommandOwner } from "../src/shared/message-range.js";
import { readPresenceChatState } from "../src/shared/chat-state.js";
import {
  assertVisibilityPatchScope,
  buildPresenceExtraPatch,
  buildVisibilityDeltaPatch,
  readPresenceState,
} from "../src/shared/presence-state.js";
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
assert(clientRuntime.includes("body: { characterId, alwaysPresent }"), "settings save one atomic character toggle");
assert(clientRuntime.includes("savingCharacterIds"), "settings suppress duplicate in-flight toggles");
assert(clientRuntime.includes("version !== this.renderVersion"), "stale settings responses cannot repaint a newer chat state");
assert(!clientRuntime.includes("setMariBridgeNativeSettingsHtml"), "client does not replace Marinara's agent settings shell");
assert(!clientRuntime.includes("summary"), "client no longer describes summary behavior");
assert(!clientRuntime.includes("MutationObserver"), "client does not DOM-inject chat settings");
assert(!clientRuntime.includes("watchActiveChatId"), "client uses bridge active-chat state without polling");

const patch = buildPresenceExtraPatch({
  extra: { hiddenFromAI: true, hiddenFromAICharacterIds: ["outside-roster"] },
  rosterIds: ["a", "b"],
  presentCharacterIds: ["a"],
});
assert(patch.hiddenFromAICharacterIds.join(",") === "outside-roster,b", "explicit roster presence maps directly to native hidden IDs");
assert(patch.hiddenFromAI === true, "global hidden flag is preserved");
assert(!Object.prototype.hasOwnProperty.call(patch, "marinaraPresence"), "message patches do not write a positive attendance store");

const nativeWins = readPresenceState({
  extra: {
    hiddenFromAICharacterIds: [],
    marinaraPresence: { version: 1, presentCharacterIds: ["a"] },
  },
}, ["a", "b"]);
assert(nativeWins.has("a") && nativeWins.has("b"), "legacy positive records cannot override native visibility");
assert(
  readPresenceState({ extra: { hiddenFromAICharacterIds: ["b"] } }, ["a", "b"]).has("a"),
  "native hidden IDs define message presence",
);
const targetOnly = buildVisibilityDeltaPatch({
  extra: { hiddenFromAICharacterIds: ["a", "outside-roster"] },
  hiddenCharacterIds: ["b"],
  visibleCharacterIds: ["a"],
});
assert(targetOnly.hiddenFromAICharacterIds.join(",") === "outside-roster,b", "target-only visibility preserves unrelated IDs");
assertThrows(
  () => assertVisibilityPatchScope({
    extra: { hiddenFromAICharacterIds: ["a"] },
    patch: { hiddenFromAI: false, hiddenFromAICharacterIds: ["b"] },
    allowedCharacterIds: ["a"],
    operation: "Regression test",
  }),
  "scoped guard rejects changes to an unrelated character",
);
assertThrows(
  () => assertVisibilityPatchScope({
    extra: { hiddenFromAI: false, hiddenFromAICharacterIds: [] },
    patch: { hiddenFromAI: true, hiddenFromAICharacterIds: [] },
    allowedCharacterIds: [],
    operation: "Regression test",
  }),
  "scoped guard rejects global Hide From AI changes",
);

const backfill = planRosterBackfill({
  knownCharacterIds: ["a"],
  currentRosterIds: ["a", "b"],
  messages: [{ id: "m1", extra: { hiddenFromAICharacterIds: ["outside-roster"] } }],
});
assert(backfill.messagePatches.length === 1, "new character backfill is planned");
assert(backfill.messagePatches[0].patch.hiddenFromAICharacterIds.join(",") === "outside-roster,b", "backfill adds only the new character");
assert(
  planRosterBackfill({
    knownCharacterIds: ["a"],
    currentRosterIds: ["a", "b"],
    messages: [{ id: "m1", extra: {} }],
    alwaysPresentCharacterIds: ["b"],
  }).messagePatches.length === 0,
  "omnipresent characters are not hidden during backfill",
);
assert(readPresenceChatState({ metadata: { marinaraPresencePackage: { rosterCharacterIds: ["a"] } } }).knownCharacterIds[0] === "a", "legacy roster snapshots migrate to the known-character set");

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
    withChatLock(_chatId, operation) {
      return operation();
    },
  },
  resources: {
    listCharacters() {
      const names = { a: "Alice", b: "Bob", c: "Cora" };
      return testChat.characterIds.map((id) => ({ id, data: { name: names[id] || id }, comment: "" }));
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
assert(!Object.prototype.hasOwnProperty.call(currentMessages[0].extra, "marinaraPresence"), "first enable does not rewrite old history");
assert(currentMessages[0].extra.hiddenFromAICharacterIds === undefined, "first enable preserves native visibility exactly");
assert(testChat.metadata.marinaraPresencePackage.knownCharacterIds.join(",") === "a,b", "first enable seeds the known-character set");

const stateBeforeLegacyReplacement = JSON.stringify(testChat.metadata.marinaraPresencePackage);
const rejectedReplacement = await registeredRouteHandlers.get("PATCH /chat/:chatId/settings")(
  { params: { chatId: "chat-1" }, body: { alwaysPresentCharacterIds: ["b"] } },
  replyStub(),
);
assert(rejectedReplacement.error.includes("characterId"), "replacement-style omnipresent settings are rejected");
assert(JSON.stringify(testChat.metadata.marinaraPresencePackage) === stateBeforeLegacyReplacement, "rejected replacement settings cannot alter chat state");

const postedInput = { chatId: "chat-1", role: "user", content: "Private", extra: { submissionId: "submission-1" } };
const postedPatch = await registeredMessagePolicies[0].prepare({ input: postedInput });
currentMessages.push({ id: "posted", ...postedInput, ...postedPatch });
assert(currentMessages.find((message) => message.id === "posted").extra.hiddenFromAICharacterIds.join(",") === "b", "new messages hide only inactive roster characters");
assert(!Object.prototype.hasOwnProperty.call(currentMessages.find((message) => message.id === "posted").extra, "marinaraPresence"), "new messages do not store positive attendance");
assert(currentMessages.find((message) => message.id === "posted").extra.submissionId === "submission-1", "native preparation preserves unrelated message extras");

currentMessages = [
  { id: "legacy-positive", role: "user", extra: { hiddenFromAICharacterIds: [], marinaraPresence: { presentCharacterIds: ["a"] } } },
  { id: "target-only", role: "user", extra: { hiddenFromAICharacterIds: ["b", "outside-roster"] } },
];
await registeredRouteHandlers.get("PATCH /chat/:chatId/settings")(
  { params: { chatId: "chat-1" }, body: { characterId: "b", alwaysPresent: true } },
  replyStub(),
);
assert(testChat.metadata.marinaraPresencePackage.alwaysPresentCharacterIds.join(",") === "b", "atomic settings persist the omnipresent character");
assert(testChat.metadata.enableAgents === true && testChat.metadata.activeAgentIds.includes("presence"), "atomic settings preserve unrelated chat metadata");
assert(currentMessages.find((message) => message.id === "legacy-positive").extra.hiddenFromAICharacterIds.length === 0, "legacy positive state cannot hide other characters during omnipresent updates");
assert(currentMessages.find((message) => message.id === "target-only").extra.hiddenFromAICharacterIds.join(",") === "outside-roster", "omnipresent updates remove only the selected ID");

await registeredRouteHandlers.get("PATCH /chat/:chatId/settings")(
  { params: { chatId: "chat-1" }, body: { characterId: "b", alwaysPresent: false } },
  replyStub(),
);
assert(testChat.metadata.marinaraPresencePackage.alwaysPresentCharacterIds.length === 0, "omnipresent can be disabled atomically");
assert(currentMessages.find((message) => message.id === "target-only").extra.hiddenFromAICharacterIds.join(",") === "outside-roster", "disabling omnipresent does not invent historical absence");
const futureAfterDisable = await registeredMessagePolicies[0].prepare({ input: { chatId: "chat-1", role: "user", extra: {} } });
assert(futureAfterDisable.extra.hiddenFromAICharacterIds.join(",") === "b", "disabling omnipresent affects future messages");
await registeredRouteHandlers.get("PATCH /chat/:chatId/settings")(
  { params: { chatId: "chat-1" }, body: { characterId: "b", alwaysPresent: true } },
  replyStub(),
);

testChat = { ...testChat, characterIds: ["a"] };
await registeredChatPolicies[0].onChanged({
  chatId: "chat-1",
  source: "chat",
  changedKeys: ["characterIds"],
  chat: { ...testChat, metadata: {} },
});
assert(testChat.metadata.marinaraPresencePackage.alwaysPresentCharacterIds.join(",") === "b", "temporarily absent omnipresent characters are not forgotten");
assert(testChat.metadata.marinaraPresencePackage.knownCharacterIds.join(",") === "a,b", "known characters remain monotonic when removed");

testChat = { ...testChat, characterIds: ["a", "b"] };
currentMessages = [{ id: "readded", role: "user", extra: { hiddenFromAICharacterIds: [] } }];
await registeredChatPolicies[0].onChanged({ chatId: "chat-1", source: "chat", changedKeys: ["characterIds"], chat: testChat });
assert(currentMessages[0].extra.hiddenFromAICharacterIds.length === 0, "re-adding a known character does not erase their history");

testChat = { ...testChat, characterIds: ["a", "b", "c"] };
currentMessages = [{ id: "before-c", role: "user", extra: { hiddenFromAICharacterIds: ["outside-roster"] } }];
await registeredChatPolicies[0].onChanged({ chatId: "chat-1", source: "chat", changedKeys: ["characterIds"], chat: testChat });
assert(currentMessages[0].extra.hiddenFromAICharacterIds.join(",") === "outside-roster,c", "a genuinely new character is backfilled without changing other visibility");
assert(testChat.metadata.marinaraPresencePackage.knownCharacterIds.join(",") === "a,b,c", "new characters join the monotonic known set");

testChat = {
  ...testChat,
  characterIds: ["a", "b"],
  metadata: {
    ...testChat.metadata,
    inactiveCharacterIds: ["b"],
    marinaraPresencePackage: {
      ...testChat.metadata.marinaraPresencePackage,
      alwaysPresentCharacterIds: [],
    },
  },
};
const generatedUserInput = { chatId: "chat-1", role: "user", extra: { submissionId: "submission-2" } };
const generatedUserPatch = await registeredMessagePolicies[0].prepare({ input: generatedUserInput });
assert(generatedUserPatch.extra.hiddenFromAICharacterIds.join(",") === "b", "generated user messages use native negative visibility");

currentMessages = [{ id: "regenerated", chatId: "chat-1", role: "assistant", characterId: "a", extra: { hiddenFromAICharacterIds: ["b", "outside-roster"] } }];
const requestsBeforeRegenerate = injectedRequests.length;
await registeredMessagePolicies[0].afterPersist({
  chatId: "chat-1",
  messageId: "regenerated",
  swipeIndex: 1,
  kind: "regenerate",
  message: currentMessages[0],
});
assert(injectedRequests.length === requestsBeforeRegenerate, "regenerate preserves existing visibility when no omnipresent repair is needed");
assert(currentMessages[0].extra.hiddenFromAICharacterIds.join(",") === "b,outside-roster", "regenerate does not restamp the active roster");

const metadataWritesBeforeInactiveChange = metadataWriteCount;
await registeredChatPolicies[0].onChanged({
  chatId: "chat-1",
  source: "metadata",
  changedKeys: ["inactiveCharacterIds"],
  chat: testChat,
});
assert(metadataWriteCount === metadataWritesBeforeInactiveChange, "unchanged roster reconciliation does not rewrite chat metadata");

currentMessages = [
  { id: "legacy-positive", role: "user", extra: { hiddenFromAICharacterIds: [], marinaraPresence: { presentCharacterIds: ["a"] } } },
  { id: "native", role: "user", extra: { hiddenFromAICharacterIds: ["b"] } },
  { id: "global", role: "user", extra: { hiddenFromAI: true, hiddenFromAICharacterIds: ["b"] } },
];
const resyncResult = await registeredRouteHandlers.get("POST /chat/:chatId/command")(
  { params: { chatId: "chat-1" }, body: { text: "/presence resync" } },
  replyStub(),
);
assert(resyncResult.updated === 0, "resync does not rebuild native visibility from legacy positive records");
assert(currentMessages.find((message) => message.id === "legacy-positive").extra.hiddenFromAICharacterIds.length === 0, "resync leaves native visibility authoritative");
assert(currentMessages.find((message) => message.id === "native").extra.hiddenFromAICharacterIds.join(",") === "b", "resync preserves explicit native hidden IDs");
assert(currentMessages.find((message) => message.id === "global").extra.hiddenFromAICharacterIds.join(",") === "b", "resync leaves globally hidden messages unchanged");
assert(!injectedRequests.some((request) => request.url.includes("summary") || request.url.includes("lorebook")), "Presence does not touch summaries or lorebooks");

await selfCheck({ api: { runtime } });
delete globalThis[bridgeSymbol];
const serverRoutesSource = fs.readFileSync(new URL("../src/server/routes.js", import.meta.url), "utf8");
assert(!serverRoutesSource.includes("stampGeneratedUserMessageSoon"), "Presence no longer polls for generated user messages");
assert(!serverRoutesSource.includes("setTimeout"), "Presence server lifecycle contains no polling timer");
assert(serverRoutesSource.includes("Presence refused an unguarded message visibility write"), "every message visibility write requires an explicit scope guard");
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

function assertThrows(operation, message) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`Presence check failed: ${message}`);
}
