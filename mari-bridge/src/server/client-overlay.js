import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN_MODULE_PATTERN = /<script\s+type="module"\s+crossorigin\s+src="([^"]+)"\s*><\/script>/gu;
const OVERLAY_FORMAT_VERSION = "mari-bridge-client-overlay-v10";
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
  const replacement = `${direct.groups.match}.command.execute(${direct.groups.match}.args,{...${direct.groups.context},setDraftGenerating:Z=>${restore.store}.getState().setStreaming(Boolean(Z),${restore.chatId}),setDraft:Z=>{const J=String(Z??"");${restore.setDraft}(${restore.chatId},J);if(${restore.store}.getState().activeChatId===${restore.chatId}){const T=${direct.groups.textarea}.current??document.querySelector(".mari-chat-input textarea");if(T){const V=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;V?V.call(T,J):T.value=J,T.dispatchEvent(new Event("input",{bubbles:!0})),${direct.groups.textarea}.current&&${sync}(J)}}}})`;
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
  if (!source.includes("data-chat-settings-section")) return null;
  const pattern = /(?<open>[A-Za-z_$][\w$]*&&)(?<jsx>[A-Za-z_$][\w$]*)\.jsx\("div",\{className:(?<cn>[A-Za-z_$][\w$]*)\("px-4 pb-3",(?<contentClass>[A-Za-z_$][\w$]*)\?\?"pt-3"\),children:(?<children>[A-Za-z_$][\w$]*)\}\)/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Mari Bridge chat-settings slot patch expected one section body, found ${matches.length}`);
  const componentStart = source.lastIndexOf("function ", matches[0].index);
  const componentPrefix = source.slice(componentStart, matches[0].index);
  const sectionId = componentPrefix.match(/\(\{id:(?<id>[A-Za-z_$][\w$]*)/u)?.groups?.id;
  if (!sectionId) throw new Error("Mari Bridge chat-settings slot patch could not identify the section id");
  return source.replace(pattern, (...args) => {
    const groups = args.at(-1);
    return `${groups.open}${groups.jsx}.jsxs("div",{className:${groups.cn}("px-4 pb-3",${groups.contentClass}??"pt-3"),children:[${groups.children},${sectionId}==="roleplay-agents"?${groups.jsx}.jsx("marinara-mari-bridge-slot",{name:"chat.settings"}):null]})`;
  });
}

export function patchTrackerPanelBridge(source) {
  if (!source.includes('"data-component":"TrackerDataSidebar"')) return null;
  const pattern = /(?<open>\{)(?<component>"data-component":"TrackerDataSidebar")/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge tracker-panel slot expected one TrackerDataSidebar root, found ${matches.length}`);
  }
  return source.replace(
    pattern,
    `${matches[0].groups.open}ref:Z=>${CLIENT_SYMBOL_EXPRESSION}?.mountNativeSlot(Z,"tracker.panel",{target:"content"}),${matches[0].groups.component}`,
  );
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
    `setAbortController:\\((?<chat>${identifier}),(?<controller>${identifier})\\)=>(?<set>${identifier})\\((?<state>${identifier})=>\\{const (?<map>${identifier})=new Map\\(\\k<state>\\.abortControllers\\);return \\k<controller>\\?\\k<map>\\.set\\(\\k<chat>,\\k<controller>\\):\\k<map>\\.delete\\(\\k<chat>\\),\\{abortControllers:\\k<map>\\}\\}\\)`,
    "gu",
  );
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Mari Bridge generation-controller patch expected one store action, found ${matches.length}`);
  }
  const { chat, controller } = matches[0].groups;
  return source.replace(
    pattern,
    `${matches[0][0].slice(0, matches[0][0].indexOf("=>") + 2)}(window.dispatchEvent(new CustomEvent("marinara:generation-controller",{detail:{chatId:${chat},active:!!${controller}}})),${matches[0][0].slice(matches[0][0].indexOf("=>") + 2)})`,
  );
}

export async function prepareClientOverlay({ dataDir, sourceRoot }) {
  if (!sourceRoot) throw new Error("Mari Bridge preload did not report the native client root");
  const indexPath = join(sourceRoot, "index.html");
  const index = await readFile(indexPath, "utf8");
  const overlayImplementation = await readFile(fileURLToPath(import.meta.url));
  const fingerprint = createHash("sha256")
    .update(OVERLAY_FORMAT_VERSION)
    .update("\0")
    .update(overlayImplementation)
    .update("\0")
    .update(index)
    .digest("hex")
    .slice(0, 16);
  const overlaysRoot = join(dataDir, "mari-bridge", "client");
  const target = join(overlaysRoot, fingerprint);
  const readyFile = join(target, ".mari-bridge-ready");
  try {
    await readFile(readyFile, "utf8");
    return { root: target, fingerprint, patches: ["client.active-chat", "client.command-drafts", "client.commands", "client.generation-lifecycle", "client.native-ui", "client.quick-replies", "client.tracker-panel", "client.roleplay-hud"] };
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
  const patchedMainModule = patchGenerationControllerEvents(
    patchActiveChatEvents(await readFile(mainModulePath, "utf8")),
  );
  await writeFile(mainModulePath, patchedMainModule);
  const assetsRoot = join(temporary, "assets");
  const assetEntries = await readdir(assetsRoot, { withFileTypes: true });
  const assetJavaScriptNames = assetEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name);
  let chatInputPatchCount = 0;
  let chatSettingsPatchCount = 0;
  let trackerPanelPatchCount = 0;
  let roleplayHudPatchCount = 0;
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
    if (changed) await writeFile(assetPath, assetSource);
  }
  if (chatInputPatchCount !== 2) throw new Error(`Mari Bridge expected two chat input assets, found ${chatInputPatchCount}`);
  if (chatSettingsPatchCount !== 1) throw new Error(`Mari Bridge expected one chat settings asset, found ${chatSettingsPatchCount}`);
  if (trackerPanelPatchCount !== 1) throw new Error(`Mari Bridge expected one Tracker panel asset, found ${trackerPanelPatchCount}`);
  if (roleplayHudPatchCount !== 1) throw new Error(`Mari Bridge expected one Roleplay HUD asset, found ${roleplayHudPatchCount}`);
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
  const bridgeBootstrapName = "mari-bridge-bootstrap.js";
  const versionedMainModule = `${mainModule}?mariBridge=${fingerprint}`;
  await writeFile(
    join(temporary, bridgeBootstrapName),
    [
      'await import("/api/capability-packages/mari-bridge/client?preload=1");',
      `await import(${JSON.stringify(versionedMainModule)});`,
      "",
    ].join("\n"),
  );
  await writeFile(
    copiedIndexPath,
    versionAssetReferences(
      copiedIndex.replace(matches[0][0], `<script type="module" crossorigin src="/${bridgeBootstrapName}"></script>`),
      assetJavaScriptNames,
      fingerprint,
    ),
  );
  await writeFile(join(temporary, ".mari-bridge-ready"), `${fingerprint}\n`);
  await rm(target, { recursive: true, force: true });
  await rename(temporary, target);
  return { root: target, fingerprint, patches: ["client.active-chat", "client.command-drafts", "client.commands", "client.generation-lifecycle", "client.native-ui", "client.quick-replies", "client.tracker-panel", "client.roleplay-hud"] };
}
