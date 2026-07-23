import {
  buildCandidateHash,
  buildInstructionText,
  deriveNextSpeaker,
  normalizeGroupSortState,
  parseSmartGroupSelectionIds,
  parseTerminalNextSpeakerMarker,
  stripTerminalNextSpeakerMarker
} from "../src/shared/state.js";
import fs from "node:fs/promises";
import { createGroupSortRoutes, registerGroupSortHooks } from "../src/server/routes.js";
import { activate, selfCheck } from "../src/server/index.js";

const candidates = [
  { id: "bob", name: "Bob", kind: "character" },
  { id: "james", name: "James", kind: "character" },
  { id: "alice", name: "Alice", kind: "persona" }
];
const candidateHash = buildCandidateHash(candidates, { includePersonaCandidate: true });
const instruction = buildInstructionText(candidates);
assert(instruction.includes("<next_speaker>candidate-id</next_speaker>"), "instruction contains marker example");
assert(instruction.includes("- id: bob"), "instruction labels candidate ids");
assert(instruction.includes("  name: Bob"), "instruction labels candidate names");

const parsed = parseTerminalNextSpeakerMarker("Hello.\n<next_speaker>bob</next_speaker>\n");
assert(parsed?.speakerId === "bob", "terminal marker parsed");
assert(stripTerminalNextSpeakerMarker("Hello.\n<next_speaker>bob</next_speaker>\n") === "Hello.", "terminal marker stripped");
assert(parseTerminalNextSpeakerMarker("<next_speaker>bob</next_speaker>\nHello.") === null, "non-terminal marker rejected");
assert(parseSmartGroupSelectionIds('```json\n["james"]\n```', candidates)[0] === "james", "smart selector JSON array parsed");
assert(parseSmartGroupSelectionIds('{"characters":["Alice"]}', candidates)[0] === "alice", "smart selector names parsed");

const state = normalizeGroupSortState({
  includePersonaCandidate: false,
  candidateHash,
  byAnchor: {
    "m1:0": { messageId: "m1", swipeIndex: 0, messageSpeakerId: "james", nextSpeakerId: "bob", candidateHash }
  }
});
assert(state.includePersonaCandidate === false, "include persona setting preserved");
assert(
  deriveNextSpeaker({
    state,
    messages: [{ id: "m1", activeSwipeIndex: 0 }],
    candidates,
    candidateHash
  })?.id === "bob",
  "next speaker derives from active message swipe"
);
assert(
  deriveNextSpeaker({
    state,
    messages: [{ id: "m1", activeSwipeIndex: 1 }],
    candidates,
    candidateHash
  }) === null,
  "swipe change invalidates derived next speaker"
);

const routes = [];
const hooks = [];
await activate({
  app: {
    addHook(name, handler) {
      hooks.push({ name, handler });
    },
    async register(callback, options) {
      assert(options?.prefix === "/api/group-sort-order", "activate uses package route prefix");
      await callback({
        get(route) {
          routes.push(`GET ${route}`);
        },
        post(route) {
          routes.push(`POST ${route}`);
        },
        patch(route) {
          routes.push(`PATCH ${route}`);
        },
        put(route) {
          routes.push(`PUT ${route}`);
        },
        delete(route) {
          routes.push(`DELETE ${route}`);
        }
      });
    },
    db: fakeDb()
  },
  api: {
    runtime: {
      logger: { info() {}, warn() {} },
      persistence: {
        getChat() {},
        listMessages() {},
        updateChatMetadata() {},
        transaction(operation) {
          return operation(this);
        },
        withChatLock(_chatId, operation) {
          return operation();
        }
      },
      resources: { listCharacters() {} },
      languageModels: { resolve() {} }
    }
  }
});
assert(routes.includes("GET /chat/:chatId/state"), "state route registered");
assert(routes.includes("POST /chat/:chatId/ensure"), "ensure route registered");
assert(routes.includes("POST /chat/:chatId/refresh"), "refresh route registered");
assert(routes.includes("PATCH /chat/:chatId/settings"), "settings route registered");
assert(routes.includes("GET /prompt-contributions/:chatId"), "prompt contribution list route registered");
assert(routes.includes("PUT /prompt-contributions/:chatId/:agentType"), "prompt contribution set route registered");
assert(routes.includes("DELETE /prompt-contributions/:chatId/:agentType"), "prompt contribution clear route registered");
assert(hooks.some((hook) => hook.name === "preHandler"), "preHandler hook registered");
assert(hooks.some((hook) => hook.name === "onResponse"), "onResponse hook registered");

const routesSource = await fs.readFile(new URL("../src/server/routes.js", import.meta.url), "utf8");
assert(routesSource.includes("/api/generate/raw"), "refresh uses raw generation selector route");
assert(routesSource.includes("statePersona?.name"), "refresh transcript can name persona outside candidate list");
assert(!routesSource.includes("manualTrackerAgentTypes"), "misc feature does not write tracker metadata");
const clientSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
assert(clientSource.includes("marinara-capability-group-sort-order"), "client registers package capability element");
assert(clientSource.includes("capabilityProps"), "client reads capability props");
assert(clientSource.includes("findInputContainer"), "client anchors to visible chat input container");
const buildSource = await fs.readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
assert(buildSource.includes('slots: ["chat-runtime"]'), "manifest declares chat-runtime slot");
assert(buildSource.includes("runtimeDisabled: true"), "feature marker is runtime-disabled");

await selfCheck({
  app: { db: fakeDb() },
  api: {
    runtime: {
      persistence: { getChat() {}, listMessages() {}, updateChatMetadata() {} },
      resources: { listCharacters() {} },
      languageModels: { resolve() {} }
    }
  }
});

assert(typeof createGroupSortRoutes === "function", "routes export exists");
assert(typeof registerGroupSortHooks === "function", "hooks export exists");

function fakeDb() {
  return {
    select() {
      return this;
    },
    from() {
      return this;
    },
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    limit() {
      return [];
    },
    insert() {
      return { values() {} };
    },
    update() {
      return { set: () => ({ where() {} }) };
    },
    transaction(operation) {
      return operation(this);
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

console.log("Group Sort Order checks passed.");
