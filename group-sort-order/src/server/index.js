import { activateWithMariBridge } from "../../../_mari-bridge/sdk/server.js";
import {
  DEFAULT_GROUP_SORT_PROMPT_TEMPLATE,
  DEFAULT_GROUP_SORT_SELECTOR_PROMPT,
  GROUP_SORT_ORDER_AGENT_TYPE,
  buildCandidateHash,
  buildInstructionText,
  deriveNextParticipant,
  filterCandidates,
  isGroupSortEnabled,
  normalizeObject,
  parseSmartGroupSelectionIds,
  readGroupSortState,
  resolveActiveCharacterIds,
  resolveLatestParticipant,
  upsertAnchor,
  writeGroupSortState,
} from "../shared/state.js";

function truncate(value, limit) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);
}

function parseResourceData(value) {
  return normalizeObject(value?.data ?? value);
}

function displayName(value, fallback) {
  const data = parseResourceData(value);
  return String(data.name ?? data.displayName ?? fallback).trim() || fallback;
}

async function readAgentConfig(runtime, bridgeSession) {
  const capabilityConfig = await runtime.getAgentConfig?.();
  const configs = await bridgeSession.host.request({ method: "GET", path: "/api/agents" });
  const nativeConfig = Array.isArray(configs)
    ? configs.find((config) => config?.type === GROUP_SORT_ORDER_AGENT_TYPE)
    : null;
  const settings = {
    ...(capabilityConfig?.settings ?? {}),
    ...(nativeConfig?.settings && typeof nativeConfig.settings === "object" ? nativeConfig.settings : {}),
  };
  return {
    connectionId: nativeConfig?.connectionId ?? capabilityConfig?.connectionId ?? null,
    mainPrompt: String(nativeConfig?.promptTemplate ?? "").trim() || DEFAULT_GROUP_SORT_PROMPT_TEMPLATE,
    selectorPrompt: String(settings.selectorPrompt ?? "").trim() || DEFAULT_GROUP_SORT_SELECTOR_PROMPT,
    temperature: Number.isFinite(settings.temperature) ? settings.temperature : 0.2,
    maxTokens: Number.isInteger(settings.maxTokens) ? settings.maxTokens : 128,
  };
}

async function resolvePersona(runtime, chat) {
  const personaId = typeof chat?.personaId === "string" ? chat.personaId.trim() : "";
  if (!personaId) return null;
  const rows = await runtime.resources.listPersonas([personaId]);
  const row = rows.find((candidate) => candidate.id === personaId) ?? rows[0];
  if (!row) return { id: personaId, name: personaId, kind: "persona", talkativeness: 50 };
  const data = parseResourceData(row);
  return {
    id: personaId,
    name: displayName(row, personaId),
    kind: "persona",
    talkativeness: 50,
    personality: truncate(data.personality, 500),
    description: truncate(data.description, 500),
  };
}

async function resolveCandidates(runtime, chat, state = readGroupSortState(chat?.metadata)) {
  const characterIds = resolveActiveCharacterIds(chat);
  const rows = await runtime.resources.listCharacters(characterIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const candidates = characterIds.map((id) => {
    const row = byId.get(id);
    const data = parseResourceData(row);
    const rawTalkativeness = Number(data.talkativeness);
    const talkativeness = Number.isFinite(rawTalkativeness)
      ? Math.round(rawTalkativeness <= 1 ? rawTalkativeness * 100 : rawTalkativeness)
      : 50;
    return {
      id,
      name: displayName(row, id),
      kind: "character",
      talkativeness,
      personality: truncate(data.personality, 500),
      description: truncate(data.description, 500),
    };
  });
  const persona = await resolvePersona(runtime, chat);
  if (state.includePersonaCandidate && persona) candidates.push(persona);
  return { candidates, persona, characterCount: characterIds.length };
}

function formatCandidates(candidates) {
  return candidates.map((candidate) => [
    `- id: ${candidate.id}`,
    `  name: ${candidate.name}`,
    `  kind: ${candidate.kind}`,
    `  talkativeness: ${candidate.talkativeness}%`,
    candidate.personality ? `  personality: ${candidate.personality}` : null,
    candidate.description ? `  description: ${candidate.description}` : null,
  ].filter(Boolean).join("\n")).join("\n");
}

function formatTranscript(messages, candidates, personaName) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .slice(-5)
    .map((message) => {
      const speaker = message.role === "user"
        ? personaName || "User"
        : candidates.find((candidate) => candidate.id === message.characterId)?.name || "Narrator";
      const content = truncate(message.content, 900);
      return content ? `${speaker}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function selectParticipant({ runtime, bridgeSession, chat, messages, candidates }) {
  if (candidates.length === 0) return null;
  const config = await readAgentConfig(runtime, bridgeSession);
  const model = await runtime.languageModels.resolveForRequest({
    connectionId: config.connectionId || undefined,
    chatConnectionId: chat.connectionId || undefined,
  });
  const personaName = candidates.find((candidate) => candidate.kind === "persona")?.name ?? "User";
  const result = await model.chatComplete([
    { role: "system", content: config.selectorPrompt },
    {
      role: "user",
      content: [
        `<persona>${personaName}</persona>`,
        "<candidates>",
        formatCandidates(candidates),
        "</candidates>",
        "<recent_transcript>",
        formatTranscript(messages, candidates, personaName) || "No recent transcript.",
        "</recent_transcript>",
      ].join("\n"),
    },
  ], { temperature: config.temperature, maxTokens: config.maxTokens, stream: false });
  const selectedId = parseSmartGroupSelectionIds(result?.content, candidates)[0];
  return candidates.find((candidate) => candidate.id === selectedId) ?? null;
}

async function patchState(runtime, chatId, statePatch) {
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat) return null;
  await runtime.persistence.updateChatMetadata({
    chatId,
    metadata: writeGroupSortState(chat.metadata, statePatch),
    updatedAt: new Date().toISOString(),
  });
  return runtime.persistence.getChat(chatId);
}

async function buildView(runtime, chatId) {
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isGroupSortEnabled(chat)) return null;
  const state = readGroupSortState(chat.metadata);
  const messages = await runtime.persistence.listMessages(chatId);
  const { candidates, persona, characterCount } = await resolveCandidates(runtime, chat, state);
  const candidateHash = buildCandidateHash(candidates, state.includePersonaCandidate);
  const nextParticipant = deriveNextParticipant({ state, messages, candidates, candidateHash });
  return {
    chatId,
    hidden: characterCount < 2,
    includePersonaCandidate: state.includePersonaCandidate,
    hasPersona: Boolean(persona),
    nextParticipant,
    status: nextParticipant ? "known" : "unknown",
    canRefresh: characterCount >= 2 && filterCandidates(candidates, resolveLatestParticipant(messages, candidates)?.id).length > 0,
  };
}

async function createHandoffRegistration(runtime, bridgeSession) {
  return {
    id: "next-participant",
    agentTypes: [GROUP_SORT_ORDER_AGENT_TYPE],
    priority: 100,
    async resolve(scope) {
      if (scope.hasIncomingUserTurn) return null;
      const chat = await runtime.persistence.getChat(scope.chatId);
      if (!chat || !isGroupSortEnabled(chat)) return null;
      const state = readGroupSortState(chat.metadata);
      const messages = await runtime.persistence.listMessages(chat.id);
      const { candidates } = await resolveCandidates(runtime, chat, state);
      const candidateHash = buildCandidateHash(candidates, state.includePersonaCandidate);
      return deriveNextParticipant({ state, messages, candidates, candidateHash });
    },
    async validate(scope) {
      if (scope.impersonate) return null;
      const chat = await runtime.persistence.getChat(scope.chatId);
      if (!chat || !isGroupSortEnabled(chat)) return null;
      const state = readGroupSortState(chat.metadata);
      const { candidates } = await resolveCandidates(runtime, chat, state);
      const participant = candidates.find((candidate) => candidate.id === scope.participantId) ?? null;
      if (!participant || participant.id === scope.targetCharacterId) return null;
      return participant;
    },
    async commit(scope) {
      const chat = await runtime.persistence.getChat(scope.chatId);
      if (!chat || !isGroupSortEnabled(chat)) return null;
      const state = readGroupSortState(chat.metadata);
      const { candidates } = await resolveCandidates(runtime, chat, state);
      const candidateHash = buildCandidateHash(candidates, state.includePersonaCandidate);
      if (!candidates.some((candidate) => candidate.id === scope.participant.id)) return null;
      await patchState(runtime, chat.id, upsertAnchor(state, {
        messageId: scope.messageId,
        swipeIndex: scope.swipeIndex,
        messageParticipantId: scope.messageSpeakerId,
        nextParticipantId: scope.participant.id,
        candidateHash,
        source: "marker",
      }));
      return scope.participant;
    },
    view: (scope) => buildView(runtime, scope.chatId),
    async update(scope) {
      const chat = await runtime.persistence.getChat(scope.chatId);
      if (!chat || !isGroupSortEnabled(chat)) return null;
      const state = readGroupSortState(chat.metadata);
      const includePersonaCandidate = typeof scope.patch?.includePersonaCandidate === "boolean"
        ? scope.patch.includePersonaCandidate
        : state.includePersonaCandidate;
      await patchState(runtime, chat.id, { includePersonaCandidate, candidateHash: "", byAnchor: {} });
      return buildView(runtime, chat.id);
    },
    async refresh(scope) {
      const chat = await runtime.persistence.getChat(scope.chatId);
      if (!chat || !isGroupSortEnabled(chat)) return null;
      const state = readGroupSortState(chat.metadata);
      const messages = await runtime.persistence.listMessages(chat.id);
      const { candidates, characterCount } = await resolveCandidates(runtime, chat, state);
      if (characterCount < 2) return buildView(runtime, chat.id);
      const latest = [...messages].reverse().find((message) => message?.id && ["user", "assistant"].includes(message.role));
      const current = resolveLatestParticipant(messages, candidates);
      const selectable = filterCandidates(candidates, current?.id);
      let selected = null;
      try {
        selected = await selectParticipant({ runtime, bridgeSession, chat, messages, candidates: selectable });
      } catch (error) {
        runtime.logger.warn("[Group Sort Order] Refresh selector failed for chat %s: %s", chat.id, error);
      }
      const candidateHash = buildCandidateHash(candidates, state.includePersonaCandidate);
      if (!latest || !selected) {
        await patchState(runtime, chat.id, { candidateHash, byAnchor: {} });
        return buildView(runtime, chat.id);
      }
      await patchState(runtime, chat.id, upsertAnchor(state, {
        messageId: latest.id,
        swipeIndex: Number.isInteger(latest.activeSwipeIndex) ? latest.activeSwipeIndex : 0,
        messageParticipantId: current?.id ?? "",
        nextParticipantId: selected.id,
        candidateHash,
        source: "refresh",
      }));
      return buildView(runtime, chat.id);
    },
  };
}

async function selectNativeFallback(scope, runtime, bridgeSession) {
  const chat = await runtime.persistence.getChat(scope.chatId);
  if (!chat || !isGroupSortEnabled(chat)) return [];
  const messages = await runtime.persistence.listMessages(chat.id);
  const candidates = (Array.isArray(scope.candidates) ? scope.candidates : []).map((candidate) => ({
    ...candidate,
    id: String(candidate.id),
    name: String(candidate.displayName ?? candidate.name ?? candidate.id),
    kind: "character",
  }));
  const current = resolveLatestParticipant(messages, candidates);
  const selected = await selectParticipant({
    runtime,
    bridgeSession,
    chat,
    messages,
    candidates: filterCandidates(candidates, current?.id),
  });
  return selected?.kind === "character" ? [selected.id] : [];
}

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "group-sort-order",
      api: { major: 1, minMinor: 5 },
      require: ["consumer.sessions", "group.selector", "host.request", "prompt.inject", "runtime.health", "turn.handoff"],
    },
    async (bridgeSession) => {
      const runtime = context.api.runtime;
      bridgeSession.prompts.inject({
        id: "next-participant-marker",
        position: "end",
        role: "system",
        order: 40,
        when: (scope) => scope.lane === "main" && !scope.impersonate && scope.workflow === "chat",
        async build(scope) {
          if (!scope.chatId) return "";
          const chat = await runtime.persistence.getChat(scope.chatId);
          if (!chat || !isGroupSortEnabled(chat)) return "";
          const state = readGroupSortState(chat.metadata);
          const { candidates, characterCount } = await resolveCandidates(runtime, chat, state);
          if (characterCount < 2) return "";
          const messages = await runtime.persistence.listMessages(chat.id);
          const currentParticipantId = scope.characterIds?.[0] || resolveLatestParticipant(messages, candidates)?.id || "";
          const config = await readAgentConfig(runtime, bridgeSession);
          return buildInstructionText(candidates, currentParticipantId, config.mainPrompt);
        },
      });
      bridgeSession.turnHandoffs.register(await createHandoffRegistration(runtime, bridgeSession));
      bridgeSession.groupSelectors.register({
        id: "fallback-selector",
        agentTypes: [GROUP_SORT_ORDER_AGENT_TYPE],
        priority: 100,
        select: (scope) => selectNativeFallback(scope, runtime, bridgeSession),
      });
      runtime.logger.info("Group Sort Order registered native next-participant handoff behavior.");
    },
  );
}

export async function selfCheck(context) {
  if (typeof context?.api?.runtime?.languageModels?.resolveForRequest !== "function") {
    throw new Error("Group Sort Order language-model host is unavailable");
  }
  if (typeof context?.api?.runtime?.resources?.listPersonas !== "function") {
    throw new Error("Group Sort Order persona resource host is unavailable");
  }
}
