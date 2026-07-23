import { createSlashCommandRouter, matchSlashCommand } from "../../_mari-bridge/src/commands.js";
import { diffSummaryEntries } from "../../_mari-bridge/src/summary-tracking.js";
import { buildPresenceExtraPatch, readPresenceState } from "../src/shared/presence-state.js";
import { planRosterBackfill } from "../src/shared/roster.js";
import { activate, selfCheck } from "../src/server/index.js";
import { buildSummaryAudience, buildSummaryLorebookEntries } from "../src/server/summary-mirror.js";
import { planExtensionMigration } from "../src/server/migration.js";

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
  extra: { hiddenFromAICharacterIds: ["manual"], marinaraPresencePackage: { ownedHiddenFromAICharacterIds: ["old"] } },
  rosterIds: ["a", "b", "manual"],
  presentCharacterIds: ["a"],
});
assert(patch.hiddenFromAICharacterIds.includes("b"), "presence hidden character added");
assert(patch.hiddenFromAICharacterIds.includes("manual"), "manual hidden character preserved");
assert(!patch.hiddenFromAICharacterIds.includes("old"), "old owned hidden character removed");

const nobodyPresent = readPresenceState(
  { extra: { marinaraPresencePackage: { presentCharacterIds: [] } } },
  ["a", "b"],
);
assert(nobodyPresent.size === 0, "empty stored presence means nobody present");

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
  ["m1", { id: "m1", extra: { marinaraPresencePackage: { presentCharacterIds: ["a"] } } }],
  ["m2", { id: "m2", extra: { marinaraPresencePackage: { presentCharacterIds: ["a", "b"] } } }],
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

const migration = planExtensionMigration({
  roster: [{ id: "a", name: "Alice" }],
  messages: [{ id: "m1", extra: { marinaraPresence: { mode: "default" } } }],
});
assert(migration.patches[0]?.patch.marinaraPresencePackage.presentCharacterIds[0] === "a", "legacy default migrates as everyone present");

const registeredRoutes = [];
const registeredHooks = [];
const injectedRequests = [];
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
      return { statusCode: 200, payload: "{}" };
    },
  },
  api: {
    runtime: {
      logger: { info() {}, warn() {} },
      persistence: {
        getChat(chatId) {
          return {
            id: chatId,
            characterIds: ["a", "b"],
            metadata: { inactiveCharacterIds: ["b"] },
          };
        },
        listMessages() {},
        updateChatMetadata() {},
      },
      resources: { listCharacters() {} },
    },
  },
});
assert(registeredRoutes.includes("GET /chat/:chatId/state"), "activate registers state route");
assert(registeredRoutes.includes("POST /chat/:chatId/command"), "activate registers command route");
assert(registeredRoutes.includes("POST /chat/:chatId/migrate-extension"), "activate registers extension migration route");
assert(registeredRoutes.includes("POST /chat/:chatId/summaries/reconcile"), "activate registers summary reconcile route");
assert(registeredHooks.some((hook) => hook.name === "onSend"), "activate registers message save hook");
await registeredHooks
  .find((hook) => hook.name === "onSend")
  .handler(
    { method: "POST", url: "/api/chats/chat-1/messages" },
    { statusCode: 200 },
    JSON.stringify({ id: "m1", chatId: "chat-1", role: "user", extra: {} }),
  );
const messagePatch = injectedRequests.find((request) => request.url.includes("/messages/m1/extra"));
assert(messagePatch, "message save hook patches created message extra");
assert(messagePatch.payload.marinaraPresencePackage.presentCharacterIds.join(",") === "a", "message save uses active roster");
assert(messagePatch.payload.hiddenFromAICharacterIds.join(",") === "b", "message save hides inactive character");

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
