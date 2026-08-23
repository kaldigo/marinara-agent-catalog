import { activateWithMariBridge } from "../../../_mari-bridge/sdk/server.js";
import {
  DEFAULT_GROUP_SORT_SELECTOR_PROMPT,
  GROUP_SORT_ORDER_AGENT_TYPE,
  parseSmartGroupSelectionIds,
} from "../shared/state.js";

function truncate(value, limit) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);
}

function candidateName(candidate) {
  return String(candidate?.displayName ?? candidate?.name ?? candidate?.id ?? "Unknown");
}

function formatCandidates(candidates) {
  return candidates.map((candidate) => [
    `- id: ${candidate.id}`,
    `  name: ${candidateName(candidate)}`,
    `  talkativeness: ${Number.isFinite(candidate?.talkativeness) ? candidate.talkativeness : "unknown"}`,
    candidate?.personality ? `  personality: ${truncate(candidate.personality, 500)}` : null,
    candidate?.description ? `  description: ${truncate(candidate.description, 500)}` : null,
  ].filter(Boolean).join("\n")).join("\n");
}

function messageSpeaker(message, personaName, candidates) {
  if (message?.role === "user") return personaName || "User";
  const character = candidates.find((candidate) => candidate.id === message?.characterId);
  return character ? candidateName(character) : "Narrator";
}

function formatTranscript(messages, personaName, candidates) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .slice(-5)
    .map((message) => `${messageSpeaker(message, personaName, candidates)}: ${truncate(message?.content, 900)}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

async function readNativeAgentConfig(runtime, bridgeSession) {
  const capabilityConfig = await runtime.getAgentConfig?.();
  const configs = await bridgeSession.host.request({ method: "GET", path: "/api/agents" });
  const nativeConfig = Array.isArray(configs)
    ? configs.find((config) => config?.type === GROUP_SORT_ORDER_AGENT_TYPE)
    : null;
  return {
    connectionId: nativeConfig?.connectionId ?? capabilityConfig?.connectionId ?? null,
    promptTemplate: String(nativeConfig?.promptTemplate ?? "").trim() || DEFAULT_GROUP_SORT_SELECTOR_PROMPT,
    settings: {
      ...(capabilityConfig?.settings ?? {}),
      ...(nativeConfig?.settings && typeof nativeConfig.settings === "object" ? nativeConfig.settings : {}),
    },
  };
}

async function selectResponders(scope, runtime, bridgeSession) {
  const candidates = Array.isArray(scope?.candidates) ? scope.candidates : [];
  if (candidates.length === 0) return [];
  try {
    const config = await readNativeAgentConfig(runtime, bridgeSession);
    const model = await runtime.languageModels.resolveForRequest({
      connectionId: config.connectionId || undefined,
      chatConnectionId: scope?.chatConnectionId || undefined,
    });
    const prompt = [
      {
        role: "system",
        content: config.promptTemplate,
      },
      {
        role: "user",
        content: [
          `<persona>${String(scope?.personaName ?? "User")}</persona>`,
          "<candidates>",
          formatCandidates(candidates),
          "</candidates>",
          "<recent_transcript>",
          formatTranscript(scope?.messages, scope?.personaName, candidates) || "No recent transcript.",
          "</recent_transcript>",
        ].join("\n"),
      },
    ];
    const result = await model.chatComplete(prompt, {
      temperature: Number.isFinite(config.settings.temperature) ? config.settings.temperature : 0.2,
      maxTokens: Number.isInteger(config.settings.maxTokens) ? config.settings.maxTokens : 256,
      stream: false,
    });
    const selected = parseSmartGroupSelectionIds(result?.content, candidates);
    if (selected.length === 0) {
      runtime.logger.warn("[Group Sort Order] Selector returned no valid responders for chat %s", scope?.chatId);
    }
    return selected;
  } catch (error) {
    runtime.logger.warn("[Group Sort Order] Selector failed for chat %s: %s", scope?.chatId, error);
    return [];
  }
}

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "group-sort-order",
      api: { major: 1, minMinor: 2 },
      require: ["consumer.sessions", "group.selector", "host.request", "runtime.health"],
    },
    async (bridgeSession) => {
      bridgeSession.groupSelectors.register({
        id: "native-smart-selector",
        agentTypes: [GROUP_SORT_ORDER_AGENT_TYPE],
        priority: 100,
        select: (scope) => selectResponders(scope, context.api.runtime, bridgeSession),
      });
      context.api.runtime.logger.info("Group Sort Order registered its native smart group selector.");
    },
  );
}

export async function selfCheck(context) {
  if (typeof context?.api?.runtime?.languageModels?.resolveForRequest !== "function") {
    throw new Error("Group Sort Order language-model host is unavailable");
  }
}
