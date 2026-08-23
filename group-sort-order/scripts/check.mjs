import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_SORT_SELECTOR_PROMPT,
  parseSmartGroupSelectionIds,
} from "../src/shared/state.js";

const candidates = [
  { id: "bob", name: "Bob", talkativeness: 80, personality: "Direct" },
  { id: "alice", name: "Alice", talkativeness: 40, description: "A careful observer" },
];
assert.deepEqual(parseSmartGroupSelectionIds('["alice", "bob", "alice"]', candidates), ["alice", "bob"]);
assert.deepEqual(parseSmartGroupSelectionIds('```json\n["Bob"]\n```', candidates), ["bob"]);
assert.deepEqual(parseSmartGroupSelectionIds('["unknown"]', candidates), []);
assert.match(DEFAULT_GROUP_SORT_SELECTOR_PROMPT, /valid JSON array/u);

const bridgeSymbol = Symbol.for("marinara.mari-bridge.v1");
let registration = null;
let requirements = null;
globalThis[bridgeSymbol] = {
  registerConsumer(input) {
    requirements = input;
    return {
      signal: new AbortController().signal,
      groupSelectors: {
        register(value) {
          registration = value;
          return () => { registration = null; };
        },
      },
      host: {
        request: async ({ method, path }) => {
          assert.equal(method, "GET");
          assert.equal(path, "/api/agents");
          return [{
            type: "group-sort-order",
            connectionId: "selector-connection",
            promptTemplate: "Select the next responder. Return JSON only.",
            settings: { temperature: 0.1, maxTokens: 128 },
          }];
        },
      },
      addCleanup() {},
      async close() {},
    };
  },
};

let modelRequest = null;
let chatRequest = null;
const { activate, selfCheck } = await import(`../src/server/index.js?check=${Date.now()}`);
const context = {
  package: { id: "group-sort-order" },
  api: {
    runtime: {
      getAgentConfig: async () => ({ connectionId: null, settings: {} }),
      languageModels: {
        async resolveForRequest(input) {
          modelRequest = input;
          return {
            async chatComplete(messages, options) {
              chatRequest = { messages, options };
              return { content: '["alice"]' };
            },
          };
        },
      },
      logger: { info() {}, warn() {} },
    },
  },
};

const cleanup = await activate(context);
assert.equal(requirements.consumerId, "group-sort-order");
assert(requirements.require.includes("group.selector"));
assert(requirements.require.includes("host.request"));
assert.equal(registration.id, "native-smart-selector");
assert.deepEqual(registration.agentTypes, ["group-sort-order"]);
assert.deepEqual(await registration.select({
  chatId: "chat-1",
  chatConnectionId: "chat-connection",
  personaName: "Player",
  candidates,
  messages: [
    { role: "user", content: "Alice, what do you think?" },
    { role: "assistant", characterId: "bob", content: "Bob waits." },
  ],
}), ["alice"]);
assert.deepEqual(modelRequest, { connectionId: "selector-connection", chatConnectionId: "chat-connection" });
assert.equal(chatRequest.messages[0].content, "Select the next responder. Return JSON only.");
assert.match(chatRequest.messages[1].content, /<candidates>/u);
assert.match(chatRequest.messages[1].content, /id: alice/u);
assert.match(chatRequest.messages[1].content, /Player: Alice, what do you think\?/u);
assert.deepEqual(chatRequest.options, { temperature: 0.1, maxTokens: 128, stream: false });
await selfCheck(context);
await cleanup();
delete globalThis[bridgeSymbol];

console.log("Group Sort Order native selector checks passed.");
