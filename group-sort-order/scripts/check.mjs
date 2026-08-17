import {
  buildCandidateHash,
  buildInstructionText,
  deriveNextSpeaker,
  filterNextSpeakerCandidates,
  normalizeGroupSortState,
  parseSmartGroupSelectionIds,
  parseTerminalNextSpeakerMarker,
  resolveLatestParticipantCandidate,
  resolveMessageParticipantCandidate,
  stripTerminalNextSpeakerMarker
} from "../src/shared/state.js";
import fs from "node:fs/promises";
import {
  createGroupSortRoutes,
  registerGroupSortHooks,
  resolveAvailableCandidateCount,
  resolveGeneratedAssistantTarget,
  resolveSmartSelectorConnectionId,
  sanitizeOutgoingSseChunk,
  sanitizeOutgoingSseChunkResult,
  waitForPendingMarkerCleanup
} from "../src/server/routes.js";
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
const excludingBobInstruction = buildInstructionText(candidates, { excludedCandidateId: "bob" });
assert(!excludingBobInstruction.includes("- id: bob"), "instruction excludes blocked latest participant id");
assert(excludingBobInstruction.includes("- id: james"), "instruction keeps other candidates when one is blocked");
assert(filterNextSpeakerCandidates(candidates, "bob").every((candidate) => candidate.id !== "bob"), "candidate filter excludes blocked id");
assert(
  resolveLatestParticipantCandidate([{ id: "a1", role: "assistant", characterId: "bob" }], candidates)?.id === "bob",
  "latest assistant participant resolves to candidate"
);
assert(
  resolveLatestParticipantCandidate([{ id: "u1", role: "user" }], candidates)?.id === "alice",
  "latest user participant resolves to persona candidate"
);
assert(
  resolveMessageParticipantCandidate({ id: "a1", role: "assistant", characterId: "james" }, candidates)?.id === "james",
  "assistant message participant resolves by character id"
);

const parsed = parseTerminalNextSpeakerMarker("Hello.\n<next_speaker>bob</next_speaker>\n");
assert(parsed?.speakerId === "bob", "terminal marker parsed");
assert(stripTerminalNextSpeakerMarker("Hello.\n<next_speaker>bob</next_speaker>\n") === "Hello.", "terminal marker stripped");
assert(parseTerminalNextSpeakerMarker("Hello.\n<NEXT_SPEAKER>bob</NEXT_SPEAKER>")?.speakerId === "bob", "marker tags are case-insensitive");
assert(
  parseTerminalNextSpeakerMarker("Hello.\n&lt;next_speaker&gt;bob&lt;/next_speaker&gt;")?.speakerId === "bob",
  "escaped marker tags are parsed"
);
assert(
  parseTerminalNextSpeakerMarker("Hello.\n<next_speaker;>;bob;</next_speaker;>;")?.speakerId === "bob",
  "stray semicolons in marker syntax are tolerated"
);
assert(
  parseTerminalNextSpeakerMarker("Hello.\n<next_speaker>;;bob;;</next_speaker>")?.speakerId === "bob",
  "stray semicolons around marker id are ignored"
);
assert(
  stripTerminalNextSpeakerMarker("Hello.\n&lt;next_speaker&gt;bob&lt;/next_speaker&gt;") === "Hello.",
  "escaped marker tags are stripped"
);
assert(parseTerminalNextSpeakerMarker("<next_speaker>bob</next_speaker>\nHello.") === null, "non-terminal marker rejected");
assert(parseSmartGroupSelectionIds('```json\n["james"]\n```', candidates)[0] === "james", "smart selector JSON array parsed");
assert(parseSmartGroupSelectionIds('{"characters":["Alice"]}', candidates)[0] === "alice", "smart selector names parsed");

let selectorRequest = null;
assert(
  (await resolveSmartSelectorConnectionId(
    {
      languageModels: {
        async resolveForRequest(request) {
          selectorRequest = request;
          return { connectionId: "agent-default" };
        }
      }
    },
    { connectionId: "chat-default" }
  )) === "agent-default",
  "smart selector uses the capability request resolver"
);
assert(selectorRequest?.chatConnectionId === "chat-default", "chat connection is supplied only as resolver fallback");

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
    messages: [{ id: "m1", role: "assistant", characterId: "bob", activeSwipeIndex: 0 }],
    candidates,
    candidateHash
  }) === null,
  "next speaker cannot be the latest participant"
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
assert(
  deriveNextSpeaker({
    state,
    messages: [
      { id: "m1", role: "assistant", activeSwipeIndex: 0 },
      { id: "m2", role: "assistant", activeSwipeIndex: 0 }
    ],
    candidates,
    candidateHash
  }) === null,
  "newer unanchored assistant message invalidates stale next speaker"
);
assert(
  deriveNextSpeaker({
    state,
    messages: [
      { id: "m1", role: "assistant", activeSwipeIndex: 0 },
      { id: "u2", role: "user", activeSwipeIndex: 0 }
    ],
    candidates,
    candidateHash
  }) === null,
  "newer unanchored user message invalidates stale next speaker"
);
assert(
  resolveAvailableCandidateCount(
    { characterIds: ["bob", "james"], personaId: "alice", metadata: {} },
    { includePersonaCandidate: false }
  ) === 3,
  "two active characters plus a persona are three available candidates"
);
assert(
  resolveAvailableCandidateCount(
    { characterIds: ["bob", "james"], personaId: "alice", metadata: { inactiveCharacterIds: ["james"] } },
    { includePersonaCandidate: false }
  ) === 2,
  "inactive characters are excluded from available candidates"
);
assert(
  resolveGeneratedAssistantTarget({
    messages: [
      { id: "u1", role: "user", content: "Hello" },
      { id: "a1", role: "assistant", content: "Old" },
      { id: "a2", role: "assistant", content: "New" }
    ],
    beforeMessageIds: new Set(["u1", "a1"]),
    targetMessageId: ""
  })?.id === "a2",
  "fresh generation target resolves from created assistant message"
);
assert(
  resolveGeneratedAssistantTarget({
    messages: [
      { id: "u1", role: "user", content: "Hello" },
      { id: "a1", role: "assistant", content: "Regenerated", activeSwipeIndex: 2 }
    ],
    beforeMessageIds: new Set(["u1", "a1"]),
    targetMessageId: "a1"
  })?.id === "a1",
  "regeneration target resolves from explicit existing assistant message"
);
const earlyCleanupMarkers = [];
const sseState = {
  scheduleMarkerCleanup(marker) {
    earlyCleanupMarkers.push(marker);
  }
};
const savedMessageChunk = `data: ${JSON.stringify({
  type: "message_saved",
  data: {
    id: "a1",
    role: "assistant",
    characterId: "bob",
    activeSwipeIndex: 2,
    content: "Regenerated.\n<next_speaker>james</next_speaker>"
  }
})}\n\n`;
const sanitizedSavedMessageChunk = sanitizeOutgoingSseChunk(savedMessageChunk, sseState);
assert(
  typeof sanitizedSavedMessageChunk === "string" &&
    sanitizedSavedMessageChunk.includes("Regenerated.") &&
    sanitizedSavedMessageChunk.includes('"type":"content_replace"') &&
    sanitizedSavedMessageChunk.includes('"type":"message_saved"') &&
    !sanitizedSavedMessageChunk.includes("<next_speaker>"),
  "outgoing message_saved SSE strips terminal next speaker marker and replaces live content"
);
assert(sseState.outgoingMarker?.nextSpeakerId === "james", "outgoing message_saved SSE records parsed marker");
assert(earlyCleanupMarkers[0]?.messageId === "a1", "outgoing message_saved SSE schedules early durable cleanup");
assert(earlyCleanupMarkers[0]?.cleanedContent === "Regenerated.", "early durable cleanup receives cleaned message content");
const pendingCleanupState = { markerCleanupTasks: new Set([new Promise((resolve) => setTimeout(resolve, 5))]) };
assert(
  sanitizeOutgoingSseChunkResult(`data: ${JSON.stringify({ type: "done", data: "" })}\n\n`, pendingCleanupState).delayDone === true,
  "done SSE is delayed while marker cleanup is pending"
);
let cleanupSettled = false;
const waitState = {
  markerCleanupTasks: new Set([
    new Promise((resolve) =>
      setTimeout(() => {
        cleanupSettled = true;
        resolve();
      }, 5)
    )
  ])
};
await waitForPendingMarkerCleanup(waitState, 100);
assert(cleanupSettled, "done gate waits for pending marker cleanup");
const contentReplaceChunk = `data: ${JSON.stringify({
  type: "content_replace",
  data: "Regenerated.\n<next_speaker>james</next_speaker>"
})}\n\n`;
assert(
  !String(sanitizeOutgoingSseChunk(contentReplaceChunk, {})).includes("<next_speaker>"),
  "outgoing content_replace SSE strips terminal next speaker marker"
);
const textRewriteState = {};
const textRewriteChunk = `data: ${JSON.stringify({
  type: "text_rewrite",
  data: {
    editedText: "Rewritten.\n<next_speaker>james</next_speaker>",
    changes: [],
    rewriteApplied: true
  }
})}\n\n`;
const sanitizedTextRewriteChunk = sanitizeOutgoingSseChunk(textRewriteChunk, textRewriteState);
assert(
  typeof sanitizedTextRewriteChunk === "string" &&
    sanitizedTextRewriteChunk.includes("Rewritten.") &&
    !sanitizedTextRewriteChunk.includes("<next_speaker>"),
  "outgoing text_rewrite SSE strips terminal next speaker marker"
);
assert(textRewriteState.outgoingMarker?.nextSpeakerId === "james", "outgoing text_rewrite SSE records parsed marker");
const upperCaseSseChunk = `data: ${JSON.stringify({
  type: "message_saved",
  data: {
    id: "a1",
    role: "assistant",
    content: "Regenerated.\n<NEXT_SPEAKER>james</NEXT_SPEAKER>"
  }
})}\n\n`;
assert(
  !String(sanitizeOutgoingSseChunk(upperCaseSseChunk, {})).includes("NEXT_SPEAKER"),
  "outgoing SSE marker scan is case-insensitive"
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
      languageModels: { resolveForRequest() {} }
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
assert(routesSource.includes("languageModels.resolveForRequest({ chatConnectionId })"), "refresh resolves the Agent connection through the capability host");
assert(!routesSource.includes("temperature: 0.2"), "refresh does not override the connection temperature");
assert(!routesSource.includes("maxTokens: 512"), "refresh does not impose the legacy 512-token limit");
assert(!routesSource.includes("topP: 1"), "refresh does not override the connection top-p setting");
assert(routesSource.includes("statePersona?.name"), "refresh transcript can name persona outside candidate list");
assert(routesSource.includes("resolveAvailableCandidateCount(chat, state)"), "view visibility uses available candidates");
assert(routesSource.includes("hidden: availableCandidateCount <= 2"), "two characters plus persona keeps the UI visible");
assert(routesSource.includes("canRefresh: candidates.length > 2"), "refresh remains gated on the included candidate list");
assert(routesSource.includes("view.candidates.length <= 2"), "refresh route skips raw selection until more than two candidates are included");
assert(routesSource.includes("hasVisibleIncomingUserTurn(body)"), "incoming user turns suppress stale next-speaker forcing");
assert(routesSource.includes("hasIncomingUserTurn"), "generation prepare path checks for incoming user turns");
assert(routesSource.includes("installOutgoingMarkerFilter(reply"), "generation prepare path installs SSE marker filter");
assert(routesSource.includes("resolvePromptExcludedCandidate"), "prompt contribution excludes current or latest participant");
assert(routesSource.includes("filterNextSpeakerCandidates(candidates, excludedCandidate?.id)"), "refresh excludes latest participant candidates");
assert(routesSource.includes("parsed.speakerId === generatedParticipant.id"), "saved markers cannot select the generated participant");
assert(routesSource.includes("<excluded_latest_participant_id>"), "refresh prompt names the excluded latest participant id");
assert(routesSource.includes("applyEarlyMarkerCleanup"), "SSE marker detection schedules early durable cleanup");
assert(routesSource.includes("waitForPendingMarkerCleanup(requestState)"), "done SSE waits for marker cleanup before client final refresh");
assert(
  routesSource.indexOf("installOutgoingMarkerFilter(reply") < routesSource.indexOf("if (candidates.length <= 2) return;"),
  "SSE marker filter is installed before candidate-count generation gate"
);
assert(
  routesSource.indexOf("installOutgoingMarkerFilter(reply") < routesSource.indexOf("if (!chat) return;"),
  "SSE marker filter is installed before chat enablement checks"
);
assert(routesSource.includes("if (!groupSortEnabled) return;"), "state update remains gated on active GSO");
assert(!routesSource.includes("manualTrackerAgentTypes"), "misc feature does not write tracker metadata");
const clientSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
assert(clientSource.includes("marinara-capability-group-sort-order"), "client registers package capability element");
assert(clientSource.includes("marinara-capability-props"), "client responds to capability prop changes");
assert(clientSource.includes("registerComposerSlotContribution"), "client uses bridge composer slot contribution");
assert(clientSource.includes("COMPOSER_SLOT_ABOVE_INPUT"), "client targets the bridge above-input composer slot");
assert(!clientSource.includes("declarePackageGeneration"), "refresh does not declare bridge generation activity");
assert(!clientSource.includes("GENERATION_KIND_AGENT"), "refresh is not marked as agent generation activity");
assert(clientSource.includes('RUNTIME_VERSION = "1.0.27"'), "client runtime version matches package version");
assert(!clientSource.includes("findInputContainer"), "client does not discover the composer locally");
assert(!clientSource.includes("MutationObserver"), "client leaves composer remount observation to the bridge");
assert(clientSource.includes('body: "{}"'), "refresh sends an explicit JSON body");
assert(!clientSource.includes('type="checkbox"'), "persona control is not a checkbox");
assert(clientSource.includes('aria-label="Refresh next speaker"'), "refresh control is icon-labeled");
assert(clientSource.includes("options.body !== undefined"), "client only sends JSON content-type when a body exists");
assert(clientSource.includes("view?.hidden !== false"), "client hides the bar when only two candidates are available");
assert(clientSource.includes("view?.canRefresh !== true"), "client disables refresh until more than two candidates are included");
assert(clientSource.includes("width:13px; height:13px"), "client uses smaller GSO icons");
assert(clientSource.includes("bindActiveChat(chatId || \"\")"), "client binds active chat from bridge context");
assert(!clientSource.includes("readCapabilityChatId() || chatId"), "client does not prefer stale capability chat ids");
assert(!clientSource.includes("propsChatIds"), "client does not cache stale capability chat ids");
const buildSource = await fs.readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
assert(buildSource.includes('slots: ["chat-runtime"]'), "manifest declares chat-runtime slot");
assert(buildSource.includes("stripBrowserModuleSyntax"), "client entrypoint bundles browser-safe bridge modules");
assert(buildSource.includes("runtimeDisabled: true"), "feature marker is runtime-disabled");
assert(buildSource.includes('"ui-slots.js"'), "client entrypoint bundles bridge UI slot placement");
assert(!buildSource.includes('"generation-lifecycle.js"'), "client entrypoint does not bundle composer generation lock code");
assert(!buildSource.includes('"generation-stream.js"'), "client entrypoint does not bundle unused generation streaming code");

await selfCheck({
  app: { db: fakeDb() },
  api: {
    runtime: {
      persistence: { getChat() {}, listMessages() {}, updateChatMetadata() {} },
      resources: { listCharacters() {} },
      languageModels: { resolveForRequest() {} }
    }
  }
});

assert(typeof createGroupSortRoutes === "function", "routes export exists");
assert(typeof registerGroupSortHooks === "function", "hooks export exists");
assert(typeof resolveAvailableCandidateCount === "function", "available candidate helper export exists");
assert(typeof resolveGeneratedAssistantTarget === "function", "generation target helper export exists");
assert(typeof resolveSmartSelectorConnectionId === "function", "smart selector connection helper export exists");

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
