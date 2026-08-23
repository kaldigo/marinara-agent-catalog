import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN_MODULE_PATTERN = /<script\s+type="module"\s+crossorigin\s+src="([^"]+)"\s*><\/script>/gu;
const OVERLAY_FORMAT_VERSION = "mari-bridge-client-overlay-v15";
const CLIENT_SYMBOL_EXPRESSION = 'globalThis[Symbol.for("marinara.mari-bridge.client.v1")]';

export function versionAssetReferences(source, assetNames, fingerprint) {
  return assetNames.reduce(
    (result, name) => result.replaceAll(name, `${name}?mariBridge=${fingerprint}`),
    source,
  );
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function patchChatInputBridge(source) {
  if (!source.includes("Send a saved custom quick reply")) return null;
  const matcherSites = [...source.matchAll(/const [A-Za-z_$][\w$]*=(?<matcher>[A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*,\{mode:/gu)];
  const counts = new Map();
  for (const site of matcherSites) counts.set(site.groups.matcher, (counts.get(site.groups.matcher) ?? 0) + 1);
  const matcher = matcherSites[0]?.groups?.matcher;
  if (!matcher) throw new Error("Mari Bridge command patch could not identify the native matcher");
  const matcherPattern = new RegExp(`(?<![\\w$.])${escapePattern(matcher)}\\((?<raw>[A-Za-z_$][\\w$]*),(?<options>\\{mode:[^{}]+\\})\\)`, "gu");
  let commandCount = 0;
  let patched = source.replace(matcherPattern, (...args) => {
    const groups = args.at(-1);
    commandCount += 1;
    return `(${CLIENT_SYMBOL_EXPRESSION}?.matchCommand(${groups.raw},${groups.options})??${matcher}(${groups.raw},${groups.options}))`;
  });
  if (commandCount !== 2) throw new Error(`Mari Bridge command patch expected two match sites, found ${commandCount}`);

  if (patched.includes("clearOrSendAttachmentsBeforeUsingQuickImpersonate")) {
    patched = patchRoleplayCommandDraftWriter(patched);
  }

  const quickReplyPattern = /(?<prefix>[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\.useCallback\(async (?<content>[A-Za-z_$][\w$]*)=>\{const (?<element>[A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.current;[^{}]{0,180}?\|\|\()(?<assignment>\k<element>\.value=\k<content>),/gu;
  let macroCount = 0;
  patched = patched.replace(quickReplyPattern, (...args) => {
    const groups = args.at(-1);
    macroCount += 1;
    return `${groups.prefix}${groups.content}=${CLIENT_SYMBOL_EXPRESSION}?.resolveQuickReply(${groups.content},${groups.element}.value)??${groups.content},${groups.element}.value=${groups.content},`;
  });
  if (macroCount !== 1) throw new Error(`Mari Bridge Quick Reply patch expected one handler, found ${macroCount}`);

  const composerRootPattern = /(?<jsx>[A-Za-z_$][\w$]*\.jsxs\("div",\{className:"mari-chat-input chat-input-container [^"]+",children:\[)/gu;
  const roots = [...patched.matchAll(composerRootPattern)];
  if (roots.length !== 1) throw new Error(`Mari Bridge composer slot patch expected one expanded input root, found ${roots.length}`);
  patched = patched.replace(
    composerRootPattern,
    (...args) => {
      const groups = args.at(-1);
      const jsxRuntime = groups.jsx.match(/^[A-Za-z_$][\w$]*/u)?.[0];
      return `${groups.jsx}${jsxRuntime}.jsx("marinara-mari-bridge-slot",{name:"composer.above-input"}),`;
    },
  );
  return patched;
}

export function patchSlashCommandListBridge(source) {
  if (!source.includes("Show available slash commands")) return null;
  const identifier = "[A-Za-z_$][\\w$]*";
  const pattern = new RegExp(
    `function (?<fn>${identifier})\\((?<availability>${identifier})=\\{\\}\\)\\{return\\[\\.\\.\\.(?<native>${identifier}),\\.\\.\\.(?<games>${identifier})\\(\\k<availability>\\.conversationGames\\)\\]\\.filter\\((?<command>${identifier})=>(?<available>${identifier})\\(\\k<command>,\\k<availability>\\)\\)\\}`,
    "gu",
  );
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge slash command list patch expected one registry builder, found ${matches.length}`);
  }
  return source.replace(pattern, (...args) => {
    const groups = args.at(-1);
    return `function ${groups.fn}(${groups.availability}={}){return[...${groups.native},...${groups.games}(${groups.availability}.conversationGames),...(${CLIENT_SYMBOL_EXPRESSION}?.listCommands(${groups.availability})??[])].filter(${groups.command}=>${groups.available}(${groups.command},${groups.availability}))}`;
  });
}

function patchRoleplayCommandDraftWriter(source) {
  const marker = ".command.execute(";
  const callIndex = source.indexOf(marker);
  if (callIndex < 0) throw new Error("Mari Bridge draft writer could not find the Roleplay command execution site");
  const before = source.slice(Math.max(0, callIndex - 1400), callIndex);
  const after = source.slice(callIndex, callIndex + 1500);
  const direct = before.match(/if\((?<match>[A-Za-z_$][\w$]*)\)\{const (?<context>[A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\(\);if\(!\k<context>\)return;const (?<submitted>[A-Za-z_$][\w$]*)=(?<textarea>[A-Za-z_$][\w$]*)\.current\?\.value\?\?""/u);
  if (!direct?.groups) throw new Error("Mari Bridge draft writer could not identify the direct Roleplay command context");
  const syncPattern = new RegExp(`${escapePattern(direct.groups.textarea)}\\.current&&\\(${escapePattern(direct.groups.textarea)}\\.current\\.value="",${escapePattern(direct.groups.textarea)}\\.current\\.style\\.height="auto"\\),(?<sync>[A-Za-z_$][\\w$]*)\\(""\\)`, "u");
  const sync = before.match(syncPattern)?.groups?.sync;
  const restore = after.match(/catch\([A-Za-z_$][\w$]*\)\{const [A-Za-z_$][\w$]*=(?<store>[A-Za-z_$][\w$]*)\.getState\(\)\.activeChatId[\s\S]{0,700}?&&(?<setDraft>[A-Za-z_$][\w$]*)\((?<chatId>[A-Za-z_$][\w$]*),(?<submitted>[A-Za-z_$][\w$]*)\)/u)?.groups;
  if (!sync || !restore || restore.submitted !== direct.groups.submitted) {
    throw new Error("Mari Bridge draft writer could not identify native Roleplay draft actions");
  }
  const original = `${direct.groups.match}.command.execute(${direct.groups.match}.args,${direct.groups.context})`;
  const replacement = `${direct.groups.match}.command.execute(${direct.groups.match}.args,{...${direct.groups.context},setDraftGenerating:mariBridgeGenerating=>${restore.store}.getState().setStreaming(Boolean(mariBridgeGenerating),${restore.chatId}),setDraft:mariBridgeValue=>{const mariBridgeDraftText=String(mariBridgeValue??"");${restore.setDraft}(${restore.chatId},mariBridgeDraftText);if(${restore.store}.getState().activeChatId===${restore.chatId}){const mariBridgeTextarea=${direct.groups.textarea}.current??document.querySelector(".mari-chat-input textarea");if(mariBridgeTextarea){const mariBridgeValueSetter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;mariBridgeValueSetter?mariBridgeValueSetter.call(mariBridgeTextarea,mariBridgeDraftText):mariBridgeTextarea.value=mariBridgeDraftText,mariBridgeTextarea.dispatchEvent(new Event("input",{bubbles:!0})),${direct.groups.textarea}.current&&${sync}(mariBridgeDraftText)}}}})`;
  const exactIndex = source.indexOf(original, callIndex - direct.groups.match.length);
  if (exactIndex < 0) throw new Error("Mari Bridge draft writer could not replace the Roleplay command context");
  let result = `${source.slice(0, exactIndex)}${replacement}${source.slice(exactIndex + original.length)}`;
  const nativeStop = `${restore.store}.getState().stopGeneration(${restore.chatId}??void 0)`;
  const stopMatches = result.split(nativeStop).length - 1;
  if (stopMatches !== 1) throw new Error(`Mari Bridge native Stop patch expected one Roleplay stop action, found ${stopMatches}`);
  result = result.replace(nativeStop, `${CLIENT_SYMBOL_EXPRESSION}?.stopDraft(${restore.chatId})||${nativeStop}`);
  return result;
}

export function patchChatSettingsBridge(source) {
  if (!source.includes("data-chat-agent-entry")) return null;
  const pattern = /(?<jsx>[A-Za-z_$][\w$]*)\.jsxs\("div",\{(?<props>[^{}]{0,1400}?"data-chat-agent-entry":(?<agent>[A-Za-z_$][\w$]*)\.id[^{}]{0,1400}?),children:\[/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 2) {
    throw new Error(`Mari Bridge native agent-settings patch expected two generic agent cards, found ${matches.length}`);
  }
  const insertions = matches.map((match) => {
    const childrenStart = match.index + match[0].length - 1;
    const childrenEnd = findMatchingDelimiter(source, childrenStart, "[", "]");
    const prefix = source.slice(Math.max(0, match.index - 900), match.index);
    const activePattern = new RegExp(
      `const (?<active>[A-Za-z_$][\\w$]*)=[A-Za-z_$][\\w$]*\\.includes\\(${escapePattern(match.groups.agent)}\\.id\\)`,
      "gu",
    );
    const activeMatches = [...prefix.matchAll(activePattern)];
    const active = activeMatches.at(-1)?.groups?.active;
    const expression = `${match.groups.jsx}.jsx("marinara-mari-bridge-agent-settings",{"agent-id":${match.groups.agent}.id})`;
    return { index: childrenEnd, text: `,${active ? `${active}&&` : ""}${expression}` };
  });
  let patched = source;
  for (const insertion of insertions.sort((left, right) => right.index - left.index)) {
    patched = `${patched.slice(0, insertion.index)}${insertion.text}${patched.slice(insertion.index)}`;
  }
  return patched;
}

function findMatchingDelimiter(source, start, open, close) {
  if (source[start] !== open) throw new Error(`Mari Bridge delimiter scan expected ${open}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  throw new Error(`Mari Bridge delimiter scan did not find ${close}`);
}

export function patchTrackerPanelBridge(source) {
  if (!source.includes('"data-component":"TrackerDataSidebar"') || !source.includes('accept:"image/*"')) return null;
  const identifier = "[A-Za-z_$][\\w$]*";
  const listPattern = new RegExp(
    `function (?<component>${identifier})\\(\\{(?<parameters>[^{}]*?activeChatId:(?<activeChat>${identifier})[^{}]*?enabledAgentTypes:(?<enabledAgents>${identifier})[^{}]*?orderedTrackerSections:(?<sections>${identifier})[^{}]*?deleteMode:(?<deleteMode>${identifier}),addMode:(?<addMode>${identifier})[^{}]*?)\\}\\)\\{`,
    "gu",
  );
  const listMatches = [...source.matchAll(listPattern)];
  if (listMatches.length !== 1) {
    throw new Error(`Mari Bridge tracker-section patch expected one TrackerSectionList component, found ${listMatches.length}`);
  }
  const list = listMatches[0];
  const bodyStart = list.index + list[0].length - 1;
  const bodyEnd = findMatchingDelimiter(source, bodyStart, "{", "}");
  const body = source.slice(bodyStart, bodyEnd + 1);
  const rerun = body.match(
    new RegExp(`\\{rerunTracker:(?<rerun>${identifier}),trackerRetryBusy:(?<busy>${identifier})\\}=${identifier}\\(`, "u"),
  )?.groups;
  if (!rerun) throw new Error("Mari Bridge tracker-section patch could not identify native rerun state");
  const mapPattern = new RegExp(
    `${escapePattern(list.groups.sections)}\\.map\\((?<item>${identifier})=>(?<render>${identifier})\\(\\k<item>\\)\\)`,
    "gu",
  );
  const mapMatches = [...body.matchAll(mapPattern)];
  if (mapMatches.length !== 1) {
    throw new Error(`Mari Bridge tracker-section patch expected one native section map, found ${mapMatches.length}`);
  }
  const react = findNamedImportAlias(source, "vendor-react-", "r");
  const jsx = findNamedImportAlias(source, "vendor-react-", "j");
  const sectionHeader = findNamedImportAlias(source, "world-custom-field-icons-", "S");
  const sectionIconButton = findNamedImportAlias(source, "world-custom-field-icons-", "L");
  const readabilityVeil = findNamedImportAlias(source, "world-custom-field-icons-", "f");
  const emptySection = findNamedImportAlias(source, "world-custom-field-icons-", "E");
  const emptyPattern = new RegExp(
    `(?<hasFixed>${identifier})\\?null:${escapePattern(jsx)}\\.jsx\\((?<empty>${identifier}),\\{children:(?<localize>${identifier})\\("ui\\.trackerPanel\\.trackerdatasidebar\\.noEnabledTrackerPanels"\\)\\}\\)`,
    "gu",
  );
  const emptyMatches = [...source.matchAll(emptyPattern)];
  if (emptyMatches.length !== 1 || emptyMatches[0].groups.empty !== emptySection) {
    throw new Error(`Mari Bridge tracker-section patch expected one native empty state, found ${emptyMatches.length}`);
  }
  const empty = emptyMatches[0];
  const renderGuardPattern = new RegExp(
    `(?<gameState>${identifier})&&${escapePattern(empty.groups.hasFixed)}\\?${escapePattern(jsx)}\\.jsx\\(`,
    "gu",
  );
  const renderGuardMatches = [...source.matchAll(renderGuardPattern)];
  if (renderGuardMatches.length !== 1) {
    throw new Error(`Mari Bridge tracker-section patch expected one TrackerSectionList guard, found ${renderGuardMatches.length}`);
  }
  const nativeMap = mapMatches[0][0];
  const bridgeMap = `(${CLIENT_SYMBOL_EXPRESSION}?.renderNativeTrackerSections({react:${react},jsx:${jsx},native:{SectionHeader:${sectionHeader},SectionIconButton:${sectionIconButton},TrackerReadabilityVeil:${readabilityVeil},EmptySection:${emptySection}},sections:${list.groups.sections},renderSection:${mapMatches[0].groups.render},context:{activeChatId:${list.groups.activeChat},enabledAgentTypes:${list.groups.enabledAgents},rerunTracker:${rerun.rerun},retryBusy:${rerun.busy},editMode:mariBridgeEditMode,emptyLabel:mariBridgeEmptyLabel,nativeSectionCount:${list.groups.sections}.length}})??${nativeMap})`;

  const callPattern = new RegExp(`${escapePattern(jsx)}\\.jsx\\(${escapePattern(list.groups.component)},\\{`, "gu");
  const callMatches = [...source.matchAll(callPattern)];
  if (callMatches.length !== 1) {
    throw new Error(`Mari Bridge tracker-section patch expected one TrackerSectionList render, found ${callMatches.length}`);
  }
  const call = callMatches[0];
  const propsStart = call.index + call[0].length - 1;
  const propsEnd = findMatchingDelimiter(source, propsStart, "{", "}");
  const callPrefix = source.slice(Math.max(0, call.index - 2_500), call.index);
  const editModeMatches = [...callPrefix.matchAll(new RegExp(`activeEditMode:(?<editMode>${identifier}),onSetEditMode:`, "gu"))];
  const editMode = editModeMatches.at(-1)?.groups?.editMode;
  if (!editMode) throw new Error("Mari Bridge tracker-section patch could not identify native tracker edit mode");

  const insertions = [
    {
      index: propsEnd,
      text: `,mariBridgeEditMode:${editMode},mariBridgeEmptyLabel:${empty.groups.localize}("ui.trackerPanel.trackerdatasidebar.noEnabledTrackerPanels")`,
    },
  ];
  let patched = source;
  for (const insertion of insertions.sort((left, right) => right.index - left.index)) {
    patched = `${patched.slice(0, insertion.index)}${insertion.text}${patched.slice(insertion.index)}`;
  }
  patched = patched.replace(list[0], list[0].replace(
    `deleteMode:${list.groups.deleteMode}`,
    `mariBridgeEditMode:mariBridgeEditMode,mariBridgeEmptyLabel:mariBridgeEmptyLabel,deleteMode:${list.groups.deleteMode}`,
  ));
  patched = patched.replace(nativeMap, bridgeMap);
  patched = patched.replace(
    renderGuardMatches[0][0],
    `${renderGuardMatches[0].groups.gameState}&&(${empty.groups.hasFixed}||${CLIENT_SYMBOL_EXPRESSION})?${jsx}.jsx(`,
  );
  patched = patched.replace(
    empty[0],
    empty[0].replace(`${empty.groups.hasFixed}?null`, `(${empty.groups.hasFixed}||${CLIENT_SYMBOL_EXPRESSION})?null`),
  );
  return patched;
}

export function patchAgentSuiteBridge(source) {
  if (
    !source.includes('"agent-suite","game-state"')
    || !source.includes('"No tracker snapshot to update"')
    || !source.includes('"ui.chat.agentsuitemodal.trackerData"')
  ) return null;
  const identifier = "[A-Za-z_$][\\w$]*";
  const componentPattern = new RegExp(
    `function (?<component>${identifier})\\(\\{chat:(?<chat>${identifier}),open:(?<open>${identifier}),onClose:(?<close>${identifier}),onCloseGuardChange:(?<guard>${identifier}),agents:(?<agents>${identifier})\\}\\)\\{`,
    "gu",
  );
  const componentMatches = [...source.matchAll(componentPattern)];
  if (componentMatches.length !== 1) {
    throw new Error(`Mari Bridge Agent Suite patch expected one modal component, found ${componentMatches.length}`);
  }
  const component = componentMatches[0];
  const bodyStart = component.index + component[0].length - 1;
  const bodyEnd = findMatchingDelimiter(source, bodyStart, "{", "}");
  const body = source.slice(bodyStart, bodyEnd + 1);
  const trackerFlagPattern = new RegExp(
    `!!(?<selected>${identifier})&&!!(?<registry>${identifier})\\[\\k<selected>\\.id\\]`,
    "gu",
  );
  const trackerFlagMatches = [...body.matchAll(trackerFlagPattern)];
  if (trackerFlagMatches.length !== 1) {
    throw new Error(`Mari Bridge Agent Suite patch expected one tracker-agent lookup, found ${trackerFlagMatches.length}`);
  }
  const tracker = trackerFlagMatches[0];
  const trackerSlicePattern = new RegExp(
    `(?<slice>${identifier})=${escapePattern(tracker.groups.selected)}\\?${escapePattern(tracker.groups.registry)}\\[${escapePattern(tracker.groups.selected)}\\.id\\]:void 0`,
    "gu",
  );
  const trackerSliceMatches = [...body.matchAll(trackerSlicePattern)];
  if (trackerSliceMatches.length !== 1) {
    throw new Error(`Mari Bridge Agent Suite patch expected one selected tracker slice, found ${trackerSliceMatches.length}`);
  }
  const savePattern = new RegExp(
    `const (?<savedSlice>${identifier})=${escapePattern(tracker.groups.registry)}\\[(?<agentId>${identifier})\\];if\\(!\\k<savedSlice>\\)throw new Error\\("No tracker snapshot to update"\\)`,
    "gu",
  );
  const saveMatches = [...body.matchAll(savePattern)];
  if (saveMatches.length !== 1) {
    throw new Error(`Mari Bridge Agent Suite patch expected one tracker save lookup, found ${saveMatches.length}`);
  }
  const react = findNamedImportAlias(source, "vendor-react-", "r");
  let patchedBody = body;
  patchedBody = patchedBody.replace(
    tracker[0],
    `!!${tracker.groups.selected}&&!!(${CLIENT_SYMBOL_EXPRESSION}?.resolveAgentSuiteTrackerSlice(${tracker.groups.selected}.id)??${tracker.groups.registry}[${tracker.groups.selected}.id])`,
  );
  patchedBody = patchedBody.replace(
    trackerSliceMatches[0][0],
    `${trackerSliceMatches[0].groups.slice}=${tracker.groups.selected}?(${CLIENT_SYMBOL_EXPRESSION}?.resolveAgentSuiteTrackerSlice(${tracker.groups.selected}.id)??${tracker.groups.registry}[${tracker.groups.selected}.id]):void 0`,
  );
  patchedBody = patchedBody.replace(
    saveMatches[0][0],
    `const ${saveMatches[0].groups.savedSlice}=${CLIENT_SYMBOL_EXPRESSION}?.resolveAgentSuiteTrackerSlice(${saveMatches[0].groups.agentId})??${tracker.groups.registry}[${saveMatches[0].groups.agentId}];if(!${saveMatches[0].groups.savedSlice})throw new Error("No tracker snapshot to update")`,
  );
  patchedBody = `{${CLIENT_SYMBOL_EXPRESSION}?.useAgentSuiteTrackerData(${react});${patchedBody.slice(1)}`;
  return `${source.slice(0, bodyStart)}${patchedBody}${source.slice(bodyEnd + 1)}`;
}

function findNamedImportAlias(source, moduleMarker, exportedName) {
  const pattern = new RegExp(`import\\{(?<specifiers>[^}]+)\\}from"[^"]*${escapePattern(moduleMarker)}[^"]*"`, "gu");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge native import patch expected one ${moduleMarker} module, found ${matches.length}`);
  }
  for (const specifier of matches[0].groups.specifiers.split(",")) {
    const parsed = specifier.trim().match(/^(?<exported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/u)?.groups;
    if (parsed?.exported === exportedName) return parsed.local ?? parsed.exported;
  }
  throw new Error(`Mari Bridge native import patch could not find export ${exportedName} from ${moduleMarker}`);
}

export function patchRoleplayHudBridge(source) {
  if (!source.includes('"rpg-hud"')) return null;
  const pattern = /(?<jsx>[A-Za-z_$][\w$]*\.jsx(?:s)?)\("div",\{className:(?<cn>[A-Za-z_$][\w$]*)\("rpg-hud",/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge Roleplay HUD slot expected one rpg-hud root, found ${matches.length}`);
  }
  return source.replace(
    pattern,
    `${matches[0].groups.jsx}("div",{ref:Z=>${CLIENT_SYMBOL_EXPRESSION}?.mountNativeSlot(Z,"roleplay.hud"),className:${matches[0].groups.cn}("rpg-hud",`,
  );
}

export function patchRoleplayBackgroundBridge(source) {
  if (!source.includes('"rpg-chat-area mari-chat-area')) return null;
  const pattern = /(?<jsx>[A-Za-z_$][\w$]*)\.jsx\((?<component>[A-Za-z_$][\w$]*),\{url:(?<url>[A-Za-z_$][\w$]*),blurPx:(?<blur>[A-Za-z_$][\w$]*)\}\)/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge Roleplay background patch expected one native background render, found ${matches.length}`);
  }
  const match = matches[0];
  const after = source.slice(match.index + match[0].length, match.index + match[0].length + 6_000);
  const metadata = after.match(/[A-Za-z_$][\w$]*&&(?<metadata>[A-Za-z_$][\w$]*)\.enableAgents&&/u)?.groups?.metadata;
  if (!metadata) throw new Error("Mari Bridge Roleplay background patch could not identify chat metadata");
  const { jsx, component, url, blur } = match.groups;
  return source.replace(
    pattern,
    `${jsx}.jsx(${component},{...(${CLIENT_SYMBOL_EXPRESSION}?.resolveBackgroundProps(${metadata},${url},${blur})??{url:${url},blurPx:${blur}})})`,
  );
}

export function patchActiveChatEvents(source) {
  const keyMatches = [...source.matchAll(/(?<key>[A-Za-z_$][\w$]*)="marinara-active-chat-id"/gu)];
  if (keyMatches.length !== 1) {
    throw new Error(`Mari Bridge active-chat patch expected one storage key, found ${keyMatches.length}`);
  }
  const key = keyMatches[0].groups.key;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const persistencePattern = new RegExp(
    `try\\{(?<chat>[A-Za-z_$][\\w$]*)\\?localStorage\\.setItem\\(${escapedKey},\\k<chat>\\):localStorage\\.removeItem\\(${escapedKey}\\)\\}catch\\{\\}`,
    "gu",
  );
  const matches = [...source.matchAll(persistencePattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge active-chat patch expected one persistence site, found ${matches.length}`);
  }
  const chat = matches[0].groups.chat;
  return source.replace(
    persistencePattern,
    `${matches[0][0]};window.dispatchEvent(new CustomEvent("marinara:active-chat",{detail:{chatId:${chat}??null}}))`,
  );
}

export function patchGenerationControllerEvents(source) {
  const identifier = "[A-Za-z_$][\\w$]*";
  const pattern = new RegExp(
    `setAbortController:\\((?<chat>${identifier}),(?<controller>${identifier})\\)=>(?<set>${identifier})\\(`,
    "gu",
  );
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge generation-controller patch expected one store action, found ${matches.length}`);
  }
  const { chat, controller, set } = matches[0].groups;
  return source.replace(
    pattern,
    `setAbortController:(${chat},${controller})=>(window.dispatchEvent(new CustomEvent("marinara:generation-controller",{detail:{chatId:${chat},active:!!${controller}}})),${set})(`,
  );
}

async function persistClientOverlayPointer(dataDir, root, fingerprint, engineVersion) {
  await writeFile(
    join(dataDir, "mari-bridge", "client-current.json"),
    `${JSON.stringify({ schemaVersion: 1, root, fingerprint, engineVersion }, null, 2)}\n`,
  );
}

export async function prepareClientOverlay({ dataDir, sourceRoot, engineVersion }) {
  if (!sourceRoot) throw new Error("Mari Bridge preload did not report the native client root");
  const indexPath = join(sourceRoot, "index.html");
  const index = await readFile(indexPath, "utf8");
  const overlayImplementation = await readFile(fileURLToPath(import.meta.url));
  const bridgeClientRuntime = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "client", "runtime.js"), "utf8");
  const fingerprint = createHash("sha256")
    .update(OVERLAY_FORMAT_VERSION)
    .update("\0")
    .update(overlayImplementation)
    .update("\0")
    .update(bridgeClientRuntime)
    .update("\0")
    .update(index)
    .digest("hex")
    .slice(0, 16);
  const overlaysRoot = join(dataDir, "mari-bridge", "client");
  const target = join(overlaysRoot, fingerprint);
  const readyFile = join(target, ".mari-bridge-ready");
  try {
    await readFile(readyFile, "utf8");
    await persistClientOverlayPointer(dataDir, target, fingerprint, engineVersion);
    return { root: target, fingerprint, patches: ["client.active-chat", "client.agent-suite-tracker-data", "client.command-drafts", "client.commands", "client.generation-lifecycle", "client.native-agent-settings", "client.quick-replies", "client.tracker-sections", "client.roleplay-hud", "client.roleplay-background"] };
  } catch {
    // Build below.
  }
  const temporary = join(overlaysRoot, `.building-${process.pid}-${Date.now()}`);
  await mkdir(dirname(temporary), { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await cp(sourceRoot, temporary, { recursive: true, force: true });
  const copiedIndexPath = join(temporary, "index.html");
  const copiedIndex = await readFile(copiedIndexPath, "utf8");
  const matches = [...copiedIndex.matchAll(MAIN_MODULE_PATTERN)];
  if (matches.length !== 1) throw new Error(`Mari Bridge client overlay expected one main module, found ${matches.length}`);
  const mainModule = matches[0][1];
  const mainModulePath = join(temporary, mainModule.replace(/^\/+|[?#].*$/gu, ""));
  const patchedNativeMainModule = patchGenerationControllerEvents(
    patchActiveChatEvents(await readFile(mainModulePath, "utf8")),
  );
  // The client runtime is part of Marinara's patched main module, not a
  // separately loaded package or bootstrap dependency. Native capability
  // loading therefore cannot begin until the bridge symbol is ready.
  const patchedMainModule = ["{", bridgeClientRuntime, "}", patchedNativeMainModule, ""].join("\n");
  await writeFile(mainModulePath, patchedMainModule);
  const assetsRoot = join(temporary, "assets");
  const assetEntries = await readdir(assetsRoot, { withFileTypes: true });
  const assetJavaScriptNames = assetEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name);
  let chatInputPatchCount = 0;
  let chatSettingsPatchCount = 0;
  let agentSuitePatchCount = 0;
  let slashCommandListPatchCount = 0;
  let trackerPanelPatchCount = 0;
  let roleplayHudPatchCount = 0;
  let roleplayBackgroundPatchCount = 0;
  for (const entry of assetEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const assetPath = join(assetsRoot, entry.name);
    let assetSource = await readFile(assetPath, "utf8");
    let changed = false;
    const chatInputPatched = patchChatInputBridge(assetSource);
    if (chatInputPatched !== null) {
      assetSource = chatInputPatched;
      chatInputPatchCount += 1;
      changed = true;
    }
    const chatSettingsPatched = patchChatSettingsBridge(assetSource);
    if (chatSettingsPatched !== null) {
      assetSource = chatSettingsPatched;
      chatSettingsPatchCount += 1;
      changed = true;
    }
    const agentSuitePatched = patchAgentSuiteBridge(assetSource);
    if (agentSuitePatched !== null) {
      assetSource = agentSuitePatched;
      agentSuitePatchCount += 1;
      changed = true;
    }
    const slashCommandListPatched = patchSlashCommandListBridge(assetSource);
    if (slashCommandListPatched !== null) {
      assetSource = slashCommandListPatched;
      slashCommandListPatchCount += 1;
      changed = true;
    }
    const trackerPanelPatched = patchTrackerPanelBridge(assetSource);
    if (trackerPanelPatched !== null) {
      assetSource = trackerPanelPatched;
      trackerPanelPatchCount += 1;
      changed = true;
    }
    const roleplayHudPatched = patchRoleplayHudBridge(assetSource);
    if (roleplayHudPatched !== null) {
      assetSource = roleplayHudPatched;
      roleplayHudPatchCount += 1;
      changed = true;
    }
    const roleplayBackgroundPatched = patchRoleplayBackgroundBridge(assetSource);
    if (roleplayBackgroundPatched !== null) {
      assetSource = roleplayBackgroundPatched;
      roleplayBackgroundPatchCount += 1;
      changed = true;
    }
    if (changed) await writeFile(assetPath, assetSource);
  }
  if (chatInputPatchCount !== 2) throw new Error(`Mari Bridge expected two chat input assets, found ${chatInputPatchCount}`);
  if (chatSettingsPatchCount !== 1) throw new Error(`Mari Bridge expected one chat settings asset, found ${chatSettingsPatchCount}`);
  if (agentSuitePatchCount !== 1) throw new Error(`Mari Bridge expected one Agent Suite asset, found ${agentSuitePatchCount}`);
  if (slashCommandListPatchCount !== 1) throw new Error(`Mari Bridge expected one slash command list asset, found ${slashCommandListPatchCount}`);
  if (trackerPanelPatchCount !== 1) throw new Error(`Mari Bridge expected one Tracker panel asset, found ${trackerPanelPatchCount}`);
  if (roleplayHudPatchCount !== 1) throw new Error(`Mari Bridge expected one Roleplay HUD asset, found ${roleplayHudPatchCount}`);
  if (roleplayBackgroundPatchCount !== 1) throw new Error(`Mari Bridge expected one Roleplay background asset, found ${roleplayBackgroundPatchCount}`);
  for (const name of assetJavaScriptNames) {
    const assetPath = join(assetsRoot, name);
    await writeFile(assetPath, versionAssetReferences(await readFile(assetPath, "utf8"), assetJavaScriptNames, fingerprint));
  }
  const serviceWorkerPath = join(temporary, "sw.js");
  try {
    await writeFile(serviceWorkerPath, versionAssetReferences(await readFile(serviceWorkerPath, "utf8"), assetJavaScriptNames, fingerprint));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFile(
    copiedIndexPath,
    versionAssetReferences(copiedIndex, assetJavaScriptNames, fingerprint),
  );
  await writeFile(join(temporary, ".mari-bridge-ready"), `${fingerprint}\n`);
  await rm(target, { recursive: true, force: true });
  await rename(temporary, target);
  await persistClientOverlayPointer(dataDir, target, fingerprint, engineVersion);
  return { root: target, fingerprint, patches: ["client.active-chat", "client.agent-suite-tracker-data", "client.command-drafts", "client.commands", "client.generation-lifecycle", "client.native-agent-settings", "client.quick-replies", "client.tracker-sections", "client.roleplay-hud", "client.roleplay-background"] };
}
