import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_SORT_PROMPT_TEMPLATE,
  DEFAULT_GROUP_SORT_SELECTOR_PROMPT,
  buildCandidateHash,
  buildInstructionText,
  deriveNextParticipant,
  normalizeGroupSortState,
  parseSmartGroupSelectionIds,
  readGroupSortState,
  upsertAnchor,
} from "../src/shared/state.js";

const candidates = [
  { id: "bob", name: "Bob", kind: "character", talkativeness: 80, personality: "Direct" },
  { id: "alice", name: "Alice", kind: "character", talkativeness: 40, description: "A careful observer" },
  { id: "persona-1", name: "Player", kind: "persona", talkativeness: 50 },
];
assert.deepEqual(parseSmartGroupSelectionIds('["alice", "bob", "alice"]', candidates), ["alice", "bob"]);
assert.deepEqual(parseSmartGroupSelectionIds('```json\n["Player"]\n```', candidates), ["persona-1"]);
assert.deepEqual(parseSmartGroupSelectionIds('["unknown"]', candidates), []);
assert.match(DEFAULT_GROUP_SORT_SELECTOR_PROMPT, /valid JSON array/u);
assert.equal(normalizeGroupSortState({}).includePersonaCandidate, true);
assert.equal(normalizeGroupSortState({ includePersonaCandidate: false }).includePersonaCandidate, false);
const instruction = buildInstructionText(candidates, "bob", DEFAULT_GROUP_SORT_PROMPT_TEMPLATE);
assert.doesNotMatch(instruction, /id: bob/u);
assert.match(instruction, /id: alice/u);
assert.match(instruction, /id: persona-1/u);
assert.match(instruction, /<next_speaker>candidate-id<\/next_speaker>/u);

const candidateHash = buildCandidateHash(candidates, true);
const anchored = upsertAnchor(normalizeGroupSortState({}), {
  messageId: "message-1",
  swipeIndex: 1,
  messageParticipantId: "bob",
  nextParticipantId: "alice",
  candidateHash,
  source: "marker",
});
assert.equal(deriveNextParticipant({
  state: anchored,
  messages: [{ id: "message-1", role: "assistant", characterId: "bob", activeSwipeIndex: 1 }],
  candidates,
  candidateHash,
})?.id, "alice");
assert.equal(deriveNextParticipant({
  state: anchored,
  messages: [{ id: "message-1", role: "assistant", characterId: "bob", activeSwipeIndex: 0 }],
  candidates,
  candidateHash,
}), null);
assert.equal(deriveNextParticipant({
  state: anchored,
  messages: [{ id: "message-1", role: "assistant", characterId: "bob", activeSwipeIndex: 1 }],
  candidates,
  candidateHash: "changed",
}), null);

const bridgeSymbol = Symbol.for("marinara.mari-bridge.v1");
let promptRegistration = null;
let handoffRegistration = null;
let selectorRegistration = null;
let requirements = null;
globalThis[bridgeSymbol] = {
  registerConsumer(input) {
    requirements = input;
    return {
      signal: new AbortController().signal,
      prompts: {
        inject(value) { promptRegistration = value; return () => { promptRegistration = null; }; },
      },
      turnHandoffs: {
        register(value) { handoffRegistration = value; return () => { handoffRegistration = null; }; },
      },
      groupSelectors: {
        register(value) { selectorRegistration = value; return () => { selectorRegistration = null; }; },
      },
      host: {
        request: async ({ method, path }) => {
          assert.equal(method, "GET");
          assert.equal(path, "/api/agents");
          return [{
            type: "group-sort-order",
            connectionId: "selector-connection",
            promptTemplate: "Choose from:\n{{candidates}}\nAppend {{marker}}",
            settings: {
              selectorPrompt: "Select the next participant. Return JSON only.",
              temperature: 0.1,
              maxTokens: 96,
            },
          }];
        },
      },
      addCleanup() {},
      async close() {},
    };
  },
};

const chat = {
  id: "chat-1",
  connectionId: "chat-connection",
  characterIds: ["bob", "alice"],
  personaId: "persona-1",
  metadata: { enableAgents: true, activeAgentIds: ["group-sort-order"] },
};
const messages = [
  { id: "user-1", role: "user", content: "Who should answer?", activeSwipeIndex: 0 },
  { id: "message-1", role: "assistant", characterId: "bob", content: "Bob waits.", activeSwipeIndex: 0 },
];
let modelRequest = null;
let chatRequest = null;
const runtime = {
  getAgentConfig: async () => ({ connectionId: null, settings: {} }),
  languageModels: {
    async resolveForRequest(input) {
      modelRequest = input;
      return {
        async chatComplete(requestMessages, options) {
          chatRequest = { messages: requestMessages, options };
          return { content: '["alice"]' };
        },
      };
    },
  },
  resources: {
    async listCharacters(ids) {
      return ids.map((id) => ({
        id,
        data: id === "bob"
          ? { name: "Bob", talkativeness: 0.8, personality: "Direct" }
          : { name: "Alice", talkativeness: 0.4, description: "A careful observer" },
      }));
    },
    async listPersonas(ids) {
      return ids.map((id) => ({ id, data: { name: "Player", personality: "Curious" } }));
    },
  },
  persistence: {
    async getChat(id) { return id === chat.id ? chat : null; },
    async listMessages(id) { return id === chat.id ? messages : []; },
    async updateChatMetadata({ chatId, metadata }) {
      assert.equal(chatId, chat.id);
      chat.metadata = metadata;
    },
  },
  logger: { info() {}, warn() {} },
};

const { activate, selfCheck } = await import(`../src/server/index.js?check=${Date.now()}`);
const context = { package: { id: "group-sort-order" }, api: { runtime } };
const cleanup = await activate(context);
assert.equal(requirements.consumerId, "group-sort-order");
for (const capability of ["group.selector", "host.request", "prompt.inject", "turn.handoff"]) {
  assert(requirements.require.includes(capability));
}
assert.equal(promptRegistration.id, "next-participant-marker");
assert.equal(handoffRegistration.id, "next-participant");
assert.equal(selectorRegistration.id, "fallback-selector");

const injected = await promptRegistration.build({
  lane: "main",
  workflow: "chat",
  chatId: chat.id,
  characterIds: ["bob"],
  impersonate: false,
});
assert.doesNotMatch(injected, /id: bob/u);
assert.match(injected, /id: alice/u);
assert.match(injected, /id: persona-1/u);
assert.match(injected, /<next_speaker>candidate-id<\/next_speaker>/u);

assert.equal(await handoffRegistration.validate({
  chatId: chat.id,
  participantId: "bob",
  targetCharacterId: "bob",
}), null);
assert.deepEqual(await handoffRegistration.validate({
  chatId: chat.id,
  participantId: "persona-1",
  targetCharacterId: "bob",
}), { id: "persona-1", name: "Player", kind: "persona", talkativeness: 50, personality: "Curious", description: "" });
await handoffRegistration.commit({
  chatId: chat.id,
  messageId: "message-2",
  swipeIndex: 0,
  messageSpeakerId: "bob",
  participant: { id: "persona-1", name: "Player", kind: "persona" },
});
messages.push({ id: "message-2", role: "assistant", characterId: "bob", content: "Bob answers.", activeSwipeIndex: 0 });
assert.equal((await handoffRegistration.resolve({ chatId: chat.id, hasIncomingUserTurn: false }))?.id, "persona-1");
assert.equal(await handoffRegistration.resolve({ chatId: chat.id, hasIncomingUserTurn: true }), null);
assert.equal((await handoffRegistration.view({ chatId: chat.id })).status, "known");

const withoutPersona = await handoffRegistration.update({
  chatId: chat.id,
  patch: { includePersonaCandidate: false },
});
assert.equal(withoutPersona.includePersonaCandidate, false);
assert.equal(withoutPersona.status, "unknown");
assert.equal(readGroupSortState(chat.metadata).includePersonaCandidate, false);

const refreshed = await handoffRegistration.refresh({ chatId: chat.id });
assert.equal(refreshed.status, "known");
assert.equal(refreshed.nextParticipant.id, "alice");
assert.deepEqual(modelRequest, { connectionId: "selector-connection", chatConnectionId: "chat-connection" });
assert.equal(chatRequest.messages[0].content, "Select the next participant. Return JSON only.");
assert.match(chatRequest.messages[1].content, /<candidates>/u);
assert.match(chatRequest.messages[1].content, /id: alice/u);
assert.doesNotMatch(chatRequest.messages[1].content, /id: bob/u);
assert.deepEqual(chatRequest.options, { temperature: 0.1, maxTokens: 96, stream: false });

assert.deepEqual(await selectorRegistration.select({
  chatId: chat.id,
  candidates: [
    { id: "bob", displayName: "Bob", talkativeness: 0.8 },
    { id: "alice", displayName: "Alice", talkativeness: 0.4 },
  ],
}), ["alice"]);
await selfCheck(context);
await cleanup();
delete globalThis[bridgeSymbol];

console.log("Group Sort Order native turn-handoff checks passed.");
