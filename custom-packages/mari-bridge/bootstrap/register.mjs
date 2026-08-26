import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createBridgeRuntime } from "../src/server/runtime.js";
import { createPromptRegistry } from "../src/server/prompt-registry.js";
import { createAgentResultRegistry } from "../src/server/result-registry.js";
import { createTrackerContextRegistry } from "../src/server/tracker-context-registry.js";
import { createGroupSelectorRegistry } from "../src/server/group-selector-registry.js";
import { createTurnHandoffRegistry } from "../src/server/turn-handoff-registry.js";
import { createHostLifecycleRegistry } from "../src/server/host-lifecycle-registry.js";
import { prepareClientOverlay } from "../src/server/client-overlay.js";

const KERNEL_SYMBOL = Symbol.for("marinara.mari-bridge.kernel.v1");
const SERVER_SYMBOL = Symbol.for("marinara.mari-bridge.v1");
export const SUPPORTED_ENGINE_VERSIONS = Object.freeze(["2.4.4"]);
const disabled = process.env.MARI_BRIDGE_DISABLE === "1";

export function detectMarinaraEngine(entry = process.argv[1], cwd = process.cwd()) {
  const candidates = [
    entry ? resolve(dirname(resolve(cwd, entry)), "..", "..", "..", "package.json") : "",
    resolve(cwd, "package.json"),
  ].filter(Boolean);
  for (const packagePath of [...new Set(candidates)]) {
    try {
      const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
      if (manifest?.name === "marinara-engine" && typeof manifest.version === "string") {
        return Object.freeze({ root: dirname(packagePath), version: manifest.version });
      }
    } catch {
      // Try the next deterministic location.
    }
  }
  return Object.freeze({ root: null, version: null });
}

const detectedEngine = detectMarinaraEngine();
const engineCompatible = SUPPORTED_ENGINE_VERSIONS.includes(detectedEngine.version);
const kernel = globalThis[KERNEL_SYMBOL] ?? {
  active: false,
  patches: {},
  failures: [],
};
kernel.version = "1.0.25";
kernel.engineCompatibility = Object.freeze({
  detected: detectedEngine.version,
  supported: SUPPORTED_ENGINE_VERSIONS,
  compatible: engineCompatible,
});
globalThis[KERNEL_SYMBOL] = kernel;

function recordPatchFailure(patchId, detail) {
  kernel.patches[patchId] = "failed";
  if (!kernel.failures.includes(detail)) kernel.failures.push(detail);
}

function createInjectedServerRuntime(clientOverlay, requirePrivilegedAccess) {
  const promptRegistry = createPromptRegistry();
  const agentResultRegistry = createAgentResultRegistry();
  const trackerContextRegistry = createTrackerContextRegistry();
  const groupSelectorRegistry = createGroupSelectorRegistry();
  const turnHandoffRegistry = createTurnHandoffRegistry();
  const hostLifecycleRegistry = createHostLifecycleRegistry();
  const host = { app: null, hooksInstalled: false, diagnosticsInstalled: false };
  const promptPatchApplied =
    kernel.patches["prompt.assembler"] === "applied" &&
    kernel.patches["prompt.generate-fallback"] === "applied";
  const agentResultPatchApplied =
    kernel.patches["agent.result-types"] === "applied" &&
    kernel.patches["agent.result-apply-main"] === "applied" &&
    kernel.patches["agent.result-apply-retry"] === "applied";
  const trackerContextPatchApplied =
    kernel.patches["tracker.context-committed-active"] === "applied" &&
    kernel.patches["tracker.context-committed"] === "applied" &&
    kernel.patches["tracker.context-agent"] === "applied";
  const groupSelectorPatchApplied =
    kernel.patches["group.selector-policy"] === "applied" &&
    kernel.patches["group.selector-call"] === "applied";
  const turnHandoffPatchApplied = groupSelectorPatchApplied && [
    "turn.handoff-queue-state",
    "turn.handoff-persona-fallback",
    "turn.handoff-persona-no-failure",
    "turn.handoff-persona-return",
    "turn.handoff-stream-filter",
    "turn.handoff-stream-push",
    "turn.handoff-stream-flush",
    "turn.handoff-response-state",
    "turn.handoff-response-process",
    "turn.handoff-commit",
  ].every((patchId) => kernel.patches[patchId] === "applied");
  const hostRequest = async (consumerId, input = {}) => {
    if (!host.app) throw new Error("Mari Bridge host is not bound to Marinara yet");
    const method = String(input.method ?? "GET").toUpperCase();
    const path = String(input.path ?? input.url ?? "");
    if (!path.startsWith("/api/")) throw new TypeError("Mari Bridge host requests must target /api routes");
    const response = await host.app.inject({
      method,
      url: path,
      headers: {
        accept: "application/json",
        "x-mari-bridge-internal": "1",
        "x-mari-bridge-consumer": consumerId,
        ...(input.headers ?? {}),
      },
      ...(input.body === undefined ? {} : { payload: input.body }),
    });
    let data = null;
    if (response.payload) {
      try { data = JSON.parse(response.payload); }
      catch { data = response.payload; }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const message = data && typeof data === "object" && typeof data.error === "string"
        ? data.error
        : `Host request failed with HTTP ${response.statusCode}`;
      const error = new Error(message);
      error.statusCode = response.statusCode;
      error.data = data;
      throw error;
    }
    return data;
  };
  const runtime = createBridgeRuntime({
    capabilities: [
      "diagnostics",
      "runtime.health",
      "consumer.sessions",
      "host.lifecycle",
      "host.request",
      ...(promptPatchApplied ? ["prompt.inject", "prompt.suppress", "prompt.transform-final", "prompt.transform-history"] : []),
      ...(clientOverlay ? ["client.bridge-first"] : []),
      ...(agentResultPatchApplied ? ["agent.result-types"] : []),
      ...(trackerContextPatchApplied ? ["tracker.context"] : []),
      ...(groupSelectorPatchApplied ? ["group.selector"] : []),
      ...(turnHandoffPatchApplied ? ["turn.handoff"] : []),
    ],
    promptRegistry,
    agentResultRegistry,
    trackerContextRegistry,
    groupSelectorRegistry,
    turnHandoffRegistry,
    hostLifecycleRegistry,
    hostRequest,
    patches: Object.entries(kernel.patches).map(([id, status]) => ({ id, status })),
  });
  runtime.markReady();
  kernel.bindHost = (app) => {
    host.app = app;
    if (host.hooksInstalled) return runtime;
    host.hooksInstalled = true;
    if (!host.diagnosticsInstalled) {
      host.diagnosticsInstalled = true;
      const onRequest = async (request, reply) => {
        if (!requirePrivilegedAccess(request, reply, { feature: "Mari Bridge diagnostics" })) return reply;
      };
      app.get("/api/mari-bridge/health", { onRequest }, async () => runtime.getSnapshot());
      app.get("/api/mari-bridge/consumers", { onRequest }, async () => ({
        consumers: runtime.getSnapshot().consumers,
      }));
      app.get("/api/mari-bridge/turn-handoff/:chatId", async (request, reply) => {
        const view = await turnHandoffRegistry.view({ chatId: request.params.chatId });
        if (view) return view;
        const initializing = turnHandoffRegistry.snapshot().length === 0;
        return {
          chatId: request.params.chatId,
          hidden: true,
          nextParticipant: null,
          status: initializing ? "initializing" : "unavailable",
          canRefresh: false,
          ...(initializing ? { retryAfterMs: 250 } : {}),
        };
      });
      app.patch("/api/mari-bridge/turn-handoff/:chatId", async (request, reply) => {
        const view = await turnHandoffRegistry.update({ chatId: request.params.chatId, patch: request.body ?? {} });
        return view ?? reply.status(404).send({ error: "No active turn handoff for this chat" });
      });
      app.post("/api/mari-bridge/turn-handoff/:chatId/refresh", async (request, reply) => {
        const view = await turnHandoffRegistry.refresh({ chatId: request.params.chatId });
        return view ?? reply.status(404).send({ error: "No active turn handoff for this chat" });
      });
    }
    app.addHook("preHandler", async (request, reply) => {
      try { await hostLifecycleRegistry.dispatch("preHandler", request, reply); }
      catch (error) { app.log.warn(error, "[Mari Bridge] Host preHandler contribution failed"); }
    });
    app.addHook("onSend", async (request, reply, payload) => {
      try { return await hostLifecycleRegistry.dispatch("onSend", request, reply, payload); }
      catch (error) {
        app.log.warn(error, "[Mari Bridge] Host onSend contribution failed");
        return payload;
      }
    });
    app.addHook("onResponse", async (request, reply) => {
      try { await hostLifecycleRegistry.dispatch("onResponse", request, reply); }
      catch (error) { app.log.warn(error, "[Mari Bridge] Host onResponse contribution failed"); }
    });
    return runtime;
  };
  kernel.runtime = runtime;
  globalThis[SERVER_SYMBOL] = runtime;
  return runtime;
}

function replaceExact(source, anchor, replacement, patchId) {
  const matches = source.split(anchor).length - 1;
  if (matches !== 1) {
    recordPatchFailure(patchId, `${patchId} expected one anchor, found ${matches}`);
    return source;
  }
  kernel.patches[patchId] = "applied";
  return source.replace(anchor, replacement);
}

function replaceSupportedExact(source, variants, patchId) {
  const matches = variants.map((variant) => ({
    ...variant,
    count: source.split(variant.anchor).length - 1,
  }));
  const total = matches.reduce((sum, variant) => sum + variant.count, 0);
  if (total !== 1) {
    recordPatchFailure(patchId, `${patchId} expected one supported anchor, found ${total}`);
    return source;
  }
  const selected = matches.find((variant) => variant.count === 1);
  kernel.patches[patchId] = "applied";
  return source.replace(selected.anchor, selected.replacement);
}

const COMMITTED_TRACKER_ACTIVE_GUARD = /if\s*\(\s*!hasWorldState\s*&&\s*!hasCharTracker\s*&&\s*!hasPersonaStats\s*&&\s*!hasQuest\s*&&\s*!hasCustomTracker(?:\s*&&\s*!hasInventoryTracker\s*&&\s*!hasBeholder)?\s*\)/gu;

export function patchCommittedTrackerActiveGuard(source) {
  const matches = [...source.matchAll(COMMITTED_TRACKER_ACTIVE_GUARD)];
  const patchId = "tracker.context-committed-active";
  if (matches.length !== 1) {
    recordPatchFailure(patchId, `${patchId} expected one supported guard, found ${matches.length}`);
    return source;
  }
  const nativeGuard = matches[0][0].includes("hasInventoryTracker")
    ? "!hasWorldState && !hasCharTracker && !hasPersonaStats && !hasQuest && !hasCustomTracker && !hasInventoryTracker && !hasBeholder"
    : "!hasWorldState && !hasCharTracker && !hasPersonaStats && !hasQuest && !hasCustomTracker";
  kernel.patches[patchId] = "applied";
  return source.replace(
    COMMITTED_TRACKER_ACTIVE_GUARD,
    `if (${nativeGuard} && !globalThis[Symbol.for("marinara.mari-bridge.v1")]?.trackerContextHooks?.hasActive(args.activeAgentIds))`,
  );
}

export function patchServerModule(url, inputSource) {
  let source = String(inputSource);
      if (url.endsWith("/capability-module-runtime.service.js")) {
        source = replaceExact(
          source,
          [
            "for (const runtimePackage of await capabilityPackageManager.runtimePackages()) {",
            "            await this.activateOne(app, runtimePackage, true, false);",
            "        }",
          ].join("\n"),
          [
            "globalThis[Symbol.for(\"marinara.mari-bridge.kernel.v1\")]?.bindHost?.(app);",
            "        for (const runtimePackage of await capabilityPackageManager.runtimePackages()) {",
            "            await this.activateOne(app, runtimePackage, true, false);",
            "        }",
            "        for (const installed of await capabilityPackageManager.installed()) {",
            "            if (installed.status === \"restart-required\" && !installed.manifest.entrypoints.server) {",
            "                await capabilityPackageManager.markRuntimeStatus(installed.id, \"active\");",
            "            }",
            "        }",
            "        for (const installed of await capabilityPackageManager.installed()) {",
            "            const bridgeStartupError = typeof installed.error === \"string\" && installed.error.startsWith(\"Mari Bridge \");",
            "            if (installed.status === \"error\" && bridgeStartupError && installed.manifest.entrypoints.server) {",
            "                await this.activateOne(app, { installed }, false, false);",
            "            }",
            "        }",
          ].join("\n"),
          "bridge-first.activation",
        );
        if (kernel.patches["bridge-first.activation"] === "applied") {
          kernel.patches["packages.client-only-updates"] = "applied";
        }
        return source;
      }
      if (url.endsWith("/services/prompt/assembler.js")) {
        source = replaceExact(
          source,
          "export async function assemblePrompt(input) {",
          [
            "export async function assemblePrompt(input) {",
            "    input = await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.promptHooks?.prepareAssemblerInput(input) ?? input;",
          ].join("\n"),
          "prompt.assembler.input",
        );
        source = replaceExact(
          source,
          "finalMessages = finalMessages.filter((m) => m.content?.trim());",
          [
            "finalMessages = await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.promptHooks?.finalizeAssemblerMessages(input, finalMessages) ?? finalMessages;",
            "    finalMessages = finalMessages.filter((m) => m.content?.trim());",
          ].join("\n"),
          "prompt.assembler.output",
        );
        source = replaceExact(
          source,
          "    timeZone: input.timeZone,",
          [
            "    timeZone: input.timeZone,",
            "    activeAgentIds: input.enableAgents === false ? [] : input.activeAgentIds ?? [],",
            "    groupMode: input.groupMode,",
          ].join("\n"),
          "prompt.active-agents.assembler",
        );
        if (kernel.patches["prompt.active-agents.assembler"] === "applied") {
          kernel.patches["prompt.group-macros.assembler-context"] = "applied";
        }
        source = replaceExact(
          source,
          "    let outletScanAttempted = false;",
          [
            "    let outletScanAttempted = false;",
            "    const mariBridgeOutletMacroPattern = /\\{\\{\\s*outlet\\s*::/i;",
            "    const mariBridgeFieldMacroPattern = /\\{\\{\\s*(?:description|personality|backstory|appearance|scenario|example|charSysInfo|charPostHistory|persona|personaDescription|personaPersonality|personaBackstory|personaAppearance|personaScenario|group_scenario_override)\\s*\\}\\}/i;",
            "    const mariBridgeNestedOutletSources = [",
            "      input.groupScenarioOverrideText,",
            "      ...Object.values(macroCtx.characterFields ?? {}),",
            "      ...Object.values(macroCtx.personaFields ?? {}),",
            "      ...(macroCtx.characterProfiles ?? []).flatMap((profile) => Object.values(profile)),",
            "    ];",
            "    const mariBridgeHasNestedOutlet = mariBridgeNestedOutletSources.some((value) =>",
            "      typeof value === \"string\" && mariBridgeOutletMacroPattern.test(value)",
            "    );",
            "    const mariBridgeSectionNeedsOutletScan = (section) => {",
            "      if (mariBridgeOutletMacroPattern.test(section.content)) return true;",
            "      if (!mariBridgeHasNestedOutlet) return false;",
            "      if (mariBridgeFieldMacroPattern.test(section.content)) return true;",
            "      if (section.isMarker !== \"true\" || !section.markerConfig) return false;",
            "      try {",
            "        const markerType = JSON.parse(section.markerConfig)?.type;",
            "        return markerType === \"character\" || markerType === \"persona\";",
            "      } catch {",
            "        return false;",
            "      }",
            "    };",
          ].join("\n"),
          "prompt.outlet-nested-fields.scan-source",
        );
        source = replaceExact(
          source,
          "if (!outletScanAttempted && /\\{\\{\\s*outlet\\s*::/i.test(section.content)) {",
          "if (!outletScanAttempted && mariBridgeSectionNeedsOutletScan(section)) {",
          "prompt.outlet-nested-fields.scan-call",
        );
        kernel.patches["prompt.assembler"] = "applied";
        return source;
      }
      if (url.endsWith("/services/prompt/macro-context.js")) {
        source = replaceExact(
          source,
          "    timeZone: input.timeZone,",
          [
            "    timeZone: input.timeZone,",
            "    activeAgents: Array.isArray(input.activeAgentIds)",
            "      ? [...new Set(input.activeAgentIds.map((agentId) => String(agentId ?? \"\").trim()).filter(Boolean))]",
            "      : [],",
            "    groupScenarioOverride: typeof input.groupScenarioOverrideText === \"string\" ? input.groupScenarioOverrideText : \"\",",
            "    groupMode: String(input.groupMode ?? \"\").toLowerCase() === \"individual\" ? \"INDIVIDUAL\" : String(input.groupMode ?? \"\").toLowerCase() === \"merged\" ? \"MERGED\" : \"SOLO\",",
          ].join("\n"),
          "prompt.active-agents.context",
        );
        if (kernel.patches["prompt.active-agents.context"] === "applied") {
          kernel.patches["prompt.group-macros.context"] = "applied";
        }
        return source;
      }
      if (url.endsWith("/utils/macro-engine.js")) {
        source = replaceExact(
          source,
          "    agentData: base?.agentData,",
          [
            "    agentData: base?.agentData,",
            "    activeAgents: base?.activeAgents,",
            "    groupScenarioOverride: base?.groupScenarioOverride,",
            "    groupMode: base?.groupMode,",
          ].join("\n"),
          "prompt.bridge-macros.character-scope",
        );
        source = replaceExact(
          source,
          "  result = result.replace(/\\{\\{chatId\\}\\}/gi, ctx.chatId ?? \"\");",
          [
            "  result = result.replace(/\\{\\{chatId\\}\\}/gi, ctx.chatId ?? \"\");",
            "  result = result.replace(/\\{\\{active-agents\\}\\}/gi, () => Array.isArray(ctx.activeAgents) ? ctx.activeAgents.join(\",\") : \"\");",
            "  result = result.replace(/\\{\\{group_scenario_override\\}\\}/gi, () => ctx.groupScenarioOverride ?? \"\");",
            "  result = result.replace(/\\{\\{group_mode\\}\\}/gi, () => ctx.groupMode ?? \"SOLO\");",
          ].join("\n"),
          "prompt.active-agents.macro",
        );
        if (kernel.patches["prompt.active-agents.macro"] === "applied") {
          kernel.patches["prompt.group-macros.resolve"] = "applied";
        }
        return source;
      }
      if (url.endsWith("/services/agents/agent-executor.js")) {
        source = replaceExact(
          source,
          'if (typeof configured === "string" && AGENT_RESULT_TYPES.has(configured)) {',
          'if (typeof configured === "string" && (AGENT_RESULT_TYPES.has(configured) || globalThis[Symbol.for("marinara.mari-bridge.v1")]?.agentResultHooks?.hasResultType(configured))) {',
          "agent.result-types",
        );
        source = replaceExact(
          source,
          "trackerSummary.playerStats = compactQuestPlayerStatsForContext(gs.playerStats, contextAgentTypes);",
          [
            "trackerSummary.playerStats = compactQuestPlayerStatsForContext(gs.playerStats, contextAgentTypes);",
            "    globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.trackerContextHooks?.appendAgentState({",
            "      activeAgentIds: contextAgentTypes,",
            "      latestGameState: msg.gameState,",
            "      compactGameState: gs,",
            "    }, trackerSummary);",
          ].join("\n"),
          "tracker.context-agent",
        );
        return source;
      }
      if (url.endsWith("/services/generation/committed-tracker-context.js")) {
        source = patchCommittedTrackerActiveGuard(source);
        source = replaceExact(
          source,
          "const playerNotes =",
          [
            "globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.trackerContextHooks?.appendCommittedSections({",
            "    activeAgentIds: args.activeAgentIds,",
            "    latestGameState: snap,",
            "    chatMetadata: args.chatMetadata,",
            "    wrapFormat: args.wrapFormat,",
            "    wrapContent,",
            "  }, trackerParts);",
            "",
            "  const playerNotes =",
          ].join("\n"),
          "tracker.context-committed",
        );
        return source;
      }
      if (url.endsWith("/routes/generate.routes.js")) {
        source = replaceSupportedExact(source, [
          {
            anchor: [
              "                    timeZone: promptTimeZone,",
              "                });",
              "                const conversationMacroFieldsByCharacterId = new Map();",
            ].join("\n"),
            replacement: [
              "                    timeZone: promptTimeZone,",
              "                    groupMode: allCharacterIds.length > 1 ? promptGroupChatMode : \"solo\",",
              "                });",
              "                const conversationMacroFieldsByCharacterId = new Map();",
            ].join("\n"),
          },
          {
            anchor: [
              "                    timeZone: promptTimeZone,",
              "                    macroSources: [",
            ].join("\n"),
            replacement: [
              "                    timeZone: promptTimeZone,",
              "                    groupMode: allCharacterIds.length > 1 ? promptGroupChatMode : \"solo\",",
              "                    macroSources: [",
            ].join("\n"),
          },
        ], "prompt.group-macros.main-context");
        source = replaceExact(
          source,
          [
            "                        timeZone: promptTimeZone,",
            "                        impersonate: input.impersonate === true,",
          ].join("\n"),
          [
            "                        timeZone: promptTimeZone,",
            "                        groupMode: allCharacterIds.length > 1 ? promptGroupChatMode : \"solo\",",
            "                        impersonate: input.impersonate === true,",
          ].join("\n"),
          "prompt.group-macros.main-assembler",
        );
        source = replaceExact(
          source,
          [
            "                    promptMacroContext.agentData = {",
            "                        ...promptMacroContext.agentData,",
            "                        ...assembled.macroAgentData,",
            "                    };",
            "                    lorebookPromptScanResult = assembled.lorebookScanResult ?? null;",
          ].join("\n"),
          [
            "                    promptMacroContext.agentData = {",
            "                        ...promptMacroContext.agentData,",
            "                        ...assembled.macroAgentData,",
            "                    };",
            "                    promptMacroContext.outlets = assembled.lorebookScanResult?.outlets ?? promptMacroContext.outlets;",
            "                    lorebookPromptScanResult = assembled.lorebookScanResult ?? null;",
          ].join("\n"),
          "prompt.outlet-nested-fields.main-final",
        );
        source = replaceExact(
          source,
          [
            'const groupResponseOrder = chatMeta.groupResponseOrder ?? "sequential";',
            "                const groupChatMode = resolveGroupGenerationMode(chatMode, chatMeta.groupChatMode);",
          ].join("\n"),
          [
            'const nativeGroupPolicy = { groupResponseOrder: chatMeta.groupResponseOrder ?? "sequential", groupChatMode: resolveGroupGenerationMode(chatMode, chatMeta.groupChatMode) };',
            "                const selectorGroupPolicy = globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.groupSelectorHooks?.resolvePolicy({ chatId: input.chatId, chatMetadata: chatMeta, chatMode }, nativeGroupPolicy) ?? nativeGroupPolicy;",
            "                const bridgedGroupPolicy = globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.turnHandoffHooks?.resolvePolicy({ chatId: input.chatId, chatMetadata: chatMeta, chatMode }, selectorGroupPolicy) ?? selectorGroupPolicy;",
            "                const groupResponseOrder = bridgedGroupPolicy.groupResponseOrder;",
            "                const groupChatMode = bridgedGroupPolicy.groupChatMode;",
          ].join("\n"),
          "group.selector-policy",
        );
        source = replaceExact(
          source,
          "let smartResponseQueue =",
          [
            "let bridgedTurnHandoffToPersona = false;",
            "        let smartResponseQueue =",
          ].join("\n"),
          "turn.handoff-queue-state",
        );
        source = replaceExact(
          source,
          "                        : await selectSmartGroupResponders()",
          [
            "                        : await (async () => {",
            "                            const mariBridgeGroupScope = {",
            "                              chatId: input.chatId,",
            "                              chatMetadata: chatMeta,",
            "                              chatMode,",
            "                              chatConnectionId: chat.connectionId,",
            "                              personaName,",
            "                              messages: chatMessages,",
            "                              candidates: availableGroupCharacters,",
            "                              hasIncomingUserTurn: Boolean((typeof input.userMessage === \"string\" && input.userMessage.trim()) || input.attachments?.length || input.pendingSpatialTransition),",
            "                            };",
            "                            const mariBridgeFallback = () => globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.groupSelectorHooks?.select(mariBridgeGroupScope, selectSmartGroupResponders) ?? selectSmartGroupResponders();",
            "                            const mariBridgeSelection = await (globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.turnHandoffHooks?.select(mariBridgeGroupScope, mariBridgeFallback) ?? mariBridgeFallback());",
            "                            bridgedTurnHandoffToPersona = mariBridgeSelection?.participantKind === \"persona\";",
            "                            return Array.isArray(mariBridgeSelection) ? mariBridgeSelection : mariBridgeSelection?.characterIds ?? [];",
            "                          })()",
          ].join("\n"),
          "group.selector-call",
        );
        source = replaceExact(
          source,
          "if (needsSmartResponseQueue && (!smartResponseQueue || smartResponseQueue.length === 0)) {",
          "if (!bridgedTurnHandoffToPersona && needsSmartResponseQueue && (!smartResponseQueue || smartResponseQueue.length === 0)) {",
          "turn.handoff-persona-fallback",
        );
        source = replaceSupportedExact(source, [
          {
            anchor: [
              "          useIndividualLoop &&",
              "          groupResponseOrder === \"smart\" &&",
              "          !input.forCharacterId &&",
              "          (!smartResponseQueue || smartResponseQueue.length === 0)",
            ].join("\n"),
            replacement: [
              "          !bridgedTurnHandoffToPersona &&",
              "          useIndividualLoop &&",
              "          groupResponseOrder === \"smart\" &&",
              "          !input.forCharacterId &&",
              "          (!smartResponseQueue || smartResponseQueue.length === 0)",
            ].join("\n"),
          },
          {
            anchor: [
              "if (useIndividualLoop &&",
              "                    groupResponseOrder === \"smart\" &&",
              "                    !input.forCharacterId &&",
              "                    (!smartResponseQueue || smartResponseQueue.length === 0)) {",
            ].join("\n"),
            replacement: [
              "if (!bridgedTurnHandoffToPersona &&",
              "                    useIndividualLoop &&",
              "                    groupResponseOrder === \"smart\" &&",
              "                    !input.forCharacterId &&",
              "                    (!smartResponseQueue || smartResponseQueue.length === 0)) {",
            ].join("\n"),
          },
        ], "turn.handoff-persona-no-failure");
        source = replaceExact(
          source,
          "        // Turn-game board awareness is injected per responding character inside",
          [
            "        if (bridgedTurnHandoffToPersona) {",
            "          sendSseEvent(reply, { type: \"turn_handoff\", data: { kind: \"persona\" } });",
            "          sendSseEvent(reply, { type: \"done\", data: \"\" });",
            "          return;",
            "        }",
            "",
            "        // Turn-game board awareness is injected per responding character inside",
          ].join("\n"),
          "turn.handoff-persona-return",
        );
        source = replaceExact(
          source,
          "        const spatialDirectiveStreamFilter =",
          [
            "        const turnHandoffStreamFilter = globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.turnHandoffHooks?.createStreamFilter({",
            "          chatId: input.chatId, chatMetadata: chatMeta, chatMode, impersonate: input.impersonate === true,",
            "        }) ?? null;",
            "        const spatialDirectiveStreamFilter =",
          ].join("\n"),
          "turn.handoff-stream-filter",
        );
        source = replaceExact(
          source,
          "          const visibleText = spatialDirectiveStreamFilter?.push(text) ?? text;",
          [
            "          const handoffVisibleText = turnHandoffStreamFilter?.push(text) ?? text;",
            "          const visibleText = spatialDirectiveStreamFilter?.push(handoffVisibleText) ?? handoffVisibleText;",
          ].join("\n"),
          "turn.handoff-stream-push",
        );
        source = replaceExact(
          source,
          "            const pendingSpatialText = spatialDirectiveStreamFilter?.flush() ?? \"\";",
          [
            "            const pendingTurnHandoffText = turnHandoffStreamFilter?.flush() ?? \"\";",
            "            const pendingSpatialText = (pendingTurnHandoffText ? spatialDirectiveStreamFilter?.push(pendingTurnHandoffText) ?? pendingTurnHandoffText : \"\") + (spatialDirectiveStreamFilter?.flush() ?? \"\");",
          ].join("\n"),
          "turn.handoff-stream-flush",
        );
        source = replaceExact(
          source,
          "          let contentReplaced = false;",
          [
            "          let contentReplaced = false;",
            "          let bridgedTurnHandoffResult = null;",
          ].join("\n"),
          "turn.handoff-response-state",
        );
        source = replaceExact(
          source,
          "          if (contentReplaced) {",
          [
            "          bridgedTurnHandoffResult = await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.turnHandoffHooks?.processResponse({",
            "            chatId: input.chatId, chatMetadata: chatMeta, chatMode, targetCharacterId: targetCharId, impersonate: input.impersonate === true,",
            "          }, fullResponse) ?? null;",
            "          if (bridgedTurnHandoffResult && bridgedTurnHandoffResult.content !== fullResponse) {",
            "            fullResponse = bridgedTurnHandoffResult.content;",
            "            contentReplaced = true;",
            "          }",
            "",
            "          if (contentReplaced) {",
          ].join("\n"),
          "turn.handoff-response-process",
        );
        source = replaceSupportedExact(source, [
          {
            anchor: [
              "          if (",
              "            savedMsg?.id &&",
              "            savedSwipeIndex !== null &&",
              "            !shouldSuppressAssistantSpatialMutation(input) &&",
            ].join("\n"),
            replacement: [
              "          if (savedMsg?.id && savedSwipeIndex !== null && bridgedTurnHandoffResult?.participant) {",
              "            await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.turnHandoffHooks?.commit({",
              "              chatId: input.chatId, chatMetadata: chatMeta, chatMode, messageId: savedMsg.id, swipeIndex: savedSwipeIndex, messageSpeakerId: targetCharId,",
              "            }, bridgedTurnHandoffResult);",
              "          }",
              "          if (",
              "            savedMsg?.id &&",
              "            savedSwipeIndex !== null &&",
              "            !shouldSuppressAssistantSpatialMutation(input) &&",
            ].join("\n"),
          },
          {
            anchor: [
              "                    if (savedMsg?.id &&",
              "                        savedSwipeIndex !== null &&",
              "                        !shouldSuppressAssistantSpatialMutation(input) &&",
            ].join("\n"),
            replacement: [
              "                    if (savedMsg?.id && savedSwipeIndex !== null && bridgedTurnHandoffResult?.participant) {",
              "                        await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.turnHandoffHooks?.commit({",
              "                            chatId: input.chatId, chatMetadata: chatMeta, chatMode, messageId: savedMsg.id, swipeIndex: savedSwipeIndex, messageSpeakerId: targetCharId,",
              "                        }, bridgedTurnHandoffResult);",
              "                    }",
              "                    if (savedMsg?.id &&",
              "                        savedSwipeIndex !== null &&",
              "                        !shouldSuppressAssistantSpatialMutation(input) &&",
            ].join("\n"),
          },
        ], "turn.handoff-commit");
        source = replaceExact(
          source,
          "const preparedMessagesForGen = resolvePromptMessageMacros(macroScopedMessagesForGen, providerMacroContext, historyMacroProfilesById);",
          [
            "const bridgedMessagesForGen = presetOwnsAgentPlacement",
            "            ? macroScopedMessagesForGen",
            "            : await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.promptHooks?.finalizeMessages({",
            "                workflow: chatMode === \"game\" ? \"game\" : \"chat\",",
            "                lane: \"main\",",
            "                chatId: input.chatId,",
            "                characterIds: promptCharacterIds,",
            "                groupCharacterIds: characterIds,",
            "                personaId,",
            "                impersonate: input.impersonate === true,",
            "              }, macroScopedMessagesForGen) ?? macroScopedMessagesForGen;",
            "          const preparedMessagesForGen = resolvePromptMessageMacros(bridgedMessagesForGen, providerMacroContext, historyMacroProfilesById);",
          ].join("\n"),
          "prompt.generate-fallback",
        );
        source = replaceExact(
          source,
          "// Validate background agent result — reject hallucinated filenames",
          [
            "await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.agentResultHooks?.apply({",
            "              lane: \"main\",",
            "              result,",
            "              chatId: input.chatId,",
            "              messageId,",
            "              swipeIndex: targetSwipeIndex,",
            "              state: {",
            "                read: async () => {",
            "                  const row = (await gameStateStore.getByMessage(messageId, targetSwipeIndex)) ?? trackerBaseGameStateSnapshot;",
            "                  return row ? parseGameStateRow(row) : null;",
            "                },",
            "                update: (fields) => gameStateStore.updateByMessage(messageId, targetSwipeIndex, input.chatId, fields, undefined, { baseSnapshot: trackerBaseGameStateSnapshot }),",
            "              },",
            "              emitPatch: (patch) => reply.raw.write(`data: ${JSON.stringify({ type: \"game_state_patch\", data: patch })}\\n\\n`),",
            "              logger,",
            "            });",
            "",
            "            // Validate background agent result — reject hallucinated filenames",
          ].join("\n"),
          "agent.result-apply-main",
        );
        return source;
      }
      if (url.endsWith("/routes/generate/dry-run-route.js")) {
        source = replaceExact(
          source,
          [
            "        const returnPrompt = body.returnPrompt === true;",
            "        const wrapLastMessage = body.wrapLastMessage === true;",
          ].join("\n"),
          [
            "        const returnPrompt = body.returnPrompt === true;",
            "        const includeReasoning = body.includeReasoning === true && body.impersonate !== true;",
            "        const impersonateContinuation = body.impersonate === true && typeof body.impersonateContinuation === \"string\"",
            "            ? body.impersonateContinuation.trimEnd()",
            "            : \"\";",
            "        const wrapLastMessage = body.wrapLastMessage === true;",
          ].join("\n"),
          "dry-run.structured-options",
        );
        source = replaceExact(
          source,
          [
            "            finalMessages.push({ role: \"assistant\", content: assistantPrefill.trimEnd() });",
            "        }",
            "        finalMessages = injectOwnerSpatialPrompt(finalMessages, promptSpatialProjection);",
          ].join("\n"),
          [
            "            finalMessages.push({ role: \"assistant\", content: assistantPrefill.trimEnd() });",
            "        }",
            "        if (impersonateContinuation) {",
            "            finalMessages.push({ role: \"assistant\", content: impersonateContinuation });",
            "        }",
            "        finalMessages = injectOwnerSpatialPrompt(finalMessages, promptSpatialProjection);",
          ].join("\n"),
          "dry-run.impersonate-continuation",
        );
        source = replaceExact(
          source,
          "            let full = \"\";",
          [
            "            let full = \"\";",
            "            let reasoning = \"\";",
          ].join("\n"),
          "dry-run.streaming-reasoning-state",
        );
        source = replaceExact(
          source,
          [
            "            const onToken = async (chunk) => {",
            "                full += chunk;",
            "                await sendTokenTextChunked(chunk);",
            "            };",
          ].join("\n"),
          [
            "            const onToken = async (chunk) => {",
            "                full += chunk;",
            "                await sendTokenTextChunked(chunk);",
            "            };",
            "            const onThinking = (chunk) => {",
            "                reasoning += chunk;",
            "                sendSseEvent(reply, { type: \"thinking\", data: chunk });",
            "            };",
          ].join("\n"),
          "dry-run.streaming-reasoning-callback",
        );
        source = replaceExact(
          source,
          [
            "                    suppressModelParameters,",
            "                    onToken,",
            "                    signal: abortController.signal,",
          ].join("\n"),
          [
            "                    suppressModelParameters,",
            "                    captureReasoning: includeReasoning,",
            "                    onThinking: includeReasoning ? onThinking : undefined,",
            "                    onToken,",
            "                    signal: abortController.signal,",
          ].join("\n"),
          "dry-run.streaming-reasoning-provider",
        );
        source = replaceExact(
          source,
          "                sendSseEvent(reply, { type: \"result\", data: { content: full || result.content || \"\" } });",
          [
            "                const content = full || result.content || \"\";",
            "                sendSseEvent(reply, {",
            "                    type: \"result\",",
            "                    data: {",
            "                        content,",
            "                        continuation: impersonateContinuation ? content : undefined,",
            "                        reasoning: includeReasoning ? reasoning : undefined,",
            "                    },",
            "                });",
          ].join("\n"),
          "dry-run.streaming-structured-result",
        );
        source = replaceExact(
          source,
          [
            "        try {",
            "            const result = await provider.chatComplete(providerMessages, {",
          ].join("\n"),
          [
            "        let reasoning = \"\";",
            "        const onThinking = (chunk) => {",
            "            reasoning += chunk;",
            "        };",
            "        try {",
            "            const result = await provider.chatComplete(providerMessages, {",
          ].join("\n"),
          "dry-run.nonstream-reasoning-state",
        );
        source = replaceExact(
          source,
          [
            "                suppressModelParameters,",
            "                signal: abortController.signal,",
          ].join("\n"),
          [
            "                suppressModelParameters,",
            "                captureReasoning: includeReasoning,",
            "                onThinking: includeReasoning ? onThinking : undefined,",
            "                signal: abortController.signal,",
          ].join("\n"),
          "dry-run.nonstream-reasoning-provider",
        );
        source = replaceExact(
          source,
          [
            "            return reply.send({",
            "                content: (result.content ?? \"\").trimEnd(),",
            "                runId,",
            "            });",
          ].join("\n"),
          [
            "            const content = (result.content ?? \"\").trimEnd();",
            "            return reply.send({",
            "                content,",
            "                continuation: impersonateContinuation ? content : undefined,",
            "                reasoning: includeReasoning ? reasoning : undefined,",
            "                runId,",
            "            });",
          ].join("\n"),
          "dry-run.nonstream-structured-result",
        );
        source = replaceSupportedExact(source, [
          {
            anchor: [
              "            idleDuration: promptIdleDuration,",
              "        });",
              "        const historyMacroProfilesById = (await resolveCharacterMacroData(app.db, allCharacterIds)).profilesById;",
            ].join("\n"),
            replacement: [
              "            idleDuration: promptIdleDuration,",
              "            groupMode: allCharacterIds.length > 1 ? dryRunGroupChatMode : \"solo\",",
              "        });",
              "        const historyMacroProfilesById = (await resolveCharacterMacroData(app.db, allCharacterIds)).profilesById;",
            ].join("\n"),
          },
          {
            anchor: [
              "            idleDuration: promptIdleDuration,",
              "            macroSources: [",
            ].join("\n"),
            replacement: [
              "            idleDuration: promptIdleDuration,",
              "            groupMode: allCharacterIds.length > 1 ? dryRunGroupChatMode : \"solo\",",
              "            macroSources: [",
            ].join("\n"),
          },
        ], "prompt.group-macros.dry-run-context");
        source = replaceExact(
          source,
          [
            "                idleDuration: promptIdleDuration,",
            "                impersonate,",
          ].join("\n"),
          [
            "                idleDuration: promptIdleDuration,",
            "                groupMode: allCharacterIds.length > 1 ? dryRunGroupChatMode : \"solo\",",
            "                impersonate,",
          ].join("\n"),
          "prompt.group-macros.dry-run-assembler",
        );
        source = replaceExact(
          source,
          [
            "            promptMacroContext.agentData = {",
            "                ...promptMacroContext.agentData,",
            "                ...assembled.macroAgentData,",
            "            };",
            "            finalMessages = assembled.messages;",
          ].join("\n"),
          [
            "            promptMacroContext.agentData = {",
            "                ...promptMacroContext.agentData,",
            "                ...assembled.macroAgentData,",
            "            };",
            "            promptMacroContext.outlets = assembled.lorebookScanResult?.outlets ?? promptMacroContext.outlets;",
            "            finalMessages = assembled.messages;",
          ].join("\n"),
          "prompt.outlet-nested-fields.dry-run-final",
        );
        return source;
      }
      if (url.endsWith("/routes/generate/retry-agents-route.js")) {
        source = replaceExact(
          source,
          "for (const result of sortedResults) {",
          [
            "for (const result of sortedResults) {",
            "    await globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.agentResultHooks?.apply({",
            "      lane: \"retry\",",
            "      result,",
            "      chatId,",
            "      messageId: retryMessageId,",
            "      swipeIndex: retrySwipeIndex,",
            "      state: {",
            "        read: async () => {",
            "          const row = await loadRetryTargetGameStateSnapshot();",
            "          return row ? parseGameStateRow(row) : null;",
            "        },",
            "        update: updateRetryTargetGameStateSnapshot,",
            "      },",
            "      emitPatch: (patch) => sendSseEvent(reply, { type: \"game_state_patch\", data: patch }),",
            "      logger,",
            "    });",
          ].join("\n"),
          "agent.result-apply-retry",
        );
        return source;
      }
      if (url.endsWith("/app.js")) {
        source = replaceExact(
          source,
          'const clientDist = resolve(__dirname, "..", "..", "client", "dist");',
          'const clientDist = globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")]?.clientRoot || resolve(__dirname, "..", "..", "client", "dist");',
          "client.overlay-root",
        );
        return source;
      }
      return source;
}

export function decodeModuleSource(source) {
  if (typeof source === "string") return source;
  if (source instanceof ArrayBuffer) return Buffer.from(source).toString("utf8");
  if (ArrayBuffer.isView(source)) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString("utf8");
  }
  return String(source ?? "");
}

const SERVER_PATCH_TARGETS = Object.freeze([
  ["capability-module-runtime.service.js", ["packages", "server", "dist", "services", "capability-packages", "capability-module-runtime.service.js"]],
  ["services/prompt/assembler.js", ["packages", "server", "dist", "services", "prompt", "assembler.js"]],
  ["services/prompt/macro-context.js", ["packages", "server", "dist", "services", "prompt", "macro-context.js"]],
  ["utils/macro-engine.js", ["packages", "shared", "dist", "utils", "macro-engine.js"]],
  ["services/agents/agent-executor.js", ["packages", "server", "dist", "services", "agents", "agent-executor.js"]],
  ["services/generation/committed-tracker-context.js", ["packages", "server", "dist", "services", "generation", "committed-tracker-context.js"]],
  ["routes/generate.routes.js", ["packages", "server", "dist", "routes", "generate.routes.js"]],
  ["routes/generate/dry-run-route.js", ["packages", "server", "dist", "routes", "generate", "dry-run-route.js"]],
  ["routes/generate/retry-agents-route.js", ["packages", "server", "dist", "routes", "generate", "retry-agents-route.js"]],
  ["app.js", ["packages", "server", "dist", "app.js"]],
]);

export function preflightServerPatches(engineRoot) {
  kernel.patches = {};
  kernel.failures = [];
  for (const [label, segments] of SERVER_PATCH_TARGETS) {
    const modulePath = resolve(engineRoot, ...segments);
    try {
      patchServerModule(pathToFileURL(modulePath).href, readFileSync(modulePath, "utf8"));
    } catch (error) {
      recordPatchFailure("engine.preflight", `Could not preflight ${label}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
  }
  const compatible = kernel.failures.length === 0;
  if (!compatible) {
    for (const [patchId, status] of Object.entries(kernel.patches)) {
      if (status === "applied") kernel.patches[patchId] = "skipped";
    }
  }
  return compatible;
}

if (disabled) {
  kernel.active = false;
  kernel.patches["engine.version"] = "disabled";
} else if (!engineCompatible || !detectedEngine.root) {
  kernel.active = false;
  recordPatchFailure(
    "engine.version",
    `engine.version supports ${SUPPORTED_ENGINE_VERSIONS.join(", ")}; detected ${detectedEngine.version ?? "unknown"}`,
  );
} else if (!preflightServerPatches(detectedEngine.root)) {
  kernel.active = false;
} else {
  const serverRoot = resolve(detectedEngine.root, "packages", "server");
  const dataDir = resolve(serverRoot, process.env.DATA_DIR || "data");
  kernel.nativeClientRoot = resolve(detectedEngine.root, "packages", "client", "dist");
  try {
    const clientOverlay = await prepareClientOverlay({
      dataDir,
      sourceRoot: kernel.nativeClientRoot,
      engineVersion: detectedEngine.version,
    });
    kernel.clientRoot = clientOverlay.root;
    kernel.clientOverlay = Object.freeze({ root: clientOverlay.root, fingerprint: clientOverlay.fingerprint });
    kernel.patches["client.bridge-first"] = "applied";
    for (const patchId of clientOverlay.patches ?? []) kernel.patches[patchId] = "applied";
    for (const failure of clientOverlay.failedPatches ?? []) {
      const patchId = String(failure?.id ?? "client.unknown");
      const detail = String(failure?.detail ?? "Native client hook did not apply");
      kernel.patches[patchId] = "failed";
      const diagnostic = `${patchId}: ${detail}`;
      if (!kernel.failures.includes(diagnostic)) kernel.failures.push(diagnostic);
    }
    kernel.active = true;
    kernel.patches["engine.version"] = "applied";
    registerHooks({
      load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (result.format !== "module" || result.source == null) return result;
        const inputSource = decodeModuleSource(result.source);
        const source = patchServerModule(url, inputSource);
        return source === inputSource ? result : { ...result, source };
      },
    });
    const { requirePrivilegedAccess } = await import(pathToFileURL(resolve(
      detectedEngine.root,
      "packages",
      "server",
      "dist",
      "middleware",
      "privileged-gate.js",
    )).href);
    createInjectedServerRuntime(clientOverlay, requirePrivilegedAccess);
  } catch (error) {
    kernel.active = false;
    recordPatchFailure(
      "client.overlay",
      `Could not prepare injected client overlay: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
