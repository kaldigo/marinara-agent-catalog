import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridgeRuntime } from "../src/server/runtime.js";
import { createPromptRegistry } from "../src/server/prompt-registry.js";
import { createAgentResultRegistry } from "../src/server/result-registry.js";
import { createAgentPromptRegistry } from "../src/server/agent-prompt-registry.js";
import { createTrackerDetailFieldRegistry } from "../src/client/tracker-detail-field-registry.js";
import { createTrackerContextRegistry } from "../src/server/tracker-context-registry.js";
import { createGroupSelectorRegistry } from "../src/server/group-selector-registry.js";
import { createTurnHandoffRegistry, __test as turnHandoffTest } from "../src/server/turn-handoff-registry.js";
import { createMessageRegistry } from "../src/server/message-registry.js";
import { createChatRegistry } from "../src/server/chat-registry.js";
import {
  createSpatialDirectiveCompatibilityStreamFilter,
  normalizeAssistantSpatialDirectives,
} from "../src/server/spatial-directive-compat.js";
import {
  patchActiveChatEvents,
  patchAgentSuiteBridge,
  patchChatInputBridge,
  patchChatSettingsBridge,
  patchGenerationControllerEvents,
  patchImpersonateSettingsBridge,
  patchQueryClientBridge,
  patchRoleplayHudBridge,
  patchRoleplayBackgroundBridge,
  patchRoleplayBackgroundStoreBridge,
  patchRoleplayDraftPlaceholderBridge,
  patchSlashCommandListBridge,
  patchTrackerPanelBridge,
  patchTrackerDetailFieldsBridge,
  prepareClientOverlay,
  versionAssetReferences,
} from "../src/server/client-overlay.js";
import { schedulePackageBootstrapRestart, __test as bootstrapRestartTest } from "../src/server/bootstrap-restart.js";
import { installBootstrapFile, requiresBootstrapHandoff } from "../src/server/bootstrap-install.js";
import {
  isServerOverlayEntry,
  prepareServerOverlay,
  serverOverlayProcessState,
  __test as serverOverlayTest,
} from "../src/server/server-overlay.js";
import { MariBridgeUnavailableError } from "../src/shared/contracts.js";

const runtime = createBridgeRuntime({ capabilities: ["runtime.health"] });
assert.throws(
  () => runtime.registerConsumer({ consumerId: "test-consumer", api: { major: 1, minMinor: 0 }, require: [] }),
  (error) => error instanceof MariBridgeUnavailableError && error.reason === "starting",
);
runtime.markReady();
assert.throws(
  () => runtime.registerConsumer({ consumerId: "missing-cap", api: { major: 1, minMinor: 0 }, require: ["nope"] }),
  (error) => error instanceof MariBridgeUnavailableError && error.reason === "capability-missing",
);
assert.throws(
  () => runtime.registerConsumer({ consumerId: "future-api", api: { major: 2, minMinor: 0 }, require: [] }),
  (error) => error instanceof MariBridgeUnavailableError && error.reason === "incompatible-api",
);
let cleaned = 0;
const session = runtime.registerConsumer({
  consumerId: "test-consumer",
  api: { major: 1, minMinor: 0 },
  require: ["runtime.health"],
});
session.addCleanup(() => { cleaned += 1; });
await runtime.markUnhealthy("test failure");
assert.equal(session.signal.aborted, true);
assert.equal(cleaned, 1);
await runtime.dispose();
assert.equal(cleaned, 1);

const hostCalls = [];
const hostRuntime = createBridgeRuntime({
  capabilities: ["host.request"],
  hostRequest: async (ownerId, input) => {
    hostCalls.push({ ownerId, input });
    return { ok: true };
  },
});
hostRuntime.markReady();
const hostSession = hostRuntime.registerConsumer({
  consumerId: "host-test",
  api: { major: 1, minMinor: 0 },
  require: ["host.request"],
});
assert.deepEqual(await hostSession.host.request({ method: "PATCH", path: "/api/test", body: { value: 1 } }), { ok: true });
assert.equal(hostCalls[0].ownerId, "host-test");
await hostSession.close();
await hostRuntime.dispose();

const resultRegistry = createAgentResultRegistry();
const resultCalls = [];
resultRegistry.register("result-owner", {
  id: "notes",
  resultType: "notes_update",
  agentTypes: ["notes"],
  apply: async (scope) => resultCalls.push(scope.result.data),
});
assert.equal(resultRegistry.hasResultType("notes_update"), true);
assert.equal((await resultRegistry.apply({ result: { success: true, type: "notes_update", agentType: "notes", data: { value: 1 } } })).handled, true);
assert.deepEqual(resultCalls, [{ value: 1 }]);
assert.equal((await resultRegistry.apply({ result: { success: true, type: "notes_update", agentType: "other" } })).handled, false);

const agentPromptRegistry = createAgentPromptRegistry();
agentPromptRegistry.register("detail-owner", {
  id: "persona-details",
  agentTypes: ["persona-stats"],
  content: "Include trackerFields.",
});
assert.equal(
  await agentPromptRegistry.extend("persona-stats", "Native contract", {}),
  "Native contract\n\nInclude trackerFields.",
);
assert.equal(await agentPromptRegistry.extend("character-tracker", "Native contract", {}), "Native contract");
const agentPromptRuntime = createBridgeRuntime({ capabilities: ["agent.prompt"], agentPromptRegistry });
agentPromptRuntime.markReady();
const agentPromptSession = agentPromptRuntime.registerConsumer({
  consumerId: "agent-prompt-test",
  api: { major: 1, minMinor: 8 },
  require: ["agent.prompt"],
});
agentPromptSession.agentPrompts.register({
  id: "second-extension",
  agentTypes: ["persona-stats"],
  content: "Keep fixed order.",
});
const extendedAgentPrompt = await agentPromptRuntime.agentPromptHooks.extend("persona-stats", "Native contract", {});
assert.match(extendedAgentPrompt, /Keep fixed order\./u);
assert.match(extendedAgentPrompt, /Include trackerFields\./u);
await agentPromptRuntime.dispose();

const detailRegistry = createTrackerDetailFieldRegistry();
detailRegistry.register("detail-owner", {
  id: "character-details",
  target: "character",
  fields: [
    { name: "Location", icon: "location" },
    { name: "Movement", icon: "movement" },
    { name: "Activity", icon: "activity" },
  ],
});
detailRegistry.register("detail-owner", {
  id: "persona-details",
  target: "persona",
  fields: [
    { name: "Outfit", icon: "shirt" },
    { name: "Location", icon: "location" },
  ],
});
assert.deepEqual(
  detailRegistry.filterCharacterFields({ Activity: "Talking", Other: "Kept", Location: "Bar", Movement: "Still" }),
  [["Other", "Kept"]],
);
assert.deepEqual(
  detailRegistry.filterPersonaFields([{ name: "Location", value: "Bar" }, { name: "Other", value: "Kept" }]),
  [{ name: "Other", value: "Kept" }],
);
assert.deepEqual(detailRegistry.snapshot("character").map((field) => field.name), ["Location", "Movement", "Activity"]);
const detailJsx = {
  jsx(type, props, key) { return { type, props, key }; },
  jsxs(type, props, key) { return { type, props, key }; },
};
let updatedCharacter = null;
let removedCharacterField = null;
const compactDetailRows = detailRegistry.renderCompactCharacterFields({
  jsx: detailJsx,
  native: { Field: "NativeCompactField" },
  character: {
    characterId: "char-1",
    name: "Kira",
    customFields: { Activity: "Talking", Movement: "Still", Location: "Bar" },
  },
  characterIndex: 0,
  onUpdate: (character) => { updatedCharacter = character; },
  onRemove: (name) => { removedCharacterField = name; },
  deleteMode: true,
});
assert.deepEqual(compactDetailRows.map((row) => row.props.children[0].props.accessibleLabel), ["Location", "Movement", "Activity"]);
compactDetailRows[0].props.children[0].props.onSave("Courtyard");
assert.equal(updatedCharacter.customFields.Location, "Courtyard");
compactDetailRows[1].props.children[1].props.onClick();
assert.equal(removedCharacterField, "Movement");
assert.match(compactDetailRows[0].props.children[0].props.lockKey, /^characters\.id:char-1\.custom\.Location\.value$/u);

let personaFieldsUpdate = null;
let personaLocksUpdate = null;
const personaRows = detailRegistry.renderPersonaFields({
  jsx: detailJsx,
  native: { InlineEdit: "NativeInlineEdit" },
  fields: [
    { name: "Location", value: "Hall" },
    { name: "Outfit", value: "Coat" },
    { name: "Other", value: "Kept" },
  ],
  onUpdateFields: (fields) => { personaFieldsUpdate = fields; },
  onUpdateFieldLocks: (update) => { personaLocksUpdate = update({ "player.custom.name:Location.value": true, "other.lock": true }); },
  deleteMode: true,
  fieldLocks: { "player.custom.name:Outfit.value": true },
  lockMode: false,
});
assert.deepEqual(personaRows.map((row) => row.props.children[1].props.placeholder), ["Outfit", "Location"]);
assert.equal(personaRows[0].props.children[1].props.locked, true);
personaRows[1].props.children[2].props.onClick();
assert.deepEqual(personaFieldsUpdate.map((field) => field.name), ["Outfit", "Other"]);
assert.deepEqual(personaLocksUpdate, { "other.lock": true });

const trackerRegistry = createTrackerContextRegistry();
trackerRegistry.register("tracker-owner", {
  id: "notes",
  agentTypes: ["notes"],
  formatCommitted: () => ({ label: "Notes", content: "Remember this." }),
  formatAgentState: () => ({ notes: ["Remember this."] }),
  filterCustomTrackerFields: (_scope, fields) => fields.filter((field) => field.name !== "Owned"),
});
assert.equal(trackerRegistry.hasActive(["notes"]), true);
const trackerParts = [];
trackerRegistry.appendCommittedSections({
  activeAgentIds: ["notes"],
  wrapFormat: "xml",
  wrapContent: (content, label) => `<${label}>${content}</${label}>`,
}, trackerParts);
assert.deepEqual(trackerParts, ["<Notes>Remember this.</Notes>"]);
const trackerSummary = {};
trackerRegistry.appendAgentState({ activeAgentIds: ["notes"] }, trackerSummary);
assert.deepEqual(trackerSummary, { notes: { notes: ["Remember this."] } });
assert.deepEqual(
  trackerRegistry.filterCustomTrackerFields(
    { activeAgentIds: ["notes"] },
    [{ name: "Owned", value: "Package" }, { name: "Other", value: "Native" }],
  ),
  [{ name: "Other", value: "Native" }],
);
assert.deepEqual(
  trackerRegistry.filterCustomTrackerFields(
    { activeAgentIds: ["different-agent"] },
    [{ name: "Owned", value: "Package" }],
  ),
  [{ name: "Owned", value: "Package" }],
);
assert.equal("filterCustomTrackerFields" in trackerRegistry.snapshot()[0], false);

const groupRegistry = createGroupSelectorRegistry();
groupRegistry.register("group-owner", {
  id: "selector",
  agentTypes: ["group-sort-order"],
  select: async () => ["char-2"],
});
assert.deepEqual(
  groupRegistry.resolvePolicy(
    { chatMetadata: { enableAgents: true, activeAgentIds: ["group-sort-order"] } },
    { groupChatMode: "merged", groupResponseOrder: "sequential" },
  ),
  { groupChatMode: "individual", groupResponseOrder: "smart" },
);
assert.deepEqual(
  await groupRegistry.select(
    { chatMetadata: { enableAgents: true, activeAgentIds: ["group-sort-order"] } },
    async () => ["native"],
  ),
  ["char-2"],
);

const turnHandoffRegistry = createTurnHandoffRegistry();
const turnHandoffCalls = [];
turnHandoffRegistry.register("turn-owner", {
  id: "next-participant",
  agentTypes: ["group-sort-order"],
  resolve: async () => ({ id: "char-2", name: "Alice", kind: "character" }),
  validate: async (scope) => scope.participantId === "persona-1"
    ? { id: "persona-1", name: "Player", kind: "persona" }
    : null,
  commit: async (scope) => turnHandoffCalls.push(scope),
  view: async () => ({ status: "known" }),
  update: async (scope) => ({ includePersonaCandidate: scope.patch.includePersonaCandidate }),
  refresh: async () => ({ status: "refreshed" }),
});
const handoffScope = {
  chatMetadata: { enableAgents: true, activeAgentIds: ["group-sort-order"] },
};
assert.deepEqual(
  turnHandoffRegistry.resolvePolicy(handoffScope, { groupChatMode: "merged", groupResponseOrder: "sequential" }),
  { groupChatMode: "individual", groupResponseOrder: "smart" },
);
assert.deepEqual(await turnHandoffRegistry.select(handoffScope, async () => ["native"]), {
  characterIds: ["char-2"],
  participant: { id: "char-2", name: "Alice", kind: "character" },
  participantKind: "character",
  source: "stored",
});
const processedHandoff = await turnHandoffRegistry.processResponse(
  handoffScope,
  "Visible response\n<next_speaker>persona-1</next_speaker>",
);
assert.deepEqual(processedHandoff, {
  ownerId: "turn-owner",
  registrationId: "next-participant",
  content: "Visible response",
  participant: { id: "persona-1", name: "Player", kind: "persona" },
});
await turnHandoffRegistry.commit({ ...handoffScope, messageId: "message-1", swipeIndex: 2 }, processedHandoff);
assert.equal(turnHandoffCalls[0].messageId, "message-1");
assert.equal(turnHandoffCalls[0].swipeIndex, 2);
assert.deepEqual(await turnHandoffRegistry.view(handoffScope), { status: "known" });
assert.deepEqual(
  await turnHandoffRegistry.update({ ...handoffScope, patch: { includePersonaCandidate: false } }),
  { includePersonaCandidate: false },
);
assert.deepEqual(await turnHandoffRegistry.refresh(handoffScope), { status: "refreshed" });
assert.deepEqual(
  turnHandoffTest.extractTerminalMarker("Reply &lt;next_speaker&gt;char-2&lt;/next_speaker&gt;"),
  { participantId: "char-2", content: "Reply" },
);
const markerFilter = turnHandoffTest.createTerminalMarkerStreamFilter();
assert.equal(markerFilter.push("Visible <next_spea"), "Vis");
assert.equal(markerFilter.push("ker>char-2</next_speaker>"), "ible ");
assert.equal(markerFilter.flush(), "");
const escapedMarkerFilter = turnHandoffTest.createTerminalMarkerStreamFilter();
assert.equal(escapedMarkerFilter.push("Visible &lt;next_spea"), "Visibl");
assert.equal(escapedMarkerFilter.push("ker&gt;char-2&lt;/next_speaker&gt;"), "e ");
assert.equal(escapedMarkerFilter.flush(), "");

assert.equal(
  normalizeAssistantSpatialDirectives('The lift opens.\n<spatial_move: destination_id="tower_level_1"/>'),
  'The lift opens.\n[spatial_move: destination_id="tower_level_1"]',
);
assert.equal(
  normalizeAssistantSpatialDirectives("<spatial_discover name='Hidden Room' relation='enter' />"),
  "[spatial_discover: name='Hidden Room' relation='enter']",
);
assert.equal(
  normalizeAssistantSpatialDirectives('<spatial_moveable destination_id="unchanged"/>'),
  '<spatial_moveable destination_id="unchanged"/>',
);
const spatialCompatibilityFilter = createSpatialDirectiveCompatibilityStreamFilter();
assert.equal(spatialCompatibilityFilter.push("The lift opens.\n<spa"), "The lift opens.\n");
assert.equal(spatialCompatibilityFilter.push('tial_move: destination_id="tower_'), "");
assert.equal(
  spatialCompatibilityFilter.push('level_1"/>'),
  '[spatial_move: destination_id="tower_level_1"]',
);
assert.equal(spatialCompatibilityFilter.flush(), "");
const incompleteSpatialCompatibilityFilter = createSpatialDirectiveCompatibilityStreamFilter();
assert.equal(incompleteSpatialCompatibilityFilter.push("Keep <spatial_move:"), "Keep ");
assert.equal(incompleteSpatialCompatibilityFilter.flush(), "<spatial_move:");

const messageRegistry = createMessageRegistry();
const persistedMessages = [];
messageRegistry.register("presence", {
  id: "active-presence",
  prepare: ({ input }) => ({
    extra: {
      ...input.extra,
      hiddenFromAICharacterIds: ["char-2"],
      marinaraPresence: { presentCharacterIds: ["char-1"] },
    },
  }),
  afterPersist: async (event) => persistedMessages.push(event),
});
const preparedMessage = await messageRegistry.prepareCreate({
  chatId: "chat-1",
  role: "user",
  content: "Private turn",
  extra: { submissionId: "submission-1" },
});
assert.deepEqual(preparedMessage.extra, {
  submissionId: "submission-1",
  hiddenFromAICharacterIds: ["char-2"],
  marinaraPresence: { presentCharacterIds: ["char-1"] },
});
await messageRegistry.notifyPersisted({ chatId: "chat-1", messageId: "message-1", kind: "regenerate" });
assert.deepEqual(persistedMessages, [{ chatId: "chat-1", messageId: "message-1", kind: "regenerate" }]);
assert.deepEqual(messageRegistry.snapshot(), [{
  ownerId: "presence",
  id: "active-presence",
  priority: 0,
  callbacks: ["prepare", "afterPersist"],
}]);

const chatRegistry = createChatRegistry();
const changedChats = [];
chatRegistry.register("presence", {
  id: "presence-roster",
  onChanged: async (event) => changedChats.push(event),
});
await chatRegistry.notifyChanged({ chatId: "chat-1", source: "metadata", changedKeys: ["inactiveCharacterIds"] });
assert.equal(changedChats[0].chatId, "chat-1");
assert.deepEqual(changedChats[0].changedKeys, ["inactiveCharacterIds"]);

const persistenceRuntime = createBridgeRuntime({
  capabilities: ["chat.changed", "message.persist", "message.prepare"],
  messageRegistry,
  chatRegistry,
});
persistenceRuntime.markReady();
const persistenceSession = persistenceRuntime.registerConsumer({
  consumerId: "persistence-test",
  api: { major: 1, minMinor: 7 },
  require: ["chat.changed", "message.persist", "message.prepare"],
});
persistenceSession.messages.register({ id: "messages", prepare: () => null, afterPersist: () => {} });
persistenceSession.chats.register({ id: "chats", onChanged: () => {} });
assert.equal(persistenceSession.lifecycle, undefined);
await persistenceSession.close();
await persistenceRuntime.dispose();

const clientSymbol = Symbol.for("marinara.mari-bridge.client.v1");
const customElementDefinitions = new Map();
const clientEventListeners = new Map();
globalThis.addEventListener = (type, listener) => {
  const listeners = clientEventListeners.get(type) ?? new Set();
  listeners.add(listener);
  clientEventListeners.set(type, listeners);
};
function dispatchClientEvent(type, detail) {
  for (const listener of clientEventListeners.get(type) ?? []) listener({ type, detail });
}
globalThis.fetch = async (input) => {
  const spatial = String(input).includes("/api/chats/chat-1/spatial-context");
  const body = spatial
    ? { currentLocationId: "location-fetch", definition: { revision: 5, locations: [] } }
    : {
        status: "ok",
        version: "2.4.4",
        capabilityPackages: {
          packages: [{ id: "mari-bridge", version: "0.2.0", readiness: "ready", ready: true }],
        },
      };
  return {
    ok: true,
    clone() { return { async json() { return body; } }; },
    async json() { return body; },
  };
};
globalThis.HTMLElement = class HTMLElement {
  constructor(classes = []) {
    this.attributes = new Map();
    this.children = [];
    this.classList = { contains: (name) => classes.includes(name) };
    this.dataset = {};
    this.parentElement = null;
    this.style = {};
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
};
const localStorageValues = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key) { return localStorageValues.get(key) ?? null; },
    setItem(key, value) { localStorageValues.set(key, String(value)); },
    removeItem(key) { localStorageValues.delete(key); },
  },
});
globalThis.customElements = {
  get(name) { return customElementDefinitions.get(name); },
  define(name, definition) { customElementDefinitions.set(name, definition); },
};
globalThis.document = {
  documentElement: { dataset: {} },
  createElement(name) {
    const Definition = customElementDefinitions.get(name);
    return Definition ? new Definition() : new HTMLElement();
  },
};
const allNativeClientPatches = [
  "client.active-chat",
  "client.agent-suite-tracker-data",
  "client.command-drafts",
  "client.commands",
  "client.generation-lifecycle",
  "client.impersonate-settings",
  "client.native-agent-settings",
  "client.quick-replies",
  "client.roleplay-background",
  "client.roleplay-hud",
  "client.spatial-context",
  "client.tracker-sections",
  "client.tracker-detail-fields",
];
const trackerDetailRegistrySource = (await fs.readFile(new URL("../src/client/tracker-detail-field-registry.js", import.meta.url), "utf8"))
  .replace(/^export /gmu, "");
const clientSource = `${trackerDetailRegistrySource}\n${(await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8"))
  .replace(/^import .*?;\r?\n/gmu, "")}`
  .replace('["__MARI_BRIDGE_NATIVE_PATCHES__"]', JSON.stringify(allNativeClientPatches));
await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);
const observedSpatialFetch = globalThis.fetch;
assert.equal(globalThis[clientSymbol]?.status, "ready");
assert.equal(globalThis[clientSymbol].implementationVersion, "1.0.38");
assert.equal(globalThis[clientSymbol].capabilities.has("agent-suite.tracker-data"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("chat.background"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("client.bridge-first"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("generation.lifecycle"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("spatial.context"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("ui.agent-settings"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("ui.impersonate-settings"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("ui.tracker-section"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("tracker.detail-fields"), true);
assert.equal(typeof globalThis[clientSymbol].renderNativeTrackerSections, "function");
assert.equal(customElements.get("marinara-capability-mari-bridge"), undefined);
assert.equal(document.documentElement.dataset.mariBridgeClient, "ready");
const hudRoot = new HTMLElement();
const mobileHudGroup = new HTMLElement(["md:hidden"]);
const desktopHudGroup = new HTMLElement(["md:flex"]);
hudRoot.children.push(mobileHudGroup, desktopHudGroup);
globalThis[clientSymbol].mountNativeSlot(hudRoot, "roleplay.hud");
assert.equal(mobileHudGroup.children.length, 1);
assert.equal(desktopHudGroup.children.length, 1);
assert.equal(mobileHudGroup.children[0].style.display, "contents");
assert.equal(desktopHudGroup.children[0].style.display, "contents");
const nativeBackgroundState = {
  chatBackground: null,
  setChatBackground(url) { this.chatBackground = url; },
};
function nativeBackgroundStore(selector) { return selector(nativeBackgroundState); }
nativeBackgroundStore.getState = () => nativeBackgroundState;
dispatchClientEvent("marinara:active-chat", { chatId: "chat-1" });
await new Promise((resolve) => setTimeout(resolve, 0));
let turnHandoffFetches = 0;
globalThis.fetch = async (url) => {
  assert.match(String(url), /\/api\/mari-bridge\/turn-handoff\/chat-1/u);
  turnHandoffFetches += 1;
  return {
    ok: true,
    status: 200,
    async json() {
      if (turnHandoffFetches === 1) {
        return { chatId: "chat-1", hidden: true, status: "initializing", retryAfterMs: 5 };
      }
      return {
        chatId: "chat-1",
        hidden: false,
        status: "known",
        nextParticipant: { id: "char-2", name: "Alice", kind: "character" },
      };
    },
  };
};
await globalThis[clientSymbol].turnHandoff.load();
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(turnHandoffFetches, 2);
assert.equal(globalThis[clientSymbol].turnHandoff.getSnapshot().view.status, "known");
assert.equal(globalThis[clientSymbol].turnHandoff.getSnapshot().view.nextParticipant.id, "char-2");
const backgroundSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "background-test",
  api: { major: 1, minMinor: 0 },
  require: ["chat.background"],
});
assert.equal(backgroundSession.chat.background.set({ chatId: "chat-other", url: "/other.png", blurPx: 3 }), false);
assert.equal(backgroundSession.chat.background.set({ chatId: "chat-1", url: "/location.png", blurPx: 7 }), false);
assert.equal(nativeBackgroundState.chatBackground, null);
assert.equal(globalThis[clientSymbol].bindRoleplayBackgroundStore(nativeBackgroundStore), true);
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(nativeBackgroundState.chatBackground, "/location.png");
assert.deepEqual(globalThis[clientSymbol].resolveBackgroundProps({}, "/location.png", 0), {
  url: "/location.png",
  blurPx: 7,
});
nativeBackgroundState.chatBackground = "/stale-remount.png";
assert.equal(globalThis[clientSymbol].bindRoleplayBackgroundStore(nativeBackgroundStore), true);
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(nativeBackgroundState.chatBackground, "/location.png");
await backgroundSession.close();
const queryListeners = new Set();
const spatialQuery = {
  queryKey: ["spatial-context", "chat-1"],
  state: { data: { currentLocationId: "location-a", definition: { revision: 4, locations: [] } } },
};
const queryClient = {
  getQueryCache() {
    return {
      subscribe(listener) { queryListeners.add(listener); return () => queryListeners.delete(listener); },
      findAll() { return [spatialQuery]; },
    };
  },
};
assert.equal(globalThis[clientSymbol].bindQueryClient(queryClient), true);
const spatialSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "spatial-test",
  api: { major: 1, minMinor: 4 },
  require: ["spatial.context"],
});
assert.equal(spatialSession.chat.spatial.getSnapshot("chat-1").data.currentLocationId, "location-a");
const spatialSnapshots = [];
spatialSession.chat.spatial.subscribe((snapshot) => spatialSnapshots.push(snapshot), { emitCurrent: false });
spatialQuery.state.data = { ...spatialQuery.state.data, currentLocationId: "location-b" };
for (const listener of queryListeners) listener({ type: "updated", action: { type: "success" }, query: spatialQuery });
assert.equal(spatialSnapshots.at(-1).data.currentLocationId, "location-b");
spatialQuery.state.data = { ...spatialQuery.state.data, currentLocationId: "location-c" };
for (const listener of queryListeners) listener({ type: "updated", action: { type: "fetch" }, query: spatialQuery });
assert.equal(spatialSnapshots.at(-1).data.currentLocationId, "location-b");
await observedSpatialFetch("/api/chats/chat-1/spatial-context", { method: "PUT" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(spatialSnapshots.at(-1).data.currentLocationId, "location-fetch");
spatialQuery.queryKey = ["spatial-context", "chat-1", "game-map-reconciliation"];
for (const listener of queryListeners) listener({ type: "updated", action: { type: "success" }, query: spatialQuery });
assert.equal(spatialSnapshots.at(-1).data.currentLocationId, "location-fetch");
await spatialSession.close();
const clientSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "client-test",
  api: { major: 1, minMinor: 0 },
  require: ["generation.lifecycle"],
});
let agentSuiteSaveDetail = null;
const agentSuiteSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "agent-suite-test",
  api: { major: 1, minMinor: 0 },
  require: ["agent-suite.tracker-data"],
});
agentSuiteSession.agentSuite.registerTrackerData({
  agentId: "agent-suite-test",
  label: "Agent Suite Test",
  getValue() { return []; },
  buildPatch() { return {}; },
  async onSaved(detail) { agentSuiteSaveDetail = detail; },
});
await globalThis[clientSymbol].notifyAgentSuiteTrackerSaved("agent-suite-test", { chatId: "chat-1" });
assert.deepEqual(agentSuiteSaveDetail, { agentId: "agent-suite-test", chatId: "chat-1" });
const generationSnapshots = [];
clientSession.generation.subscribe((snapshot) => generationSnapshots.push(snapshot));
dispatchClientEvent("marinara:mari-phase", { chatId: "chat-1", phase: "thinking" });
assert.equal(clientSession.generation.getSnapshot().mainActive, true);
dispatchClientEvent("marinara:generation-complete", { chatId: "chat-1" });
assert.equal(clientSession.generation.getSnapshot().mainActive, false);
assert.equal(generationSnapshots.length, 3);
await clientSession.close();
const featureSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "feature-test",
  api: { major: 1, minMinor: 0 },
  require: ["agent-suite.tracker-data", "commands", "quick-replies.input-macro", "tracker.detail-fields", "ui.agent-settings", "ui.tracker-section"],
});
featureSession.tracker.registerDetailFields({
  id: "ordered-details",
  target: "character",
  fields: [{ name: "Location", icon: "location" }, { name: "Activity", icon: "activity" }],
});
assert.deepEqual(
  globalThis[clientSymbol].filterCharacterTrackerDetailFields({ Activity: "Talking", Other: "Kept", Location: "Bar" }),
  [["Other", "Kept"]],
);
assert.equal(
  globalThis[clientSymbol].hasCharacterTrackerDetailFields({ Activity: "Talking", Location: "Bar" }),
  true,
);
assert.equal(globalThis[clientSymbol].hasCharacterTrackerDetailFields({ Other: "Kept" }), false);
featureSession.commands.register({
  id: "probe",
  commands: ["/probe"],
  aliases: ["/probe_alias"],
  description: "Probe the bridge command registry",
  usage: "/probe <value>",
  handler: ({ tokens }) => ({ feedback: tokens.join("|") }),
});
const bridgeCommand = globalThis[clientSymbol].matchCommand('/probe "two words"', { mode: "roleplay", chatId: "chat-1" });
assert.equal((await bridgeCommand.command.execute(bridgeCommand.args, {})).feedback, "two words");
assert.equal(globalThis[clientSymbol].matchCommand("/probe_alias value", { mode: "roleplay" })?.command.id, "feature-test:probe");
assert.deepEqual(globalThis[clientSymbol].listCommands({ mode: "roleplay" }), [{
  name: "probe",
  aliases: ["probe_alias"],
  description: "Probe the bridge command registry",
  usage: "/probe <value>",
  local: true,
}]);
assert.equal(globalThis[clientSymbol].resolveQuickReply("/probe {{input}} + {{input}}", "draft"), "/probe draft + draft");
assert.equal(globalThis[clientSymbol].resolveQuickReply("unchanged", "draft"), "unchanged");
featureSession.ui.register({ id: "settings", slot: "agent.settings", agentIds: ["feature-test"], view: "settings" });
assert.equal(globalThis[clientSymbol].ui.list("agent.settings", { agentId: "feature-test" })[0].ownerId, "feature-test");
let trackerUiPublishes = 0;
const unsubscribeTrackerUi = globalThis[clientSymbol].ui.subscribe(() => { trackerUiPublishes += 1; });
featureSession.ui.register({
  id: "tracker",
  slot: "tracker.section",
  agentIds: ["feature-test"],
  title: "Feature Test",
  icon: "notebook-pen",
  rerunAgentId: "feature-test",
  view: "tracker-body",
});
assert.equal(globalThis[clientSymbol].ui.list("tracker.section")[0].title, "Feature Test");
assert.equal(trackerUiPublishes, 1);
const fakeJsx = {
  jsx(type, props, key) {
    return { type, props, key };
  },
  jsxs(type, props, key) {
    return { type, props, key };
  },
};
featureSession.tracker.registerDetailFields({
  id: "ordered-persona-details",
  target: "persona",
  fields: [{ name: "Outfit", icon: "shirt" }],
});
const renderedPersonaDetails = globalThis[clientSymbol].renderPersonaTrackerDetailFields({
  jsx: fakeJsx,
  native: { InlineEdit() {} },
  fields: [{ name: "Outfit", value: "Coat" }],
  onUpdateFields() {},
});
assert.equal(renderedPersonaDetails.length, 1);
assert.match(renderedPersonaDetails[0].props.className, /rounded-\[5px\].*border.*bg-\[image:var\(--tracker-profile-field-material\)\]/u);
const nativeImpersonateSetting = globalThis[clientSymbol].renderNativeImpersonateSetting({
  react: { useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); } },
  jsx: fakeJsx,
  native: { SettingsSwitch() {} },
  context: { presetId: "preset-1" },
});
const nativeImpersonateSwitch = nativeImpersonateSetting.type(nativeImpersonateSetting.props);
assert.equal(nativeImpersonateSwitch.props.label, "Preset handles impersonation");
assert.equal(nativeImpersonateSwitch.props.checked, false);
assert.equal(nativeImpersonateSwitch.props.disabled, false);
nativeImpersonateSwitch.props.onChange(true);
assert.equal(localStorageValues.get("mari-bridge:impersonate-preset-owns-instructions"), "true");
localStorageValues.set("marinara-engine-ui", JSON.stringify({
  state: { impersonatePresetId: "preset-1", impersonatePromptTemplate: "Native impersonate prompt" },
}));
const nativeTrackerOrder = globalThis[clientSymbol].renderNativeTrackerSections({
  react: { useSyncExternalStore() {} },
  jsx: fakeJsx,
  native: { SectionHeader() {}, SectionIconButton() {} },
  sections: ["world", "custom"],
  renderSection: (section) => section,
  context: {},
});
assert.deepEqual([nativeTrackerOrder[0], nativeTrackerOrder[2]], ["world", "custom"]);
assert.equal(nativeTrackerOrder[1].key, "mari-bridge:tracker-sections");
featureSession.agentSuite.registerTrackerData({
  agentId: "feature-test",
  label: "Feature Test Data",
  description: "Package-owned tracker data",
  getValue: (gameState) => gameState.featureTest ?? [],
  buildPatch: (_gameState, parsed) => Array.isArray(parsed) ? { featureTest: parsed } : { error: "Must be an array" },
});
const featureTrackerSlice = globalThis[clientSymbol].resolveAgentSuiteTrackerSlice("feature-test");
assert.equal(featureTrackerSlice.label, "Feature Test Data");
assert.deepEqual(featureTrackerSlice.getValue({ featureTest: [1] }), [1]);
assert.deepEqual(featureTrackerSlice.buildPatch({}, [2]), { featureTest: [2] });
await featureSession.close();
assert.equal(trackerUiPublishes, 3);
assert.equal(globalThis[clientSymbol].resolveAgentSuiteTrackerSlice("feature-test"), undefined);
unsubscribeTrackerUi();
let expectedPresetOwnsInstructions = true;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/generate/dryRun");
  const requestBody = JSON.parse(String(options?.body ?? "{}"));
  if (requestBody.impersonate === true) {
    assert.equal(requestBody.impersonatePresetOwnsInstructions, expectedPresetOwnsInstructions);
    if (expectedPresetOwnsInstructions) assert.equal(requestBody.impersonatePresetId, "preset-1");
  }
  const events = requestBody.includeReasoning === true
    ? [
        'data: {"type":"dryrun_started","data":{"runId":"run-reasoning"}}\n\n',
        'data: {"type":"thinking","data":"Because"}\n\n',
        'data: {"type":"token","data":"Answer"}\n\n',
        'data: {"type":"result","data":{"content":"Answer","reasoning":"Because"}}\n\n',
        'data: {"type":"done"}\n\n',
      ]
    : requestBody.impersonateContinuation
      ? [
          'data: {"type":"dryrun_started","data":{"runId":"run-continuation"}}\n\n',
          'data: {"type":"token","data":" world"}\n\n',
          'data: {"type":"result","data":{"content":" world","continuation":" world"}}\n\n',
          'data: {"type":"done"}\n\n',
        ]
      : [
          'data: {"type":"dryrun_started","data":{"runId":"run-1"}}\n\n',
          'data: {"type":"token","data":"Hello"}\n\n',
          'data: {"type":"token","data":" world"}\n\n',
          'data: {"type":"result","data":{"content":"Hello world"}}\n\n',
          'data: {"type":"done"}\n\n',
        ];
  return new Response(
    events.join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
};
const draftSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "draft-test",
  api: { major: 1, minMinor: 0 },
  require: ["generation.draft"],
});
const draftUpdates = [];
const activeDraft = draftSession.drafts.generate({
    chatId: "chat-1",
    body: { impersonate: true },
    onUpdate: (content) => draftUpdates.push(content),
  });
assert.equal(globalThis[clientSymbol].isDraftActive("chat-1"), true);
assert.equal(await activeDraft, "Hello world");
assert.equal(globalThis[clientSymbol].isDraftActive("chat-1"), false);
assert.equal(draftUpdates.at(-1), "Hello world");
assert.deepEqual(
  await draftSession.drafts.generate({
    chatId: "chat-1",
    body: { impersonate: true, impersonateContinuation: "Hello" },
    output: "continuation",
    returnDetails: true,
  }),
  { content: " world", continuation: " world", reasoning: "", runId: "run-continuation" },
);
nativeImpersonateSwitch.props.onChange(false);
expectedPresetOwnsInstructions = false;
assert.equal(await draftSession.drafts.generate({
  chatId: "chat-1",
  body: { impersonate: true, impersonateContinuation: "Hello" },
  output: "continuation",
}), " world");
nativeImpersonateSwitch.props.onChange(true);
localStorageValues.set("marinara-engine-ui", JSON.stringify({ state: { impersonatePresetId: null } }));
assert.equal(await draftSession.drafts.generate({ chatId: "chat-1", body: { impersonate: true } }), "Hello world");
const reasoningUpdates = [];
assert.deepEqual(
  await draftSession.drafts.generate({
    chatId: "chat-1",
    body: { includeReasoning: true },
    returnDetails: true,
    onReasoning: (reasoning) => reasoningUpdates.push(reasoning),
  }),
  { content: "Answer", continuation: "Answer", reasoning: "Because", runId: "run-reasoning" },
);
assert.equal(reasoningUpdates.at(-1), "Because");
assert.equal(draftSession.drafts.getSnapshot("chat-1").activeCount, 0);
await draftSession.close();
delete globalThis[clientSymbol];

const compiledClientFixture = 'const Qn="marinara-active-chat-id";function setChat(t){try{t?localStorage.setItem(Qn,t):localStorage.removeItem(Qn)}catch{}}';
const patchedClientFixture = patchActiveChatEvents(compiledClientFixture);
assert.match(patchedClientFixture, /marinara:active-chat/u);
assert.throws(() => patchActiveChatEvents("const nope = true"), /expected one storage key/u);
const generationFixture = "setAbortController:(t,a)=>e(o=>{const r=new Map(o.abortControllers);return a?r.set(t,a):r.delete(t),{abortControllers:r}})";
const patchedGenerationFixture = patchGenerationControllerEvents(generationFixture);
assert.match(patchedGenerationFixture, /marinara:generation-controller/u);
const currentGenerationFixture = "setAbortController:(t,a)=>e(o=>{const r=new Map(o.abortControllers);if(!a)return r.delete(t),{abortControllers:r};r.set(t,a);const i=new Set(o.backgroundIllustrationChatIds);return i.delete(t),{abortControllers:r,backgroundIllustrationChatIds:i}})";
const patchedCurrentGenerationFixture = patchGenerationControllerEvents(currentGenerationFixture);
assert.match(patchedCurrentGenerationFixture, /marinara:generation-controller/u);
assert.match(patchedCurrentGenerationFixture, /backgroundIllustrationChatIds/u);
assert.throws(() => patchGenerationControllerEvents("const nope = true"), /expected one store action/u);
const chatInputFixture = [
  'const first=match(raw,{mode:"roleplay",availableCapabilityIds:ids});if(first){const ctx=build();if(!ctx)return;const submitted=field.current?.value??"",height=field.current?.style.height??"auto",attachments=list,completions=items;field.current&&(field.current.value="",field.current.style.height="auto"),sync("");clear(chat);try{const result=await first.command.execute(first.args,ctx);result.feedback&&feedback(result.feedback)}catch(error){const active=store.getState().activeChatId,current=field.current?.value??"",restore=active===chat&&current.length===0;submitted&&(restore||active!==chat)&&setDraft(chat,submitted)}}',
  'const second=match(line,{mode:"roleplay",availableCapabilityIds:ids});',
  'button={onClick:streaming?()=>store.getState().stopGeneration(chat??void 0):send};',
  'handler=react.useCallback(async content=>{const field=ref.current;!field||busy||(field.value=content,resize(field),sync(content),await send())},[]);',
  'react.jsxs("div",{className:"mari-chat-input chat-input-container px-3 pb-3",children:[nativeChild]);',
  'description:"Send a saved custom quick reply"',
  'const localized="clearOrSendAttachmentsBeforeUsingQuickImpersonate";',
].join("");
const patchedChatInput = patchChatInputBridge(chatInputFixture);
assert.equal((patchedChatInput.match(/matchCommand/gu) ?? []).length, 2);
assert.equal((patchedChatInput.match(/resolveQuickReply/gu) ?? []).length, 1);
assert.equal((patchedChatInput.match(/composer\.above-input/gu) ?? []).length, 1);
assert.equal((patchedChatInput.match(/setDraft:mariBridgeValue/gu) ?? []).length, 1);
assert.equal((patchedChatInput.match(/setDraftGenerating:mariBridgeGenerating/gu) ?? []).length, 1);
assert.match(patchedChatInput, /const mariBridgeDraftText=String/u);
assert.equal((patchedChatInput.match(/stopDraft\(chat\)/gu) ?? []).length, 1);
assert.doesNotMatch(patchedChatInput, /querySelector/u);
assert.match(patchedChatInput, /const mariBridgeTextarea=field\.current/u);
assert.match(patchedChatInput, /dispatchEvent\(new Event\("input"/u);
const slashCommandListFixture = 'const native=[{name:"help",description:"Show available slash commands"}];function available(item,ctx){return true}function games(value){return[]}function list(ctx={}){return[...native,...games(ctx.conversationGames)].filter(item=>available(item,ctx))}';
const patchedSlashCommandList = patchSlashCommandListBridge(slashCommandListFixture);
assert.match(patchedSlashCommandList, /listCommands\(ctx\)/u);
assert.throws(() => patchSlashCommandListBridge('const marker="Show available slash commands"'), /expected one registry builder/u);
assert.equal(
  versionAssetReferences(
    'import("./ChatRoleplaySurface-abc.js");import("./vendor.js");',
    ["ChatRoleplaySurface-abc.js", "vendor.js"],
    "overlay123",
  ),
  'import("./ChatRoleplaySurface-abc.js?mariBridge=overlay123");import("./vendor.js?mariBridge=overlay123");',
);
assert.equal(
  versionAssetReferences("vendor.js vendor.js.map", ["vendor.js", "vendor.js.map"], "onepass"),
  "vendor.js?mariBridge=onepass vendor.js.map?mariBridge=onepass",
);
const chatSettingsFixture = [
  'react.jsxs("div",{"data-chat-agent-entry":agent.id,className:"one",children:[first]});',
  'react.jsxs("div",{"data-chat-agent-entry":other.id,className:"two",children:[second]});',
].join("");
const patchedChatSettings = patchChatSettingsBridge(chatSettingsFixture);
assert.equal((patchedChatSettings.match(/marinara-mari-bridge-agent-settings/gu) ?? []).length, 2);
assert.match(patchedChatSettings, /"agent-id":agent\.id/u);
const impersonateSettingsFixture = [
  'import{r as react,j as jsx}from"./vendor-react-test.js";',
  'function Impersonate(){const first=1,preset=store(state=>state.impersonatePresetId);return jsx.jsxs("div",{children:[jsx.jsx(SettingsSwitch,{label:t("ui.chatSettings.impersonatesection.skipAgents"),checked:false}),jsx.jsx(SettingsSwitch,{label:t("ui.chatSettings.impersonatesection.useCyoaAsDirection"),checked:false})]})}',
].join("");
const patchedImpersonateSettings = patchImpersonateSettingsBridge(impersonateSettingsFixture);
assert.match(patchedImpersonateSettings, /renderNativeImpersonateSetting/u);
assert.match(patchedImpersonateSettings, /SettingsSwitch:SettingsSwitch/u);
assert.match(patchedImpersonateSettings, /presetId:preset/u);
const agentSuiteFixture = [
  'import{r as react}from"./vendor-react-test.js";',
  'const slices={};',
  'function AgentSuite({chat:chat,open:open,onClose:close,onCloseGuardChange:guard,agents:agents}){const selected=agents[0]??null,isTracker=!!selected&&!!slices[selected.id],query=["agent-suite","game-state",chat.id],refresh=async()=>{},save=react.useCallback(async(agentId,text)=>{const slice=slices[agentId];if(!slice)throw new Error("No tracker snapshot to update");slice.buildPatch({},JSON.parse(text));await refresh()},[]),trackerSlice=selected?slices[selected.id]:void 0;return "ui.chat.agentsuitemodal.trackerData"}',
].join("");
const patchedAgentSuite = patchAgentSuiteBridge(agentSuiteFixture);
assert.equal((patchedAgentSuite.match(/useAgentSuiteTrackerData/gu) ?? []).length, 1);
assert.equal((patchedAgentSuite.match(/resolveAgentSuiteTrackerSlice/gu) ?? []).length, 3);
assert.equal((patchedAgentSuite.match(/notifyAgentSuiteTrackerSaved/gu) ?? []).length, 1);
assert.throws(() => patchAgentSuiteBridge('const value=["agent-suite","game-state"];const error="No tracker snapshot to update";const label="ui.chat.agentsuitemodal.trackerData";'), /expected one modal component/u);
const trackerPanelFixture = [
  'import{r as react,j as jsx}from"./vendor-react-test.js";',
  'import{S as SectionHeader,L as SectionIconButton,f as ReadabilityVeil,E as EmptySection}from"./world-custom-field-icons-test.js";',
  'function TrackerSectionList({activeChatId:chat,enabledAgentTypes:enabled,orderedTrackerSections:sections,beforeCustomSections:beforeCustom,afterCustomSections:afterCustom,deleteMode:deleting,addMode:adding}){const{rerunTracker:rerun,trackerRetryBusy:busy}=useRerun();const renderSection=section=>section;return jsx.jsxs(jsx.Fragment,{children:[jsx.jsx("input",{type:"file",accept:"image/*"}),sections.map(section=>jsx.jsxs("div",{className:"contents",children:[section==="custom"?beforeCustom:null,renderSection(section)]},section)),sections.includes("custom")?null:beforeCustom,afterCustom]})}',
  'function TrackerDataSidebar(){const[editMode,setEditMode]=react.useState(null),nativePackages=[],hasFixed=sections.length>0||nativePackages.length>0;return jsx.jsxs("section",{"data-component":"TrackerDataSidebar",children:[jsx.jsx(Header,{activeEditMode:editMode,onSetEditMode:setEditMode}),gameState&&(sections.length>0||nativePackages.length>0)?jsx.jsx(Boundary,{children:jsx.jsx(TrackerSectionList,{activeChatId:chat,enabledAgentTypes:enabled,orderedTrackerSections:sections,beforeCustomSections:chat?nativePackages.map(renderPackage):null,afterCustomSections:chat?nativePackages.map(renderPackage):null,deleteMode:deleting,addMode:adding})}):null,chat?hasFixed?null:jsx.jsx(EmptySection,{children:t("ui.trackerPanel.trackerdatasidebar.noEnabledTrackerPanels")}):null]})}',
].join("");
const patchedTrackerPanel = patchTrackerPanelBridge(trackerPanelFixture);
assert.match(patchedTrackerPanel, /renderNativeTrackerSections/u);
assert.match(patchedTrackerPanel, /mariBridgeEditMode:editMode/u);
assert.match(patchedTrackerPanel, /mariBridgeEditMode:mariBridgeEditMode,mariBridgeEmptyLabel:mariBridgeEmptyLabel,deleteMode:deleting/u);
assert.match(patchedTrackerPanel, /beforeCustomSections:chat\?nativePackages\.map\(renderPackage\):null/u);
assert.match(patchedTrackerPanel, /section==="custom"\?\[beforeCustom,globalThis/u);
assert.match(patchedTrackerPanel, /SectionHeader:SectionHeader/u);
assert.match(patchedTrackerPanel, /SectionIconButton:SectionIconButton/u);
assert.match(patchedTrackerPanel, /EmptySection:EmptySection/u);
assert.match(patchedTrackerPanel, /gameState&&\(sections\.length>0\|\|nativePackages\.length>0\|\|globalThis/u);
assert.equal(
  patchTrackerPanelBridge('const selector = \'[data-component="TrackerDataSidebarDesktop.right"]\';'),
  null,
);
const trackerDetailFixture = [
  'const trackerDetailMarker="ui.trackerPanel.charactertrackercard.outfit";',
  'function compact(){k=Object.entries(e.customFields??{}).map(([R,Z])=>[R,Z,At(Z)]);U=v.length>0||k.length>0||b,H=U;onToggleHidden:()=>O("outfit")})]})}',
  'function gs({character:e,onUpdate:a,sizeProfile:t,characterIndex:o}){const s=[{hidden:u("outfit"),value:e.outfit}].filter(d=>!d.hidden||i);return r.jsx("div",{children:s.map(d=>r.jsx(ps,{icon:d.icon,accessibleLabel:d.accessibleLabel,value:d.value,placeholder:d.placeholder,onSave:d.onSave,sizeProfile:t,fieldKey:d.key,lockKey:c(d.key),hidden:d.hidden,hideMode:i,onToggleHidden:()=>b(d.key)},d.key))})}',
  'function featured(){I=Object.entries(e.customFields??{}).map(([F,Q])=>[F,Q,At(Q)]);r.jsx(gs,{character:e,onUpdate:d,sizeProfile:f,characterIndex:g})}',
  'function Qi({persona:e,status:a,spriteExpression:t,trackerPanelSide:o,statDisplayMode:n,resolveStatIcon:i,personaStats:l,action:f,onSaveStatus:c,onUpdatePersonaStats:u,onAddPersonaStat:b,deleteMode:s,addMode:d,queuePersonaPortraitSave:p,flushPersonaPortraitSave:g,collapsed:x=!1,onToggleCollapsed:_}){{fieldLocks:T,lockMode:w,onToggleFieldLock:C}=Ce();r.jsx("div",{className:m(Gi,Pt,qe[M],Qt[M]),children:Y()})}',
  'function Wl({activeChatId:e,activePersona:a,characterSpriteLookup:t,characterTrackerConfig:o,characterTrackerSettings:n,currentGameState:i,enabledAgentTypes:l,expressionSpritesEnabled:f,featuredCharacterCardKeys:c,flushPatch:u,gameStateRefreshing:b,orderedTrackerSections:s,patchField:d,patchPlayerStats:p,patchPlayerStatsMany:g,resolveSpriteCharacterId:x,spriteExpressions:_,trackerPanelCollapsedSections:A,trackerPanelSide:T,trackerPanelSizeProfile:w,trackerPanelThoughtBubbleDisplay:C,trackerStatDisplayMode:k,trackerPanelDockedThoughtsAlwaysVisible:v,trackerTemperatureUnit:j,toggleTrackerPanelSectionCollapsed:y,deleteMode:E,addMode:L,queuePersonaPortraitSave:O,flushPersonaPortraitSave:N,resolveStatIcon:P,beforeCustomSections:B,afterCustomSections:W}){const X=va(),mariBridgeFixture=(V=Array.isArray(D?.customTrackerFields)?D.customTrackerFields:[],{onAddPersonaStat:ae,deleteMode:E,addMode:L,queuePersonaPortraitSave:O,flushPersonaPortraitSave:N})}',
].join("");
const patchedTrackerDetails = patchTrackerDetailFieldsBridge(trackerDetailFixture);
assert.match(patchedTrackerDetails, /renderCompactCharacterTrackerDetailFields/u);
assert.match(patchedTrackerDetails, /hasCharacterTrackerDetailFields\(e\.customFields\)/u);
assert.match(patchedTrackerDetails, /resolveFeaturedCharacterTrackerDetailFields/u);
assert.match(patchedTrackerDetails, /d\.mariBridgeOnRemove&&mariBridgeDeleteMode/u);
assert.match(patchedTrackerDetails, /relative grid h-full min-h-0 grid-rows-\[minmax\(0,1fr\)\] overflow-hidden/u);
assert.match(patchedTrackerDetails, /fieldKey:d\.mariBridgeOnRemove\?"outfit":d\.key/u);
assert.match(patchedTrackerDetails, /renderPersonaTrackerDetailFields/u);
assert.match(patchedTrackerDetails, /a\|\|w\|\|!le\(T,zr\(\)\)\?Y\(\):null/u);
const roleplayHudFixture = 'react.jsxs("div",{className:cn("rpg-hud","flex items-center"),children:[]})';
const patchedRoleplayHud = patchRoleplayHudBridge(roleplayHudFixture);
assert.match(patchedRoleplayHud, /mountNativeSlot\(Z,"roleplay\.hud"\)/u);
const queryClientFixture = 'Object.assign(globalThis,{React:react,ReactDOM:reactDom});const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:3e4,retry:1,refetchOnWindowFocus:!1}}});';
const patchedQueryClient = patchQueryClientBridge(queryClientFixture);
assert.match(patchedQueryClient, /bindQueryClient\(mariBridgeQueryClient\)/u);
assert.equal(patchQueryClientBridge('const queryClient = true;'), null);
const roleplayBackgroundStoreFixture = 'const component="chat-area",chat=store(state=>state.activeChatId),illustrated=store(state=>chat?state.backgroundIllustrationChatIds.has(chat):!1),bg=uiStore(state=>state.chatBackground),weather=uiStore(state=>state.weatherEffects);';
const roleplayBackgroundFixture = 'react.jsx(Fade,{url:bg,blurPx:blur});const later=enabled&&metadata.enableAgents&&active;const marker="rpg-chat-area mari-chat-area";';
const roleplayDraftPlaceholderFixture = 'const component="chat-area";const chat=store(state=>state.activeChatId),streamingChat=store(state=>state.streamingChatId),streaming=store(state=>state.isStreaming)&&streamingChat===chat,illustrated=store(state=>chat?state.backgroundIllustrationChatIds.has(chat):!1),textStreaming=streaming&&!illustrated,pageActive=true;';
const patchedRoleplayBackgroundStore = patchRoleplayBackgroundStoreBridge(roleplayBackgroundStoreFixture);
const patchedRoleplayBackground = patchRoleplayBackgroundBridge(roleplayBackgroundFixture);
const patchedRoleplayDraftPlaceholder = patchRoleplayDraftPlaceholderBridge(roleplayDraftPlaceholderFixture);
assert.match(patchedRoleplayBackgroundStore, /bindRoleplayBackgroundStore\(uiStore\)/u);
assert.match(patchedRoleplayBackground, /resolveBackgroundProps\(metadata,bg,blur\)/u);
assert.match(patchedRoleplayDraftPlaceholder, /isDraftActive\(chat\)/u);
assert.equal(patchRoleplayBackgroundStoreBridge('const label="chat-area";'), null);
assert.equal(patchRoleplayDraftPlaceholderBridge('const label="chat-area";'), null);
const clientOverlaySource = await fs.readFile(new URL("../src/server/client-overlay.js", import.meta.url), "utf8");
assert.match(clientOverlaySource, /bridgeClientRuntime/u);
assert.doesNotMatch(clientOverlaySource, /client\?preload=1/u);
assert.doesNotMatch(clientOverlaySource, /mari-bridge-bootstrap\.js/u);

const clientOverlayFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mari-bridge-client-overlay-"));
const nativeClientRoot = path.join(clientOverlayFixtureRoot, "native");
const nativeAssetsRoot = path.join(nativeClientRoot, "assets");
await fs.mkdir(nativeAssetsRoot, { recursive: true });
await fs.writeFile(
  path.join(nativeClientRoot, "index.html"),
  '<!doctype html><script type="module" crossorigin src="/assets/index-main.js"></script>\n',
);
await fs.writeFile(path.join(nativeAssetsRoot, "index-main.js"), `${compiledClientFixture}\n${currentGenerationFixture}\n`);
await fs.writeFile(path.join(nativeAssetsRoot, "chat-input-one.js"), chatInputFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "chat-input-two.js"), chatInputFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "slash-commands.js"), slashCommandListFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "chat-settings.js"), chatSettingsFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "impersonate-settings.js"), impersonateSettingsFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "agent-suite.js"), agentSuiteFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "tracker-panel.js"), trackerPanelFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "tracker-details.js"), trackerDetailFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "roleplay-hud.js"), roleplayHudFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "query-client.js"), queryClientFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "roleplay-background-store.js"), roleplayBackgroundStoreFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "roleplay-background.js"), roleplayBackgroundFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "roleplay-draft-placeholder.js"), roleplayDraftPlaceholderFixture);
const preparedClientOverlay = await prepareClientOverlay({
  dataDir: path.join(clientOverlayFixtureRoot, "data"),
  sourceRoot: nativeClientRoot,
  engineVersion: "2.4.4",
});
const preparedOverlayIndex = await fs.readFile(path.join(preparedClientOverlay.root, "index.html"), "utf8");
const preparedOverlayMain = await fs.readFile(path.join(preparedClientOverlay.root, "assets", "index-main.js"), "utf8");
const preparedOverlayAssets = await fs.readdir(path.join(preparedClientOverlay.root, "assets"));
const preparedRuntimeName = preparedOverlayAssets.find((name) => /^mari-bridge-runtime-[a-f0-9]{16}\.js$/u.test(name));
assert.ok(preparedRuntimeName);
const preparedOverlayRuntime = await fs.readFile(
  path.join(preparedClientOverlay.root, "assets", preparedRuntimeName),
  "utf8",
);
assert.match(preparedOverlayIndex, /index-main\.js\?mariBridge=[a-f0-9]{16}/u);
assert.doesNotMatch(preparedOverlayIndex, /mari-bridge-bootstrap/u);
assert.match(preparedOverlayMain, /^import "\.\/mari-bridge-runtime-[a-f0-9]{16}\.js\?mariBridge=[a-f0-9]{16}";/u);
assert.doesNotMatch(preparedOverlayMain, /const API_VERSION/u);
assert.match(preparedOverlayRuntime, /implementationVersion: "1\.0\.38"/u);
assert.doesNotMatch(preparedOverlayRuntime, /__MARI_BRIDGE_NATIVE_PATCHES__/u);
assert.deepEqual(preparedClientOverlay.failedPatches, []);
assert.doesNotMatch(preparedOverlayRuntime, /\/api\/health/u);
assert.match(preparedOverlayMain, /window\.dispatchEvent\(new CustomEvent\("marinara:active-chat"/u);

const degradedNativeRoot = path.join(clientOverlayFixtureRoot, "native-degraded");
await fs.cp(nativeClientRoot, degradedNativeRoot, { recursive: true });
await fs.writeFile(
  path.join(degradedNativeRoot, "assets", "roleplay-background.js"),
  'const marker="rpg-chat-area mari-chat-area";const changedNativeShape=true;',
);
const degradedClientOverlay = await prepareClientOverlay({
  dataDir: path.join(clientOverlayFixtureRoot, "data-degraded"),
  sourceRoot: degradedNativeRoot,
  engineVersion: "2.4.4",
});
assert.equal(degradedClientOverlay.patches.includes("client.roleplay-background"), false);
assert.equal(degradedClientOverlay.patches.includes("client.bridge-first"), false);
assert.equal(degradedClientOverlay.patches.includes("client.command-drafts"), true);
assert.equal(degradedClientOverlay.failedPatches.some((failure) => failure.id === "client.roleplay-background"), true);
const degradedOverlayAssets = await fs.readdir(path.join(degradedClientOverlay.root, "assets"));
const degradedRuntimeName = degradedOverlayAssets.find((name) => /^mari-bridge-runtime-[a-f0-9]{16}\.js$/u.test(name));
const degradedOverlayRuntime = await fs.readFile(
  path.join(degradedClientOverlay.root, "assets", degradedRuntimeName),
  "utf8",
);
const degradedNativePatches = JSON.parse(
  degradedOverlayRuntime.match(/const NATIVE_PATCHES = new Set\((?<patches>\[[^;]+\])\);/u).groups.patches,
);
assert.equal(degradedNativePatches.includes("client.roleplay-background"), false);
assert.equal(degradedNativePatches.includes("client.command-drafts"), true);

const bootstrapFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mari-bridge-check-"));
const bootstrapSource = path.join(bootstrapFixtureRoot, "source.mjs");
const bootstrapTarget = path.join(bootstrapFixtureRoot, "stable", "register.mjs");
await fs.writeFile(bootstrapSource, "export const marker = 1;\n");
assert.deepEqual(await installBootstrapFile(bootstrapSource, bootstrapTarget), {
  path: bootstrapTarget,
  changed: true,
});
const firstTargetStat = await fs.stat(bootstrapTarget);
assert.deepEqual(await installBootstrapFile(bootstrapSource, bootstrapTarget), {
  path: bootstrapTarget,
  changed: false,
});
assert.equal((await fs.stat(bootstrapTarget)).mtimeMs, firstTargetStat.mtimeMs);
await fs.chmod(bootstrapTarget, 0o400);
await fs.writeFile(bootstrapSource, "export const marker = 2;\n");
assert.deepEqual(await installBootstrapFile(bootstrapSource, bootstrapTarget), {
  path: bootstrapTarget,
  changed: true,
});
assert.equal((await fs.readFile(bootstrapTarget, "utf8")).includes("marker = 2"), true);
assert.equal(requiresBootstrapHandoff(null, true, "1.0.27"), false);
assert.equal(requiresBootstrapHandoff({ version: "1.0.27" }, false, "1.0.27"), false);
assert.equal(requiresBootstrapHandoff({ version: "1.0.26" }, false, "1.0.27"), true);
assert.equal(requiresBootstrapHandoff({ version: "1.0.27" }, true, "1.0.27"), true);
const kernelSymbol = Symbol.for("marinara.mari-bridge.kernel.v1");
globalThis[kernelSymbol] = { active: true, version: "1.0.27", failures: [] };
const installerHooks = [];
const installer = await import(new URL(`../src/server/index.js?check=${Date.now()}`, import.meta.url));
await installer.activate({
  dataDir: bootstrapFixtureRoot,
  app: { addHook(name, callback) { installerHooks.push({ name, callback }); } },
  api: { runtime: { logger: { info() {} } } },
});
await installer.selfCheck();
for (const relativePath of [
  "bootstrap/register.mjs",
  "bootstrap/runtime.mjs",
  "src/shared/contracts.js",
  "src/server/runtime.js",
  "src/server/agent-prompt-registry.js",
  "src/server/turn-handoff-registry.js",
  "src/server/message-registry.js",
  "src/server/chat-registry.js",
  "src/server/spatial-directive-compat.js",
  "src/server/client-overlay.js",
  "src/client/runtime.js",
  "src/client/tracker-detail-field-registry.js",
]) {
  await fs.access(path.join(bootstrapFixtureRoot, "mari-bridge", relativePath));
}
assert.equal(installerHooks.some((hook) => hook.name === "onReady"), true);
globalThis[kernelSymbol] = { active: true };
const bootstrapResult = await schedulePackageBootstrapRestart({ dataDir: bootstrapFixtureRoot }, "unused.mjs");
assert.deepEqual(bootstrapResult, { scheduled: false, reason: "preload-active" });
assert.equal(
  bootstrapRestartTest.withoutMariBridgeImports(
    "--trace-warnings --import=file:///data/mari-bridge/bootstrap/register.mjs --enable-source-maps",
  ),
  "--trace-warnings --enable-source-maps",
);
assert.equal(
  bootstrapRestartTest.withoutMariBridgeImports(
    "--import file:///data/mari-bridge/bootstrap/register.mjs --max-old-space-size=4096",
  ),
  "--max-old-space-size=4096",
);
const bootstrapAttempt = JSON.parse(
  await fs.readFile(path.join(bootstrapFixtureRoot, "mari-bridge", "bootstrap-attempt.json"), "utf8"),
);
assert.equal(bootstrapAttempt.attempts, 0);
assert.equal(bootstrapAttempt.status, "preload-active");
const bootstrapRestartSource = await fs.readFile(new URL("../src/server/bootstrap-restart.js", import.meta.url), "utf8");
assert.match(bootstrapRestartSource, /process\.platform !== "win32" && typeof process\.execve !== "function"/u);
assert.match(bootstrapRestartSource, /detached: true/u);
assert.match(bootstrapRestartSource, /child\.unref\(\)/u);
assert.match(bootstrapRestartSource, /process\.exit\(0\)/u);
assert.match(bootstrapRestartSource, /process\.execve\(process\.execPath/u);
delete globalThis[kernelSymbol];
await fs.rm(bootstrapFixtureRoot, { recursive: true, force: true });

const prompts = createPromptRegistry();
prompts.registerSuppression("test-consumer", { id: "hide-tracker", identifiers: ["tracker_context"] });
prompts.registerTransform("test-consumer", {
  id: "strip-gfx",
  stage: "history",
  transform: (messages) => messages.map((message) => ({ ...message, content: message.content.replace(/<gfx>.*?<\/gfx>/gu, "") })),
});
prompts.registerInjection("test-consumer", {
  id: "state",
  position: "before-history",
  role: "system",
  content: "Package state",
});
const prepared = await prompts.prepareAssemblerInput({
  chatId: "chat-1",
  characterIds: ["char-1"],
  sections: [
    { id: "one", identifier: "tracker_context", name: "Tracker", enabled: "true" },
    { id: "two", identifier: "system", name: "System", enabled: "true" },
  ],
  chatMessages: [{ role: "assistant", content: "Hello <gfx>old</gfx>", contextKind: "history" }],
});
assert.equal(prepared.sections[0].enabled, "false");
assert.equal(prepared.sections[1].enabled, "true");
assert.equal(prepared.chatMessages[0].content, "Hello ");
const finalized = await prompts.finalizeAssemblerMessages(prepared, prepared.chatMessages);
assert.equal(finalized[0].content, "Package state");
assert.equal(finalized[1].contextKind, "history");
const bootstrapDispatcherSource = await fs.readFile(new URL("../bootstrap/register.mjs", import.meta.url), "utf8");
const bootstrapPatchSource = await fs.readFile(new URL("../bootstrap/runtime.mjs", import.meta.url), "utf8");
const serverOverlaySource = await fs.readFile(new URL("../src/server/server-overlay.js", import.meta.url), "utf8");
const installerSource = await fs.readFile(new URL("../src/server/index.js", import.meta.url), "utf8");
assert.match(bootstrapDispatcherSource, /isMainThread/u);
assert.match(bootstrapDispatcherSource, /if \(isMainThread\) await import\("\.\/runtime\.mjs"\)/u);
assert.doesNotMatch(bootstrapDispatcherSource, /prepareClientOverlay|prepareServerOverlay|handoffToServerOverlay/u);
const workerGuardResult = spawnSync(process.execPath, [
  `--import=${new URL("../bootstrap/register.mjs", import.meta.url).href}`,
  "--input-type=module",
  "--eval",
  [
    'import { Worker } from "node:worker_threads";',
    'const worker = new Worker(\'import { parentPort } from "node:worker_threads"; parentPort.postMessage(Boolean(globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")]));\', { eval: true, type: "module" });',
    'worker.once("message", (value) => console.log(String(value)));',
  ].join("\n"),
], { encoding: "utf8" });
assert.equal(workerGuardResult.status, 0, workerGuardResult.stderr);
assert.equal(workerGuardResult.stdout.trim(), "false");
assert.match(bootstrapPatchSource, /createInjectedServerRuntime/u);
assert.match(bootstrapPatchSource, /prepareClientOverlay/u);
assert.match(bootstrapPatchSource, /prepareServerOverlay/u);
assert.match(bootstrapPatchSource, /handoffToServerOverlay/u);
assert.doesNotMatch(bootstrapPatchSource, /registerHooks|nextLoad\(url/u);
assert.match(serverOverlaySource, /join\(resolve\(dataDir\), "mari-bridge"\)/u);
assert.match(serverOverlaySource, /MARI_BRIDGE_ENGINE_ROOT/u);
assert.match(bootstrapPatchSource, /bindHost/u);
assert.match(bootstrapPatchSource, /requirePrivilegedAccess/u);
assert.match(bootstrapPatchSource, /\/api\/mari-bridge\/health/u);
assert.match(installerSource, /STABLE_RUNTIME_FILES/u);
assert.doesNotMatch(installerSource, /createBridgeRuntime|prepareClientOverlay|createDiagnosticsRoutes/u);
assert.match(bootstrapPatchSource, /prompt\.generate-fallback/u);
assert.match(bootstrapPatchSource, /prompt\.active-agents\.assembler/u);
assert.match(bootstrapPatchSource, /prompt\.active-agents\.context/u);
assert.match(bootstrapPatchSource, /prompt\.active-agents\.macro/u);
assert.match(bootstrapPatchSource, /prompt\.active-agents\.dry-run/u);
assert.match(bootstrapPatchSource, /prompt\.group-macros\.preview/u);
assert.match(bootstrapPatchSource, /active-agents/u);
assert.match(bootstrapPatchSource, /group_scenario_override/u);
assert.match(bootstrapPatchSource, /group_mode/u);
assert.match(bootstrapPatchSource, /prompt\.outlet-nested-fields\.scan-source/u);
assert.match(bootstrapPatchSource, /prompt\.outlet-nested-fields\.main-final/u);
assert.match(bootstrapPatchSource, /prompt\.outlet-nested-fields\.dry-run-final/u);
assert.match(bootstrapPatchSource, /presetOwnsAgentPlacement/u);
assert.match(bootstrapPatchSource, /bridgedMessagesForGen/u);
assert.match(bootstrapPatchSource, /agent\.result-types/u);
assert.match(bootstrapPatchSource, /agent\.result-apply-main/u);
assert.match(bootstrapPatchSource, /agent\.result-apply-retry/u);
assert.match(bootstrapPatchSource, /tracker\.context-committed/u);
assert.match(bootstrapPatchSource, /tracker\.context-agent/u);
assert.match(bootstrapPatchSource, /group\.selector-policy/u);
assert.match(bootstrapPatchSource, /group\.selector-call/u);
assert.match(bootstrapPatchSource, /turn\.handoff-queue-state/u);
assert.match(bootstrapPatchSource, /turn\.handoff-persona-return/u);
assert.match(bootstrapPatchSource, /turn\.handoff-stream-filter/u);
assert.match(bootstrapPatchSource, /turn\.handoff-response-process/u);
assert.match(bootstrapPatchSource, /turn\.handoff-commit/u);
assert.match(bootstrapPatchSource, /const turnHandoffPatchApplied = groupSelectorPatchApplied/u);
assert.match(bootstrapPatchSource, /turnHandoffPatchApplied \? \["turn\.handoff"\]/u);
assert.match(bootstrapPatchSource, /message\.prepare-create/u);
assert.match(bootstrapPatchSource, /messagePreparePatchApplied \? \["message\.prepare"\]/u);
assert.match(bootstrapPatchSource, /message\.persist-generate/u);
assert.match(bootstrapPatchSource, /messagePersistPatchApplied \? \["message\.persist"\]/u);
assert.match(bootstrapPatchSource, /chat\.changed-root/u);
assert.match(bootstrapPatchSource, /chatChangedPatchApplied \? \["chat\.changed"\]/u);
assert.doesNotMatch(bootstrapPatchSource, /host\.lifecycle|createHostLifecycleRegistry/u);
assert.match(bootstrapPatchSource, /\/api\/mari-bridge\/turn-handoff\/:chatId/u);
assert.match(bootstrapPatchSource, /status: initializing \? "initializing" : "unavailable"/u);
assert.match(
  bootstrapPatchSource,
  /chatId: input\.chatId, chatMetadata: chatMeta, chatMode, impersonate: input\.impersonate === true/u,
);
assert.doesNotMatch(
  bootstrapPatchSource,
  /"          chatId: input\.chatId, chatMetadata: chatMeta, chatMode, targetCharacterId: targetCharId/u,
);
const { decodeModuleSource, detectMarinaraEngine, patchCommittedTrackerActiveGuard, patchServerModule } = await import(
  new URL(`../bootstrap/runtime.mjs?check=${Date.now()}`, import.meta.url)
);
assert.equal(decodeModuleSource(new TextEncoder().encode("export const value = 1;")), "export const value = 1;");

const serverOverlayFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mari-bridge-server-overlay-"));
const serverOverlayDist = path.join(serverOverlayFixtureRoot, "packages", "server", "dist");
const serverOverlayDataDir = path.join(serverOverlayFixtureRoot, "runtime-data");
const sharedOverlayDist = path.join(serverOverlayFixtureRoot, "packages", "shared", "dist");
await fs.mkdir(path.join(serverOverlayDist, "services"), { recursive: true });
await fs.mkdir(path.join(sharedOverlayDist, "utils"), { recursive: true });
await fs.mkdir(path.join(serverOverlayFixtureRoot, "packages", "server", "node_modules", "fastify"), { recursive: true });
await fs.writeFile(path.join(serverOverlayFixtureRoot, "package.json"), JSON.stringify({
  name: "marinara-engine",
  version: "2.4.4",
}));
await fs.writeFile(path.join(serverOverlayFixtureRoot, "packages", "shared", "package.json"), JSON.stringify({
  name: "@marinara-engine/shared",
  type: "module",
  exports: { ".": "./dist/index.js" },
}));
await fs.writeFile(path.join(serverOverlayDist, "index.js"), "export const entry = true;\n");
await fs.writeFile(path.join(serverOverlayDist, "untouched.js"), "export const untouched = true;\n");
await fs.writeFile(path.join(serverOverlayDist, "services", "patched.js"), "export const native = true;\n");
await fs.writeFile(
  path.join(serverOverlayFixtureRoot, "packages", "server", "node_modules", "fastify", "package.json"),
  JSON.stringify({ name: "fastify", version: "fixture" }),
);
await fs.writeFile(path.join(sharedOverlayDist, "index.js"), 'export * from "./utils/macro-engine.js";\n');
await fs.writeFile(path.join(sharedOverlayDist, "utils", "macro-engine.js"), "export const nativeMacro = true;\n");
const overlayTargets = [
  ["services/patched.js", ["packages", "server", "dist", "services", "patched.js"]],
  ["utils/macro-engine.js", ["packages", "shared", "dist", "utils", "macro-engine.js"]],
];
const preparedServerOverlay = await prepareServerOverlay({
  engineRoot: serverOverlayFixtureRoot,
  dataDir: serverOverlayDataDir,
  engineVersion: "2.4.4",
  bridgeVersion: "1.0.31",
  patchTargets: overlayTargets,
  patchModule: (_url, source) => `${source.trimEnd()}\nexport const bridged = true;\n`,
});
assert.equal(preparedServerOverlay.root, path.join(serverOverlayDataDir, "mari-bridge", "server"));
assert.equal(preparedServerOverlay.engineRoot, path.resolve(serverOverlayFixtureRoot));
assert.equal(
  JSON.parse(await fs.readFile(path.join(preparedServerOverlay.root, ".mari-bridge-ready.json"), "utf8")).engineRoot,
  path.resolve(serverOverlayFixtureRoot),
);
assert.equal(isServerOverlayEntry(preparedServerOverlay.entry, preparedServerOverlay), true);
assert.equal(
  await fs.realpath(path.join(preparedServerOverlay.root, "node_modules", "fastify")),
  await fs.realpath(path.join(serverOverlayFixtureRoot, "packages", "server", "node_modules", "fastify")),
);
assert.deepEqual(
  detectMarinaraEngine("missing-entry.js", path.join(serverOverlayFixtureRoot, "missing"), serverOverlayFixtureRoot),
  Object.freeze({ root: path.resolve(serverOverlayFixtureRoot), version: "2.4.4" }),
);
assert.deepEqual(serverOverlayProcessState(preparedServerOverlay, {}), { active: false, depth: 0 });
assert.deepEqual(serverOverlayProcessState(preparedServerOverlay, {
  MARI_BRIDGE_SERVER_OVERLAY_VERSION: "1.0.31",
  MARI_BRIDGE_SERVER_OVERLAY_ENTRY: preparedServerOverlay.entry,
  MARI_BRIDGE_SERVER_HANDOFF_DEPTH: "1",
}), { active: true, depth: 1 });
assert.deepEqual(serverOverlayProcessState(preparedServerOverlay, {
  MARI_BRIDGE_SERVER_OVERLAY_VERSION: "1.0.29",
  MARI_BRIDGE_SERVER_OVERLAY_ENTRY: preparedServerOverlay.entry,
  MARI_BRIDGE_SERVER_HANDOFF_DEPTH: "1",
}), { active: false, depth: 1 });
assert.match(await fs.readFile(path.join(preparedServerOverlay.root, "services", "patched.js"), "utf8"), /bridged = true/u);
assert.match(await fs.readFile(path.join(preparedServerOverlay.root, "untouched.js"), "utf8"), /untouched = true/u);
assert.match(
  await fs.readFile(path.join(
    preparedServerOverlay.root,
    "node_modules",
    "@marinara-engine",
    "shared",
    "dist",
    "utils",
    "macro-engine.js",
  ), "utf8"),
  /bridged = true/u,
);
assert.deepEqual(
  await prepareServerOverlay({
    engineRoot: serverOverlayFixtureRoot,
    dataDir: serverOverlayDataDir,
    engineVersion: "2.4.4",
    bridgeVersion: "1.0.31",
    patchTargets: overlayTargets,
    patchModule: () => { throw new Error("cached server overlay should not rebuild"); },
  }),
  preparedServerOverlay,
);
const rebuiltServerOverlay = await prepareServerOverlay({
  engineRoot: serverOverlayFixtureRoot,
  dataDir: serverOverlayDataDir,
  engineVersion: "2.4.4",
  bridgeVersion: "1.0.38",
  patchTargets: overlayTargets,
  patchModule: (_url, source) => `${source.trimEnd()}\nexport const rebuilt = true;\n`,
});
assert.equal(rebuiltServerOverlay.root, preparedServerOverlay.root);
assert.equal(rebuiltServerOverlay.bridgeVersion, "1.0.38");
assert.match(await fs.readFile(path.join(rebuiltServerOverlay.root, "services", "patched.js"), "utf8"), /rebuilt = true/u);
assert.deepEqual(
  serverOverlayTest.withoutMariBridgeExecArgs([
    "--trace-warnings",
    "--import=file:///data/mari-bridge/bootstrap/register.mjs",
    "--enable-source-maps",
  ]),
  ["--trace-warnings", "--enable-source-maps"],
);
await fs.rm(serverOverlayFixtureRoot, { recursive: true, force: true });
const packageStartupFixture = `async start(app) {
        for (const runtimePackage of await capabilityPackageManager.runtimePackages()) {
            await this.activateOne(app, runtimePackage, true, false);
        }
    }`;
const patchedPackageStartup = patchServerModule(
  "file:///engine/capability-module-runtime.service.js",
  packageStartupFixture,
);
assert.match(patchedPackageStartup, /bindHost\?\.\(app\)/u);
assert.doesNotMatch(patchedPackageStartup, /left\.installed\.id === "mari-bridge"/u);
assert.match(patchedPackageStartup, /installed\.status === "restart-required"/u);
assert.match(patchedPackageStartup, /markRuntimeStatus\(installed\.id, "active"\)/u);
assert.match(patchedPackageStartup, /bridgeStartupError/u);
assert.match(patchedPackageStartup, /startsWith\("Mari Bridge "\)/u);
assert.match(patchedPackageStartup, /this\.activateOne\(app, \{ installed \}, false, false\)/u);
assert.equal(globalThis[kernelSymbol].patches["packages.client-only-updates"], "applied");

const chatsStorageFixture = `export class ChatsStorage {
    async createMessage(input, timestampOverrides) {
      return { input, timestampOverrides };
    }
}`;
const patchedChatsStorage = patchServerModule(
  "file:///engine/services/storage/chats.storage.js",
  chatsStorageFixture,
);
assert.match(patchedChatsStorage, /messageHooks\?\.prepareCreate\(input\)/u);
assert.equal(globalThis[kernelSymbol].patches["message.prepare-create"], "applied");

const chatsRouteFixture = `export function register(app, storage, logger) {
  app.patch("/:id", async (req) => {
    const data = req.body;
    const existing = await storage.getById(req.params.id);
    const updated = await storage.update(req.params.id, data);
    return updated;
  });
  app.patch("/:id/metadata", async (req) => {
    const chat = await storage.getById(req.params.id);
    const incoming = req.body;
    const updated = await storage.patchMetadata(req.params.id, incoming);
    return updated;
  });
}`;
const patchedChatsRoute = patchServerModule("file:///engine/routes/chats.routes.js", chatsRouteFixture);
assert.match(patchedChatsRoute, /chatHooks\?\.notifyChanged/u);
assert.match(patchedChatsRoute, /source: "chat"/u);
assert.match(patchedChatsRoute, /source: "metadata"/u);
assert.equal(globalThis[kernelSymbol].patches["chat.changed-root"], "applied");
assert.equal(globalThis[kernelSymbol].patches["chat.changed-metadata"], "applied");

const trackerCharacterUtilsFixture = `
function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function trackerCharacterIdKey(value) { return typeof value.characterId === "string" ? value.characterId : ""; }
function trackerCharacterNameKey(value) { return typeof value.name === "string" ? value.name : ""; }
function trackerCharacterKey(value) { return trackerCharacterIdKey(value) || trackerCharacterNameKey(value); }
function mergeTrackerStats(_previous, next) { return next; }
function isNpcTrackerAvatarPath() { return false; }
function isTrackerAvatarCrop() { return false; }
export function parseJsonField(value, fallback) { return typeof value === "string" ? JSON.parse(value) : (value ?? fallback); }
const MAX_TRACKER_CHARACTER_HISTORY = 50;
export function collectLatestTrackerCharacterHistory(snapshots) {
    const history = [];
    const seenIds = new Set();
    const seenNames = new Set();
    for (const snapshot of snapshots) {
        const characters = parseJsonField(snapshot.presentCharacters, []);
        for (const value of characters) {
            if (!isPlainRecord(value))
                continue;
            const id = trackerCharacterIdKey(value);
            const name = trackerCharacterNameKey(value);
            if ((id && seenIds.has(id)) || (!id && name && seenNames.has(name)))
                continue;
            history.push(value);
            if (id)
                seenIds.add(id);
            if (name)
                seenNames.add(name);
            if (history.length >= MAX_TRACKER_CHARACTER_HISTORY)
                return history;
        }
    }
    return history;
}
export function preserveTrackerCharacterUiFields(nextCharacters, previousCharacters) {
    const previousByKey = new Map(previousCharacters.map((character) => [trackerCharacterKey(character), character]));
    for (const character of nextCharacters) {
        const previous = previousByKey.get(trackerCharacterKey(character));
        const previousCustomFields = isPlainRecord(previous?.customFields) ? previous.customFields : null;
        const nextCustomFields = isPlainRecord(character.customFields) ? character.customFields : null;
        if (previousCustomFields) {
            character.customFields = { ...previousCustomFields, ...(nextCustomFields ?? {}) };
        }
        character.stats = mergeTrackerStats(previous?.stats, character.stats);
    }
}
export function parseGameStateRow(row) {
    return {
        presentCharacters: parseJsonField(row.presentCharacters, []),
    };
}
`;
const patchedTrackerCharacterUtils = patchServerModule(
  "file:///engine/routes/generate/generate-route-utils.js",
  trackerCharacterUtilsFixture,
);
const trackerCharacterUtils = await import(
  `data:text/javascript;base64,${Buffer.from(patchedTrackerCharacterUtils).toString("base64")}`
);
const trackerHistory = trackerCharacterUtils.collectLatestTrackerCharacterHistory([{
  presentCharacters: JSON.stringify([
    { characterId: "char-1", name: "Kira", customFields: { Location: "Bar", "": null } },
    { characterId: "char-2", name: "Mina", customFields: { "": "intentional" } },
  ]),
}]);
assert.deepEqual(trackerHistory[0].customFields, { Location: "Bar" });
assert.deepEqual(trackerHistory[1].customFields, { "": "intentional" });
assert.deepEqual(
  trackerCharacterUtils.parseGameStateRow({
    presentCharacters: JSON.stringify([{ characterId: "char-1", customFields: { Location: "Bar", "": null } }]),
  }).presentCharacters[0].customFields,
  { Location: "Bar" },
);
const nextTrackerCharacters = [{ characterId: "char-1", name: "Kira", customFields: { Activity: "Talking", "": null }, stats: [] }];
trackerCharacterUtils.preserveTrackerCharacterUiFields(nextTrackerCharacters, [{
  characterId: "char-1",
  name: "Kira",
  customFields: { Location: "Bar", "": null },
  stats: [],
}]);
assert.deepEqual(nextTrackerCharacters[0].customFields, { Location: "Bar", Activity: "Talking" });
assert.equal(globalThis[kernelSymbol].patches["compat.character-custom-field.blank-null-history"], "applied");
assert.equal(globalThis[kernelSymbol].patches["compat.character-custom-field.blank-null-preserve"], "applied");
assert.equal(globalThis[kernelSymbol].patches["compat.character-custom-field.blank-null-game-state"], "applied");

const trackerFieldLocksFixture = `
function isTrackerFieldLocked() { return false; }
function characterCustomFieldTrackerLockKey() { return "fixture"; }
function mergeCharacterCustomFieldsWithLocks(nextFields, currentFields, locks, character, characterIndex) {
    let next = nextFields ? { ...(currentFields ?? {}), ...nextFields } : currentFields ? { ...currentFields } : null;
    const current = currentFields ?? {};
    let hasLockedField = false;
    for (const [name, value] of Object.entries(current)) {
        const nameLocked = isTrackerFieldLocked(locks, characterCustomFieldTrackerLockKey(character, characterIndex, name, "name"));
        const valueLocked = isTrackerFieldLocked(locks, characterCustomFieldTrackerLockKey(character, characterIndex, name, "value"));
        if (nameLocked || valueLocked) {
            hasLockedField = true;
            const nextValue = (next ?? {})[name];
            (next ??= {})[name] = valueLocked ? value : typeof nextValue === "string" ? nextValue : value;
        }
    }
    return nextFields || hasLockedField || Object.keys(current).length > 0 ? (next ?? undefined) : undefined;
}
export { mergeCharacterCustomFieldsWithLocks };
`;
const patchedTrackerFieldLocks = patchServerModule(
  "file:///engine/utils/tracker-field-locks.js",
  trackerFieldLocksFixture,
);
const trackerFieldLocks = await import(
  `data:text/javascript;base64,${Buffer.from(patchedTrackerFieldLocks).toString("base64")}`
);
assert.deepEqual(
  trackerFieldLocks.mergeCharacterCustomFieldsWithLocks(
    { Activity: "Talking", "": null },
    { Location: "Bar", "": null },
    {},
    { characterId: "char-1" },
    0,
  ),
  { Location: "Bar", Activity: "Talking" },
);
assert.deepEqual(
  trackerFieldLocks.mergeCharacterCustomFieldsWithLocks({ "": "intentional" }, { "": null }, {}, {}, 0),
  { "": "intentional" },
);
assert.equal(globalThis[kernelSymbol].patches["compat.character-custom-field.blank-null-lock-merge"], "applied");

const generatePersistFixture = `async function persist(input, savedMsg, savedSwipeIndex) {
          if (
            savedMsg?.id &&
            savedSwipeIndex !== null &&
            !shouldSuppressAssistantSpatialMutation(input) &&
            hierarchicalMapsEnabledForChat
          ) {
            await materializeAssistantSpatialState();
          }
}`;
const patchedGeneratePersist = patchServerModule("file:///engine/routes/generate.routes.js", generatePersistFixture);
assert.match(patchedGeneratePersist, /messageHooks\?\.notifyPersisted/u);
assert.match(patchedGeneratePersist, /kind: input\.regenerateMessageId \? "regenerate" : input\.continueMessageId \? "continue" : "create"/u);
assert.equal(globalThis[kernelSymbol].patches["message.persist-generate"], "applied");

const spatialGenerateFixture = [
  "        const spatialDirectiveStreamFilter =",
  "          hierarchicalMapsEnabledForChat ? createAssistantSpatialDirectiveStreamFilter() : null;",
  "          const visibleText = spatialDirectiveStreamFilter?.push(text) ?? text;",
  "            const pendingSpatialText = spatialDirectiveStreamFilter?.flush() ?? \"\";",
  "            const parsedSpatial = extractAssistantSpatialDirective(fullResponse);",
  "                    const parsedRewriteSpatial = extractAssistantSpatialDirective(editedText);",
].join("\n");
const patchedSpatialGenerate = patchServerModule(
  "file:///engine/routes/generate.routes.js",
  spatialGenerateFixture,
);
assert.match(patchedSpatialGenerate, /bridgedSpatialDirectiveStreamFilter/u);
assert.match(
  patchedSpatialGenerate,
  /const bridgedSpatialDirectiveStreamFilter =\s+hierarchicalMapsEnabledForChat &&/u,
);
assert.match(patchedSpatialGenerate, /spatialDirectiveHooks\?\.createStreamFilter/u);
assert.match(patchedSpatialGenerate, /spatialDirectiveHooks\?\.normalizeResponse\(fullResponse\)/u);
assert.match(patchedSpatialGenerate, /spatialDirectiveHooks\?\.normalizeResponse\(editedText\)/u);
assert.equal(globalThis[kernelSymbol].patches["spatial.directive-compat-response"], "applied");
assert.equal(globalThis[kernelSymbol].patches["spatial.directive-compat-rewrite"], "applied");

const macroEngineFixture = `
function replaceBalancedMacros(input, replacer) {
  return input.replace(/\\{\\{([^{}]+)\\}\\}/g, (original, body) => replacer(body, original) ?? original);
}
function resolveConditionalOperand(raw, ctx) {
  const token = raw.trim();
  const quoted = token.match(/^["']([\\s\\S]*)["']$/);
  if (quoted) return quoted[1];
  const braced = \`{{\${token}}}\`;
  const resolved = resolveMacros(braced, ctx);
  return resolved === braced ? token : resolved;
}
function resolveConditionalBlocks(input, ctx) {
  return input.replace(/\\{\\{#if\\s+([\\s\\S]*?)\\}\\}([\\s\\S]*?)(?:\\{\\{else\\}\\}([\\s\\S]*?))?\\{\\{\\/if\\}\\}/gi, (_match, condition, truthy, falsy = "") => {
    const comparison = condition.match(/^([\\s\\S]*?)\\s+(==|contains)\\s+([\\s\\S]*?)$/i);
    if (!comparison) return resolveConditionalOperand(condition, ctx).trim() ? truthy : falsy;
    const left = resolveConditionalOperand(comparison[1], ctx);
    const right = resolveConditionalOperand(comparison[3], ctx);
    const matches = comparison[2].toLowerCase() === "contains" ? left.includes(right) : left === right;
    return matches ? truthy : falsy;
  });
}
function macroContextForCharacterProfile(profile, base) {
  return {
    variables: base?.variables ?? {},
    agentData: base?.agentData,
    characterFields: { description: profile.description ?? "" },
  };
}
export function resolveScopedMacros(template, profile, base) {
  return resolveMacros(template, macroContextForCharacterProfile(profile, base));
}
export function resolveMacros(template, ctx) {
  let result = template;
  const resolveNestedFieldMacros = (value) => resolveMacros(value, ctx);
  result = resolveConditionalBlocks(result, ctx);
  result = result.replace(/\\{\\{description\\}\\}/gi, () => resolveNestedFieldMacros(ctx.characterFields?.description ?? ""));
  result = result.replace(/\\{\\{chatId\\}\\}/gi, ctx.chatId ?? "");
  result = replaceBalancedMacros(result, (body) => {
    const match = body.match(/^outlet::([\\s\\S]*)$/i);
    if (!match) return undefined;
    const name = (match[1] ?? "").trim();
    return name && ctx.outlets && Object.prototype.hasOwnProperty.call(ctx.outlets, name) ? ctx.outlets[name] : "";
  });
  return result;
}`;
const patchedMacroEngineFixture = patchServerModule("file:///engine/utils/macro-engine.js", macroEngineFixture);
const patchedMacroEngine = await import(
  `data:text/javascript;base64,${Buffer.from(patchedMacroEngineFixture).toString("base64")}`
);
assert.equal(
  patchedMacroEngine.resolveMacros(
    "{{group_mode}}|{{group_scenario_override}}|{{active-agents}}|{{description}}",
    {
      groupMode: "INDIVIDUAL",
      groupScenarioOverride: "At {{outlet::place}}",
      activeAgents: ["custom-tracker", "presence"],
      characterFields: { description: "Clue: {{outlet::clue}} ({{group_mode}})" },
      outlets: { place: "the inn", clue: "the key is missing" },
    },
  ),
  "INDIVIDUAL|At the inn|custom-tracker,presence|Clue: the key is missing (INDIVIDUAL)",
);
assert.equal(
  patchedMacroEngine.resolveMacros("{{group_mode}}|{{group_scenario_override}}", {}),
  "SOLO|",
);
for (const mode of ["SOLO", "MERGED", "INDIVIDUAL"]) {
  assert.equal(
    patchedMacroEngine.resolveMacros(
      `{{group_mode}}|{{#if group_mode == "${mode}"}}MATCH{{else}}MISS{{/if}}`,
      { groupMode: mode },
    ),
    `${mode}|MATCH`,
  );
}
assert.equal(
  patchedMacroEngine.resolveMacros(
    '{{#if active-agents contains "custom-tracker"}}ACTIVE{{else}}INACTIVE{{/if}}|{{#if group_scenario_override}}SCENARIO{{else}}NONE{{/if}}',
    { activeAgents: ["custom-tracker", "presence"], groupScenarioOverride: "Shared scenario" },
  ),
  "ACTIVE|SCENARIO",
);
assert.equal(
  patchedMacroEngine.resolveScopedMacros(
    "{{group_mode}}|{{group_scenario_override}}|{{active-agents}}|{{description}}",
    { description: "Nested {{group_mode}}" },
    {
      groupMode: "MERGED",
      groupScenarioOverride: "Shared scenario",
      activeAgents: ["custom-tracker"],
      variables: {},
    },
  ),
  "MERGED|Shared scenario|custom-tracker|Nested MERGED",
);

const macroContextFixture = `export function build(input) {
  return {
    timeZone: input.timeZone,
  };
}`;
const patchedMacroContextFixture = patchServerModule(
  "file:///engine/services/prompt/macro-context.js",
  macroContextFixture,
);
const patchedMacroContext = await import(
  `data:text/javascript;base64,${Buffer.from(patchedMacroContextFixture).toString("base64")}`
);
assert.deepEqual(patchedMacroContext.build({
  activeAgentIds: [" custom-tracker ", "custom-tracker", "presence"],
  groupScenarioOverrideText: "Shared scenario",
  groupMode: "merged",
}), {
  timeZone: undefined,
  activeAgents: ["custom-tracker", "presence"],
  groupScenarioOverride: "Shared scenario",
  groupMode: "MERGED",
});
assert.equal(patchedMacroContext.build({ groupMode: "INDIVIDUAL" }).groupMode, "INDIVIDUAL");
assert.equal(patchedMacroContext.build({ groupMode: "SOLO" }).groupMode, "SOLO");

const assemblerPatchFixture = [
  "export async function assemblePrompt(input) {",
  "    const macroCtx = await buildPromptMacroContext({",
  "    timeZone: input.timeZone,",
  "    });",
  "    let outletScanAttempted = false;",
  "    for (const section of input.sections) {",
  "if (!outletScanAttempted && /\\{\\{\\s*outlet\\s*::/i.test(section.content)) {",
  "outletScanAttempted = true;",
  "}",
  "}",
  "let finalMessages = [];",
  "finalMessages = finalMessages.filter((m) => m.content?.trim());",
  "return finalMessages;",
  "}",
].join("\n");
const patchedAssemblerFixture = patchServerModule(
  "file:///engine/services/prompt/assembler.js",
  assemblerPatchFixture,
);
assert.match(patchedAssemblerFixture, /groupMode: input\.groupMode/u);
assert.match(patchedAssemblerFixture, /activeAgentIds: input\.activeAgentIds \?\? \[\]/u);
assert.match(patchedAssemblerFixture, /mariBridgeNestedOutletSources/u);
assert.match(patchedAssemblerFixture, /mariBridgeSectionNeedsOutletScan\(section\)/u);
assert.match(patchedAssemblerFixture, /group_scenario_override/u);

const dryRunRouteFixture = [
  "        const returnPrompt = body.returnPrompt === true;",
  "        const wrapLastMessage = body.wrapLastMessage === true;",
  "        if (impersonate) {",
  "            const impersonateInstruction = buildImpersonateInstruction({",
  "            finalMessages.push({ role: \"assistant\", content: assistantPrefill.trimEnd() });",
  "        }",
  "        finalMessages = injectOwnerSpatialPrompt(finalMessages, promptSpatialProjection);",
  "            let full = \"\";",
  "            const onToken = async (chunk) => {",
  "                full += chunk;",
  "                await sendTokenTextChunked(chunk);",
  "            };",
  "                    suppressModelParameters,",
  "                    onToken,",
  "                    signal: abortController.signal,",
  "                sendSseEvent(reply, { type: \"result\", data: { content: full || result.content || \"\" } });",
  "        try {",
  "            const result = await provider.chatComplete(providerMessages, {",
  "                suppressModelParameters,",
  "                signal: abortController.signal,",
  "            return reply.send({",
  "                content: (result.content ?? \"\").trimEnd(),",
  "                runId,",
  "            });",
  "            idleDuration: promptIdleDuration,",
  "        });",
  "        const historyMacroProfilesById = (await resolveCharacterMacroData(app.db, allCharacterIds)).profilesById;",
  "                idleDuration: promptIdleDuration,",
  "                impersonate,",
  "                enableAgents: false,",
  "                activeAgentIds: [],",
  "            promptMacroContext.agentData = {",
  "                ...promptMacroContext.agentData,",
  "                ...assembled.macroAgentData,",
  "            };",
  "            finalMessages = assembled.messages;",
].join("\n");
const patchedDryRunRouteFixture = patchServerModule(
  "file:///engine/routes/generate/dry-run-route.js",
  dryRunRouteFixture,
);
assert.equal((patchedDryRunRouteFixture.match(/dryRunGroupChatMode/gu) ?? []).length, 2);
assert.equal((patchedDryRunRouteFixture.match(/allCharacterIds\.length > 1 \? dryRunGroupChatMode/gu) ?? []).length, 2);
assert.match(patchedDryRunRouteFixture, /promptMacroContext\.outlets = assembled\.lorebookScanResult\?\.outlets/u);
assert.match(patchedDryRunRouteFixture, /activeAgentIds: dryRunActiveAgentIds/u);
assert.match(patchedDryRunRouteFixture, /impersonateContinuation/u);
assert.match(patchedDryRunRouteFixture, /impersonate && !impersonatePresetOwnsInstructions/u);
assert.match(patchedDryRunRouteFixture, /extractImpersonateContinuation/u);
assert.match(patchedDryRunRouteFixture, /captureReasoning: includeReasoning/u);
assert.match(patchedDryRunRouteFixture, /type: "thinking"/u);
assert.equal((patchedDryRunRouteFixture.match(/continuation: extractImpersonateContinuation\(content\)/gu) ?? []).length, 2);

const promptsRouteFixture = [
  "            chatMessages: mappedMessages,",
  "            activeLorebookIds: Array.isArray(chatMeta.activeLorebookIds) ? chatMeta.activeLorebookIds : [],",
].join("\n");
const patchedPromptsRouteFixture = patchServerModule(
  "file:///engine/routes/prompts.routes.js",
  promptsRouteFixture,
);
assert.match(patchedPromptsRouteFixture, /activeAgentIds: chatMeta\.enableAgents === false/u);
assert.match(patchedPromptsRouteFixture, /groupMode: characterIds\.length > 1/u);
assert.match(patchedPromptsRouteFixture, /groupScenarioOverrideText/u);

const committedTrackerContextFixture = [
  'import { compactQuestProgressForContext, formatCustomTrackerFieldForPrompt } from "@marinara-engine/shared";',
  "function formatCharacterLine(character) {",
  "    const details = [];",
  "    if (character.mood)",
  "        details.push(`mood: ${character.mood}`);",
  "    if (character.appearance)",
  "        details.push(`appearance: ${character.appearance}`);",
  "    if (character.outfit)",
  "        details.push(`outfit: ${character.outfit}`);",
  "    if (character.thoughts)",
  "        details.push(`thoughts: ${character.thoughts}`);",
  "}",
  "export function buildCommittedTrackerContextBlock(args) {",
  "  if (!hasWorldState && !hasCharTracker && !hasPersonaStats && !hasQuest && !hasCustomTracker) return null;",
  "    const snap = args.latestGameState ?? {};",
  "    const trackerParts = [];",
  "    if (hasCharTracker) {",
  "        const presentChars = parseMaybeJson(snap.presentCharacters);",
  "        if (Array.isArray(presentChars) && presentChars.length > 0) {",
  "            const charLines = presentChars.map(formatCharacterLine).filter(isNonEmptyLine);",
  "        }",
  "    }",
  "    if (snap.playerStats) {",
  "        const stats = parseMaybeJson(snap.playerStats);",
  "        if (stats) {",
  "            if (hasCustomTracker && Array.isArray(stats.customTrackerFields) && stats.customTrackerFields.length > 0) {",
  "                const customLines = stats.customTrackerFields.map(formatCustomTrackerFieldForPrompt);",
  "                trackerParts.push(wrapContent(customLines.join(\"\\n\"), \"Custom Tracker\", args.wrapFormat));",
  "            }",
  "        }",
  "    }",
  "    const playerNotes =",
  "        typeof args.chatMetadata.gamePlayerNotes === \"string\" ? args.chatMetadata.gamePlayerNotes.trim() : \"\";",
  "}",
].join("\n");
const patchedCommittedTrackerContext = patchServerModule(
  "file:///engine/services/generation/committed-tracker-context.js",
  committedTrackerContextFixture,
);
assert.match(patchedCommittedTrackerContext, /normalizeTrackerHiddenFields/u);
assert.match(patchedCommittedTrackerContext, /compatibility shim: main committed tracker/u);
assert.match(patchedCommittedTrackerContext, /normalizeTrackerHiddenFields\(parseMaybeJson\(snap\.hiddenTrackerFields\)\)/u);
assert.match(patchedCommittedTrackerContext, /!mariBridgeFieldHidden\("mood"\)/u);
assert.match(patchedCommittedTrackerContext, /formatCharacterLine\(character, index, mariBridgeHiddenTrackerFields\)/u);
assert.match(patchedCommittedTrackerContext, /filterCustomTrackerFields/u);
assert.match(patchedCommittedTrackerContext, /mariBridgeCustomTrackerFields\.map\(formatCustomTrackerFieldForPrompt\)/u);
assert.match(patchedCommittedTrackerContext, /appendCommittedSections/u);
assert.equal(globalThis[kernelSymbol].patches["tracker.context-custom-fields"], "applied");
assert.equal(globalThis[kernelSymbol].patches["compat.hidden-tracker-context.map"], "applied");

const legacyCommittedGuard =
  "if (!hasWorldState && !hasCharTracker && !hasPersonaStats && !hasQuest && !hasCustomTracker) return null;";
const patchedLegacyCommittedGuard = patchCommittedTrackerActiveGuard(legacyCommittedGuard);
assert.match(patchedLegacyCommittedGuard, /trackerContextHooks\?\.hasActive\(args\.activeAgentIds\)/u);
const currentCommittedGuard = `if (
    !hasWorldState &&
    !hasCharTracker &&
    !hasPersonaStats &&
    !hasQuest &&
    !hasCustomTracker &&
    !hasInventoryTracker &&
    !hasBeholder
  )
    return null;`;
const patchedCurrentCommittedGuard = patchCommittedTrackerActiveGuard(currentCommittedGuard);
assert.match(patchedCurrentCommittedGuard, /!hasInventoryTracker && !hasBeholder/u);
assert.match(patchedCurrentCommittedGuard, /trackerContextHooks\?\.hasActive\(args\.activeAgentIds\)/u);
const unsupportedCommittedGuard = "if (!hasUnknownTracker) return null;";
assert.equal(
  patchCommittedTrackerActiveGuard(unsupportedCommittedGuard),
  unsupportedCommittedGuard,
  "unsupported tracker guards retain native Engine behavior instead of crashing startup",
);
assert.equal(globalThis[kernelSymbol].patches["tracker.context-committed-active"], "failed");

const preloadUrl = new URL("../bootstrap/register.mjs", import.meta.url).href;
async function runBootstrapFixture(version) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mari-bridge-version-"));
  const entryDir = path.join(root, "packages", "server", "dist");
  const entry = path.join(entryDir, "index.mjs");
  await fs.mkdir(entryDir, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "marinara-engine", version })}\n`);
  await fs.writeFile(
    entry,
    'console.log(JSON.stringify(globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")]));\n',
  );
  const result = spawnSync(process.execPath, [`--import=${preloadUrl}`, entry], {
    cwd: root,
    encoding: "utf8",
  });
  await fs.rm(root, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

const wrongVersionKernel = await runBootstrapFixture("2.4.3");
assert.equal(wrongVersionKernel.active, false);
assert.equal(wrongVersionKernel.engineCompatibility.compatible, false);
assert.equal(wrongVersionKernel.patches["engine.version"], "failed");
const failedPreflightKernel = await runBootstrapFixture("2.4.4");
assert.equal(failedPreflightKernel.active, false);
assert.equal(failedPreflightKernel.engineCompatibility.compatible, true);
assert.equal(failedPreflightKernel.patches["engine.preflight"], "failed");
console.log("Mari Bridge runtime checks passed.");
