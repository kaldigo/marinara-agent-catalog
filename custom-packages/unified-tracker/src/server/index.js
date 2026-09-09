import { activateWithMariBridge } from "../../bridge-sdk/server.js";
import { settingsFromChat, unifiedIsActive } from "../shared/settings.js";
import {
  applyUnifiedPackageState,
  nativeDerivedResults,
  normalizeUnifiedResult,
  readUnifiedCheckpoint,
  validateUnifiedResult,
} from "../shared/result.js";
import { buildUnifiedPromptExtension, formatUnifiedAgentState, formatUnifiedCheckpoint } from "./prompt.js";

async function loadChat(runtime, chatId) {
  return chatId ? runtime.persistence.getChat(chatId) : null;
}

async function loadSettings(runtime, chatId) {
  return settingsFromChat(await loadChat(runtime, chatId));
}

function checkpointBlock(content, messageId) {
  return [
    `<unified_tracker_checkpoint message_id="${String(messageId ?? "").replace(/["&<>]/gu, "")}">`,
    "Read-only state produced for the preceding assistant message. Use it for continuity; do not copy it into prose.",
    content,
    "</unified_tracker_checkpoint>",
  ].join("\n");
}

export async function activate(context) {
  const runtime = context.api.runtime;
  return activateWithMariBridge(
    context,
    {
      consumerId: "unified-tracker",
      api: { major: 1, minMinor: 10 },
      require: ["agent.prompt", "agent.result-types", "consumer.sessions", "host.request", "prompt.transform-history", "runtime.health", "tracker.context"],
    },
    async (bridgeSession) => {
      bridgeSession.agentPrompts.register({
        id: "dynamic-sections",
        agentTypes: ["unified-tracker"],
        async extend({ context: contextForAgent }) {
          const settings = await loadSettings(runtime, contextForAgent.chatId);
          return buildUnifiedPromptExtension(settings, contextForAgent);
        },
      });

      bridgeSession.agentResults.register({
        id: "unified-update",
        resultType: "unified_tracker_update",
        agentTypes: ["unified-tracker"],
        needsCharacterHistory: true,
        async validate(scope) {
          const settings = await loadSettings(runtime, scope.chatId);
          validateUnifiedResult(scope.result?.data, settings);
        },
        async expand(scope) {
          const settings = await loadSettings(runtime, scope.chatId);
          const state = await scope.state.read();
          const normalized = normalizeUnifiedResult(scope.result?.data, settings, { state, agentContext: scope.agentContext });
          const derived = nativeDerivedResults(scope.result, normalized);
          scope.shared.set("unified", normalized);
          return derived;
        },
        async apply(scope) {
          const settings = await loadSettings(runtime, scope.chatId);
          const state = await scope.state.read();
          const normalized = scope.shared?.get("unified")
            ?? normalizeUnifiedResult(scope.result?.data, settings, { state, agentContext: scope.agentContext });
          const playerStats = applyUnifiedPackageState(state, normalized, {
            messageId: scope.messageId,
            swipeIndex: scope.swipeIndex,
          });
          await scope.state.update({ playerStats });
          scope.emitPatch?.({ playerStats });
          return { changed: true, sections: normalized.settings.sections };
        },
      });

      bridgeSession.trackerContext.register({
        id: "unified-tracker",
        agentTypes: ["unified-tracker"],
        order: 425,
        needsCharacterHistory: true,
        formatCommitted(scope) {
          const settings = settingsFromChat({ metadata: scope.chatMetadata });
          const content = formatUnifiedCheckpoint(scope.latestGameState, settings);
          return content ? { label: "Unified Tracker", content } : null;
        },
        formatAgentState(scope) {
          return formatUnifiedAgentState(scope.latestGameState);
        },
      });

      bridgeSession.prompts.transform({
        id: "source-depth-checkpoints",
        stage: "history",
        order: 425,
        async transform(messages, scope) {
          if (!scope.chatId) return messages;
          const chat = await loadChat(runtime, scope.chatId);
          if (!unifiedIsActive(chat)) return messages;
          const settings = settingsFromChat(chat);
          if (!settings.addToMainPrompt) return messages;
          const output = [];
          for (const message of messages) {
            output.push(message);
            if (message?.role !== "assistant" || !message?.id) continue;
            const gameState = await bridgeSession.host.request({
              method: "GET",
              path: `/api/chats/${encodeURIComponent(scope.chatId)}/messages/${encodeURIComponent(message.id)}/game-state`,
            }).catch(() => null);
            if (!gameState?.committed || !readUnifiedCheckpoint(gameState)) continue;
            const content = formatUnifiedCheckpoint(gameState, settings);
            if (content) output.push({ role: "user", content: checkpointBlock(content, message.id), contextKind: "history" });
          }
          return output;
        },
      });

      runtime.logger.info("Unified Tracker 1.0 activated through Mari Bridge.");
    },
  );
}

export async function selfCheck(context) {
  if (typeof context?.api?.runtime?.persistence?.getChat !== "function") throw new Error("Unified Tracker chat persistence is unavailable");
}
