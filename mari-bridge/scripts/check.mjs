import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridgeRuntime } from "../src/server/runtime.js";
import { createPromptRegistry } from "../src/server/prompt-registry.js";
import { createAgentResultRegistry } from "../src/server/result-registry.js";
import { createTrackerContextRegistry } from "../src/server/tracker-context-registry.js";
import { createGroupSelectorRegistry } from "../src/server/group-selector-registry.js";
import { createHostLifecycleRegistry } from "../src/server/host-lifecycle-registry.js";
import {
  patchActiveChatEvents,
  patchChatInputBridge,
  patchChatSettingsBridge,
  patchGenerationControllerEvents,
  patchRoleplayHudBridge,
  patchRoleplayBackgroundBridge,
  patchSlashCommandListBridge,
  patchTrackerPanelBridge,
  prepareClientOverlay,
  versionAssetReferences,
} from "../src/server/client-overlay.js";
import { schedulePackageBootstrapRestart } from "../src/server/bootstrap-restart.js";
import { installBootstrapFile, requiresBootstrapHandoff } from "../src/server/bootstrap-install.js";
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

const trackerRegistry = createTrackerContextRegistry();
trackerRegistry.register("tracker-owner", {
  id: "notes",
  agentTypes: ["notes"],
  formatCommitted: () => ({ label: "Notes", content: "Remember this." }),
  formatAgentState: () => ({ notes: ["Remember this."] }),
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

const lifecycleRegistry = createHostLifecycleRegistry();
const lifecycleCalls = [];
lifecycleRegistry.register("presence", {
  id: "visibility",
  preHandler: async (request) => lifecycleCalls.push(`pre:${request.url}`),
  onSend: async (_request, _reply, payload) => `${payload}:presence`,
  onResponse: async (request) => lifecycleCalls.push(`response:${request.url}`),
});
await lifecycleRegistry.dispatch("preHandler", { url: "/api/generate" }, {});
assert.equal(await lifecycleRegistry.dispatch("onSend", {}, {}, "payload"), "payload:presence");
await lifecycleRegistry.dispatch("onResponse", { url: "/api/generate" }, {});
assert.deepEqual(lifecycleCalls, ["pre:/api/generate", "response:/api/generate"]);

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
globalThis.fetch = async () => ({
  ok: true,
  async json() {
    return {
      status: "ok",
      version: "2.4.2",
      capabilityPackages: {
        packages: [{ id: "mari-bridge", version: "0.2.0", readiness: "ready", ready: true }],
      },
    };
  },
});
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
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem() { return null; } },
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
const clientSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString("base64")}`);
assert.equal(globalThis[clientSymbol]?.status, "ready");
assert.equal(globalThis[clientSymbol].implementationVersion, "1.0.14");
assert.equal(globalThis[clientSymbol].capabilities.has("client.bridge-first"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("generation.lifecycle"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("ui.agent-settings"), true);
assert.equal(globalThis[clientSymbol].capabilities.has("ui.tracker-section"), true);
assert.equal(typeof globalThis[clientSymbol].renderNativeTrackerSections, "function");
assert.equal(typeof customElements.get("marinara-capability-mari-bridge"), "function");
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
const clientSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "client-test",
  api: { major: 1, minMinor: 0 },
  require: ["generation.lifecycle"],
});
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
  require: ["commands", "quick-replies.input-macro", "ui.agent-settings", "ui.tracker-section"],
});
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
await featureSession.close();
assert.equal(trackerUiPublishes, 3);
unsubscribeTrackerUi();
globalThis.fetch = async (url) => {
  assert.equal(url, "/api/generate/dryRun");
  return new Response(
    [
      'data: {"type":"dryrun_started","data":{"runId":"run-1"}}\n\n',
      'data: {"type":"token","data":"Hello"}\n\n',
      'data: {"type":"token","data":" world"}\n\n',
      'data: {"type":"result","data":{"content":"Hello world"}}\n\n',
      'data: {"type":"done"}\n\n',
    ].join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
};
const draftSession = globalThis[clientSymbol].registerConsumer({
  consumerId: "draft-test",
  api: { major: 1, minMinor: 0 },
  require: ["generation.draft"],
});
const draftUpdates = [];
assert.equal(
  await draftSession.drafts.generate({
    chatId: "chat-1",
    body: { impersonate: true },
    onUpdate: (content) => draftUpdates.push(content),
  }),
  "Hello world",
);
assert.equal(draftUpdates.at(-1), "Hello world");
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
assert.match(patchedChatInput, /\.mari-chat-input textarea/u);
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
const chatSettingsFixture = [
  'react.jsxs("div",{"data-chat-agent-entry":agent.id,className:"one",children:[first]});',
  'react.jsxs("div",{"data-chat-agent-entry":other.id,className:"two",children:[second]});',
].join("");
const patchedChatSettings = patchChatSettingsBridge(chatSettingsFixture);
assert.equal((patchedChatSettings.match(/marinara-mari-bridge-agent-settings/gu) ?? []).length, 2);
assert.match(patchedChatSettings, /"agent-id":agent\.id/u);
const trackerPanelFixture = [
  'import{r as react,j as jsx}from"./vendor-react-test.js";',
  'import{S as SectionHeader,L as SectionIconButton,f as ReadabilityVeil,E as EmptySection}from"./world-custom-field-icons-test.js";',
  'function TrackerSectionList({activeChatId:chat,enabledAgentTypes:enabled,orderedTrackerSections:sections,deleteMode:deleting,addMode:adding}){const{rerunTracker:rerun,trackerRetryBusy:busy}=useRerun();const renderSection=section=>section;return jsx.jsxs(jsx.Fragment,{children:[jsx.jsx("input",{type:"file",accept:"image/*"}),sections.map(section=>renderSection(section))]})}',
  'function TrackerDataSidebar(){const[editMode,setEditMode]=react.useState(null),hasFixed=sections.length>0;return jsx.jsxs("section",{"data-component":"TrackerDataSidebar",children:[jsx.jsx(Header,{activeEditMode:editMode,onSetEditMode:setEditMode}),gameState&&hasFixed?jsx.jsx(Boundary,{children:jsx.jsx(TrackerSectionList,{activeChatId:chat,enabledAgentTypes:enabled,orderedTrackerSections:sections,deleteMode:deleting,addMode:adding})}):null,chat?hasFixed?null:jsx.jsx(EmptySection,{children:t("ui.trackerPanel.trackerdatasidebar.noEnabledTrackerPanels")}):null]})}',
].join("");
const patchedTrackerPanel = patchTrackerPanelBridge(trackerPanelFixture);
assert.match(patchedTrackerPanel, /renderNativeTrackerSections/u);
assert.match(patchedTrackerPanel, /mariBridgeEditMode:editMode/u);
assert.match(patchedTrackerPanel, /mariBridgeEditMode:mariBridgeEditMode,mariBridgeEmptyLabel:mariBridgeEmptyLabel,deleteMode:deleting/u);
assert.match(patchedTrackerPanel, /SectionHeader:SectionHeader/u);
assert.match(patchedTrackerPanel, /SectionIconButton:SectionIconButton/u);
assert.match(patchedTrackerPanel, /EmptySection:EmptySection/u);
assert.match(patchedTrackerPanel, /gameState&&\(hasFixed\|\|globalThis/u);
assert.equal(
  patchTrackerPanelBridge('const selector = \'[data-component="TrackerDataSidebarDesktop.right"]\';'),
  null,
);
const roleplayHudFixture = 'react.jsxs("div",{className:cn("rpg-hud","flex items-center"),children:[]})';
const patchedRoleplayHud = patchRoleplayHudBridge(roleplayHudFixture);
assert.match(patchedRoleplayHud, /mountNativeSlot\(Z,"roleplay\.hud"\)/u);
const roleplayBackgroundFixture = 'react.jsx(Fade,{url:bg,blurPx:blur});const later=enabled&&metadata.enableAgents&&active;const marker="rpg-chat-area mari-chat-area";';
const patchedRoleplayBackground = patchRoleplayBackgroundBridge(roleplayBackgroundFixture);
assert.match(patchedRoleplayBackground, /resolveBackgroundProps\(metadata,bg,blur\)/u);
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
await fs.writeFile(path.join(nativeAssetsRoot, "tracker-panel.js"), trackerPanelFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "roleplay-hud.js"), roleplayHudFixture);
await fs.writeFile(path.join(nativeAssetsRoot, "roleplay-background.js"), roleplayBackgroundFixture);
const preparedClientOverlay = await prepareClientOverlay({
  dataDir: path.join(clientOverlayFixtureRoot, "data"),
  sourceRoot: nativeClientRoot,
  engineVersion: "2.4.3",
});
const preparedOverlayIndex = await fs.readFile(path.join(preparedClientOverlay.root, "index.html"), "utf8");
const preparedOverlayMain = await fs.readFile(path.join(preparedClientOverlay.root, "assets", "index-main.js"), "utf8");
assert.match(preparedOverlayIndex, /index-main\.js\?mariBridge=[a-f0-9]{16}/u);
assert.doesNotMatch(preparedOverlayIndex, /mari-bridge-bootstrap/u);
assert.equal(preparedOverlayMain.startsWith("{\nconst API_VERSION = Object.freeze"), true);
assert.match(preparedOverlayMain, /implementationVersion: "1\.0\.14"/u);
assert.equal(
  preparedOverlayMain.indexOf("const API_VERSION") <
    preparedOverlayMain.indexOf('window.dispatchEvent(new CustomEvent("marinara:active-chat"'),
  true,
);

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
assert.equal(requiresBootstrapHandoff(null, true, "1.0.14"), false);
assert.equal(requiresBootstrapHandoff({ version: "1.0.14" }, false, "1.0.14"), false);
assert.equal(requiresBootstrapHandoff({ version: "1.0.13" }, false, "1.0.14"), true);
assert.equal(requiresBootstrapHandoff({ version: "1.0.14" }, true, "1.0.14"), true);
const kernelSymbol = Symbol.for("marinara.mari-bridge.kernel.v1");
globalThis[kernelSymbol] = { active: true };
const bootstrapResult = await schedulePackageBootstrapRestart({ dataDir: bootstrapFixtureRoot }, "unused.mjs");
assert.deepEqual(bootstrapResult, { scheduled: false, reason: "preload-active" });
const bootstrapAttempt = JSON.parse(
  await fs.readFile(path.join(bootstrapFixtureRoot, "mari-bridge", "bootstrap-attempt.json"), "utf8"),
);
assert.equal(bootstrapAttempt.attempts, 0);
assert.equal(bootstrapAttempt.status, "preload-active");
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
const bootstrapPatchSource = await fs.readFile(new URL("../bootstrap/register.mjs", import.meta.url), "utf8");
assert.match(bootstrapPatchSource, /prompt\.generate-fallback/u);
assert.match(bootstrapPatchSource, /prompt\.active-agents\.assembler/u);
assert.match(bootstrapPatchSource, /prompt\.active-agents\.context/u);
assert.match(bootstrapPatchSource, /prompt\.active-agents\.macro/u);
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
const { decodeModuleSource, patchCommittedTrackerActiveGuard, patchServerModule } = await import(
  new URL(`../bootstrap/register.mjs?check=${Date.now()}`, import.meta.url)
);
assert.equal(decodeModuleSource(new TextEncoder().encode("export const value = 1;")), "export const value = 1;");
const packageStartupFixture = `async start(app) {
        for (const runtimePackage of await capabilityPackageManager.runtimePackages()) {
            await this.activateOne(app, runtimePackage, true, false);
        }
    }`;
const patchedPackageStartup = patchServerModule(
  "file:///engine/capability-module-runtime.service.js",
  packageStartupFixture,
);
assert.match(patchedPackageStartup, /left\.installed\.id === "mari-bridge"/u);
assert.match(patchedPackageStartup, /installed\.status === "restart-required"/u);
assert.match(patchedPackageStartup, /markRuntimeStatus\(installed\.id, "active"\)/u);
assert.match(patchedPackageStartup, /bridgeStartupError/u);
assert.match(patchedPackageStartup, /startsWith\("Mari Bridge "\)/u);
assert.match(patchedPackageStartup, /this\.activateOne\(app, \{ installed \}, false, false\)/u);
assert.equal(globalThis[kernelSymbol].patches["packages.client-only-updates"], "applied");

const macroEngineFixture = `
function replaceBalancedMacros(input, replacer) {
  return input.replace(/\\{\\{([^{}]+)\\}\\}/g, (original, body) => replacer(body, original) ?? original);
}
export function resolveMacros(template, ctx) {
  let result = template;
  const resolveNestedFieldMacros = (value) => resolveMacros(value, ctx);
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
      activeAgents: ["gm-notes", "presence"],
      characterFields: { description: "Clue: {{outlet::clue}}" },
      outlets: { place: "the inn", clue: "the key is missing" },
    },
  ),
  "INDIVIDUAL|At the inn|gm-notes,presence|Clue: the key is missing",
);
assert.equal(
  patchedMacroEngine.resolveMacros("{{group_mode}}|{{group_scenario_override}}", {}),
  "SOLO|",
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
  activeAgentIds: [" gm-notes ", "gm-notes", "presence"],
  groupScenarioOverrideText: "Shared scenario",
  groupMode: "merged",
}), {
  timeZone: undefined,
  activeAgents: ["gm-notes", "presence"],
  groupScenarioOverride: "Shared scenario",
  groupMode: "MERGED",
});

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
assert.match(patchedAssemblerFixture, /mariBridgeNestedOutletSources/u);
assert.match(patchedAssemblerFixture, /mariBridgeSectionNeedsOutletScan\(section\)/u);
assert.match(patchedAssemblerFixture, /group_scenario_override/u);

const dryRunRouteFixture = [
  "            idleDuration: promptIdleDuration,",
  "        });",
  "        const historyMacroProfilesById = (await resolveCharacterMacroData(app.db, allCharacterIds)).profilesById;",
  "                idleDuration: promptIdleDuration,",
  "                impersonate,",
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
assert.match(patchedDryRunRouteFixture, /promptMacroContext\.outlets = assembled\.lorebookScanResult\?\.outlets/u);

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

const wrongVersionKernel = await runBootstrapFixture("2.4.4");
assert.equal(wrongVersionKernel.active, false);
assert.equal(wrongVersionKernel.engineCompatibility.compatible, false);
assert.equal(wrongVersionKernel.patches["engine.version"], "failed");
const failedPreflightKernel = await runBootstrapFixture("2.4.3");
assert.equal(failedPreflightKernel.active, false);
assert.equal(failedPreflightKernel.engineCompatibility.compatible, true);
assert.equal(failedPreflightKernel.patches["engine.preflight"], "failed");
console.log("Mari Bridge runtime checks passed.");
