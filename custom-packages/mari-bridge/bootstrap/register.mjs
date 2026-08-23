import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, resolve, sep } from "node:path";

const KERNEL_SYMBOL = Symbol.for("marinara.mari-bridge.kernel.v1");
export const SUPPORTED_ENGINE_VERSIONS = Object.freeze(["2.4.3"]);
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

function detectPreparedClientRoot(engineVersion) {
  const dataDir = process.env.DATA_DIR;
  if (!dataDir) return null;
  const clientBase = resolve(dataDir, "mari-bridge", "client");
  try {
    const pointer = JSON.parse(readFileSync(resolve(dataDir, "mari-bridge", "client-current.json"), "utf8"));
    const root = resolve(String(pointer?.root ?? ""));
    if (pointer?.engineVersion !== engineVersion) return null;
    if (root !== clientBase && !root.startsWith(`${clientBase}${sep}`)) return null;
    if (readFileSync(resolve(root, ".mari-bridge-ready"), "utf8").trim() !== pointer?.fingerprint) return null;
    return root;
  } catch {
    return null;
  }
}

const detectedEngine = detectMarinaraEngine();
const engineCompatible = SUPPORTED_ENGINE_VERSIONS.includes(detectedEngine.version);
const kernel = globalThis[KERNEL_SYMBOL] ?? {
  active: false,
  patches: {},
  failures: [],
};
kernel.version = "1.0.5";
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

function replaceExact(source, anchor, replacement, patchId) {
  const matches = source.split(anchor).length - 1;
  if (matches !== 1) {
    recordPatchFailure(patchId, `${patchId} expected one anchor, found ${matches}`);
    return source;
  }
  kernel.patches[patchId] = "applied";
  return source.replace(anchor, replacement);
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
            "for (const runtimePackage of (await capabilityPackageManager.runtimePackages()).sort((left, right) => {",
            "      if (left.installed.id === \"mari-bridge\") return -1;",
            "      if (right.installed.id === \"mari-bridge\") return 1;",
            "      return 0;",
            "    })) {",
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
          ].join("\n"),
          "prompt.active-agents.assembler",
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
          ].join("\n"),
          "prompt.active-agents.context",
        );
        return source;
      }
      if (url.endsWith("/utils/macro-engine.js")) {
        source = replaceExact(
          source,
          "  result = result.replace(/\\{\\{chatId\\}\\}/gi, ctx.chatId ?? \"\");",
          [
            "  result = result.replace(/\\{\\{chatId\\}\\}/gi, ctx.chatId ?? \"\");",
            "  result = result.replace(/\\{\\{active-agents\\}\\}/gi, () => Array.isArray(ctx.activeAgents) ? ctx.activeAgents.join(\",\") : \"\");",
          ].join("\n"),
          "prompt.active-agents.macro",
        );
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
        source = replaceExact(
          source,
          [
            'const groupResponseOrder = chatMeta.groupResponseOrder ?? "sequential";',
            "                const groupChatMode = resolveGroupGenerationMode(chatMode, chatMeta.groupChatMode);",
          ].join("\n"),
          [
            'const nativeGroupPolicy = { groupResponseOrder: chatMeta.groupResponseOrder ?? "sequential", groupChatMode: resolveGroupGenerationMode(chatMode, chatMeta.groupChatMode) };',
            "                const bridgedGroupPolicy = globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.groupSelectorHooks?.resolvePolicy({ chatId: input.chatId, chatMetadata: chatMeta, chatMode }, nativeGroupPolicy) ?? nativeGroupPolicy;",
            "                const groupResponseOrder = bridgedGroupPolicy.groupResponseOrder;",
            "                const groupChatMode = bridgedGroupPolicy.groupChatMode;",
          ].join("\n"),
          "group.selector-policy",
        );
        source = replaceExact(
          source,
          "                        : await selectSmartGroupResponders()",
          [
            "                        : await (globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.groupSelectorHooks?.select({",
            "                            chatId: input.chatId,",
            "                            chatMetadata: chatMeta,",
            "                            chatMode,",
            "                            chatConnectionId: chat.connectionId,",
            "                            personaName,",
            "                            messages: chatMessages,",
            "                            candidates: availableGroupCharacters,",
            "                          }, selectSmartGroupResponders) ?? selectSmartGroupResponders())",
          ].join("\n"),
          "group.selector-call",
        );
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
  kernel.active = true;
  kernel.patches["engine.version"] = "applied";
  kernel.nativeClientRoot = resolve(detectedEngine.root, "packages", "client", "dist");
  kernel.clientRoot = detectPreparedClientRoot(detectedEngine.version) ?? undefined;
  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (result.format !== "module" || result.source == null) return result;
      const inputSource = decodeModuleSource(result.source);
      const source = patchServerModule(url, inputSource);
      return source === inputSource ? result : { ...result, source };
    },
  });
}
