import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const KERNEL_SYMBOL = Symbol.for("marinara.mari-bridge.kernel.v1");
const disabled = process.env.MARI_BRIDGE_DISABLE === "1";
const kernel = globalThis[KERNEL_SYMBOL] ?? {
  active: !disabled,
  version: "1.0.0",
  patches: {},
  failures: [],
};
globalThis[KERNEL_SYMBOL] = kernel;

if (!disabled) {
  const replaceExact = (source, anchor, replacement, patchId) => {
    const matches = source.split(anchor).length - 1;
    if (matches !== 1) {
      const detail = `${patchId} expected one anchor, found ${matches}`;
      kernel.patches[patchId] = "failed";
      kernel.failures.push(detail);
      throw new Error(`Mari Bridge refused unsupported Engine module: ${detail}`);
    }
    kernel.patches[patchId] = "applied";
    return source.replace(anchor, replacement);
  };

  registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (result.format !== "module") return result;
      let source = String(result.source);
      if (url.endsWith("/capability-module-runtime.service.js")) {
        source = replaceExact(
          source,
          "for (const runtimePackage of await capabilityPackageManager.runtimePackages()) {",
          [
            "for (const runtimePackage of (await capabilityPackageManager.runtimePackages()).sort((left, right) => {",
            "      if (left.installed.id === \"mari-bridge\") return -1;",
            "      if (right.installed.id === \"mari-bridge\") return 1;",
            "      return 0;",
            "    })) {",
          ].join("\n"),
          "bridge-first.activation",
        );
        return { ...result, source };
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
        return { ...result, source };
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
        return { ...result, source };
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
        return { ...result, source };
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
        return { ...result, source };
      }
      if (url.endsWith("/services/generation/committed-tracker-context.js")) {
        source = replaceExact(
          source,
          "if (!hasWorldState && !hasCharTracker && !hasPersonaStats && !hasQuest && !hasCustomTracker)",
          "if (!hasWorldState && !hasCharTracker && !hasPersonaStats && !hasQuest && !hasCustomTracker && !globalThis[Symbol.for(\"marinara.mari-bridge.v1\")]?.trackerContextHooks?.hasActive(args.activeAgentIds))",
          "tracker.context-committed-active",
        );
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
        return { ...result, source };
      }
      if (url.endsWith("/routes/generate.routes.js")) {
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
        return { ...result, source };
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
        return { ...result, source };
      }
      if (url.endsWith("/app.js")) {
        kernel.nativeClientRoot = resolve(dirname(fileURLToPath(url)), "..", "..", "client", "dist");
        source = replaceExact(
          source,
          'const clientDist = resolve(__dirname, "..", "..", "client", "dist");',
          'const clientDist = globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")]?.clientRoot || resolve(__dirname, "..", "..", "client", "dist");',
          "client.overlay-root",
        );
        return { ...result, source };
      }
      return result;
    },
  });
}
