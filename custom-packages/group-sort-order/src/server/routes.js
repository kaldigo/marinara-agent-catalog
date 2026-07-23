import {
  clearPromptContribution,
  getPromptContribution,
  listPromptContributions,
  registerPromptContributionBridge,
  registerPromptContributor,
  setPromptContribution,
} from "../../bridge/prompt-contribution.js";
import {
  GROUP_SORT_ORDER_AGENT_TYPE,
  buildCandidateHash,
  buildInstructionText,
  deriveNextSpeaker,
  isGroupSortEnabled,
  normalizeGroupSortState,
  normalizeObject,
  parseSmartGroupSelectionIds,
  parseTerminalNextSpeakerMarker,
  readGroupSortState,
  resolveActiveCharacterIds,
  stripTerminalNextSpeakerMarker,
  upsertAnchor,
  writeGroupSortState,
} from "../shared/state.js";

const REQUEST_STATE = new WeakMap();
const INTERNAL_HEADER = "x-group-sort-order-internal";

export function registerGroupSortHooks({ app, runtime }) {
  const cleanupBridge = registerPromptContributionBridge({ app, runtime, internalHeader: INTERNAL_HEADER });
  const cleanupContributor = registerPromptContributor({
    agentType: GROUP_SORT_ORDER_AGENT_TYPE,
    agentName: "Group Sort Order",
    resolve: async ({ body, chatId }) => {
      if (body.impersonate === true || body.turnGameBots === true) return null;
      const chat = await runtime.persistence.getChat(chatId);
      if (!chat || !isGroupSortEnabled(chat)) return null;
      const state = readGroupSortState(chat.metadata);
      const candidates = await resolveCandidates(runtime, chat, state);
      if (candidates.length <= 2) return null;
      return buildInstructionText(candidates);
    },
  });
  app.addHook("preHandler", async (request) => {
    await prepareGeneration({ runtime, request });
  });
  app.addHook("onResponse", async (request, reply) => {
    try {
      await finishGeneration({ app, runtime, request, reply });
    } catch (error) {
      runtime.logger.warn(error, "[Group Sort Order] generation hook failed");
    }
  });
  return () => {
    cleanupContributor();
    cleanupBridge();
  };
}

export function createGroupSortRoutes({ app, runtime }) {
  app.get("/chat/:chatId/state", async (req, reply) => {
    const chat = await runtime.persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const view = await buildView(runtime, chat);
    return { ok: true, ...view };
  });

  app.post("/chat/:chatId/ensure", async (req, reply) => {
    const chat = await runtime.persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (!isGroupSortEnabled(chat)) {
      clearGroupSortPromptContribution(chat.id);
      return { ok: true, clearedContribution: true, ...(await buildView(runtime, chat)) };
    }
    const body = normalizeObject(req.body);
    const current = readGroupSortState(chat.metadata);
    const personaCandidate = normalizePersonaCandidate(body.personaCandidate) ?? current.personaCandidate;
    const includePersonaCandidate =
      typeof body.includePersonaCandidate === "boolean" ? body.includePersonaCandidate : current.includePersonaCandidate;
    const candidates = await resolveCandidates(runtime, chat, { includePersonaCandidate, personaCandidate });
    const candidateHash = buildCandidateHash(candidates, { includePersonaCandidate });
    await patchChatState(runtime, chat, {
      includePersonaCandidate,
      personaCandidate,
      candidateHash,
      byAnchor: candidates.length <= 2 ? {} : current.byAnchor,
    });
    reconcileGroupSortPromptContribution(chat.id, candidates);
    return { ok: true, ...(await buildView(runtime, (await runtime.persistence.getChat(chat.id)) || chat)) };
  });

  app.patch("/chat/:chatId/settings", async (req, reply) => {
    const chat = await runtime.persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const body = normalizeObject(req.body);
    const current = readGroupSortState(chat.metadata);
    const includePersonaCandidate =
      typeof body.includePersonaCandidate === "boolean" ? body.includePersonaCandidate : current.includePersonaCandidate;
    const personaCandidate = normalizePersonaCandidate(body.personaCandidate) ?? current.personaCandidate;
    await patchChatState(runtime, chat, { includePersonaCandidate, personaCandidate });
    const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
    const view = await buildView(runtime, freshChat);
    reconcileGroupSortPromptContribution(chat.id, view.candidates);
    return { ok: true, ...view };
  });

  app.post("/chat/:chatId/refresh", async (req, reply) => {
    const chat = await runtime.persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const view = await buildView(runtime, chat);
    if (!view.enabled || view.hidden) return { ok: true, refreshed: false, ...view };
    const selected = await refreshSmartSelection({
      app,
      runtime,
      chat,
      candidates: view.candidates,
      candidateHash: view.candidateHash,
      personaName: resolvePersonaName(chat, view.candidates, readGroupSortState(chat.metadata)),
    });
    const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
    return { ok: true, refreshed: selected !== null, selectedSpeakerId: selected?.id ?? null, ...(await buildView(runtime, freshChat)) };
  });

  app.get("/prompt-contributions/:chatId", async (req) => {
    return { ok: true, chatId: req.params.chatId, contributions: listPromptContributions(req.params.chatId) };
  });

  app.get("/prompt-contributions/:chatId/:agentType", async (req) => {
    return {
      ok: true,
      chatId: req.params.chatId,
      agentType: req.params.agentType,
      contribution: getPromptContribution(req.params.chatId, req.params.agentType),
    };
  });

  app.put("/prompt-contributions/:chatId/:agentType", async (req) => {
    const body = normalizeObject(req.body);
    const text = body.text === null ? null : typeof body.text === "string" ? body.text : "";
    const contribution = setPromptContribution(req.params.chatId, {
      agentType: req.params.agentType,
      agentName: typeof body.agentName === "string" ? body.agentName : req.params.agentType,
      text,
    });
    return {
      ok: true,
      chatId: req.params.chatId,
      agentType: req.params.agentType,
      contribution,
    };
  });

  app.delete("/prompt-contributions/:chatId/:agentType", async (req) => {
    return {
      ok: true,
      chatId: req.params.chatId,
      agentType: req.params.agentType,
      cleared: clearPromptContribution(req.params.chatId, req.params.agentType),
    };
  });
}

async function prepareGeneration({ runtime, request }) {
  if (isInternalRequest(request)) return;
  if (String(request.method || "").toUpperCase() !== "POST") return;
  if (!/^\/api\/generate(?:[?#].*)?$/u.test(String(request.url || ""))) return;
  const body = normalizeObject(request.body);
  if (body.impersonate === true || body.turnGameBots === true) return;
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isGroupSortEnabled(chat)) return;
  const messages = await runtime.persistence.listMessages(chatId);
  const candidates = await resolveCandidates(runtime, chat, readGroupSortState(chat.metadata));
  if (candidates.length <= 2) return;

  const candidateHash = buildCandidateHash(candidates, { includePersonaCandidate: readGroupSortState(chat.metadata).includePersonaCandidate });
  const next = deriveNextSpeaker({ state: readGroupSortState(chat.metadata), messages, candidates, candidateHash });
  const beforeMessageIds = new Set(messages.map((message) => message.id));
  if (next && next.kind !== "persona" && !body.forCharacterId) {
    body.forCharacterId = next.id;
  }
  request.body = body;
  REQUEST_STATE.set(request, { chatId, beforeMessageIds, candidateHash, candidateIds: candidates.map((c) => c.id) });
}

async function finishGeneration({ app, runtime, request, reply }) {
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;
  const state = REQUEST_STATE.get(request);
  if (!state) return;
  REQUEST_STATE.delete(request);
  const chat = await runtime.persistence.getChat(state.chatId);
  if (!chat || !isGroupSortEnabled(chat)) return;
  const messages = await runtime.persistence.listMessages(state.chatId);
  const created = messages.filter((message) => !state.beforeMessageIds.has(message.id));
  const target = created.reverse().find((message) => message.role === "assistant" && typeof message.content === "string");
  if (!target) return;
  const parsed = parseTerminalNextSpeakerMarker(target.content);
  if (!parsed || !state.candidateIds.includes(parsed.speakerId)) return;
  const cleaned = stripTerminalNextSpeakerMarker(target.content);
  if (cleaned !== target.content) {
    await injectJson(
      app,
      "PATCH",
      `/api/chats/${encodeURIComponent(state.chatId)}/messages/${encodeURIComponent(target.id)}`,
      { content: cleaned },
    );
  }
  const current = readGroupSortState(chat.metadata);
  const nextState = upsertAnchor(current, {
    messageId: target.id,
    swipeIndex: Number.isInteger(target.activeSwipeIndex) ? target.activeSwipeIndex : 0,
    messageSpeakerId: target.characterId ?? "",
    nextSpeakerId: parsed.speakerId,
    candidateHash: state.candidateHash,
  });
  await patchChatState(runtime, chat, nextState);
}

async function buildView(runtime, chat) {
  const state = readGroupSortState(chat.metadata);
  const messages = await runtime.persistence.listMessages(chat.id);
  const candidates = await resolveCandidates(runtime, chat, state);
  const candidateHash = buildCandidateHash(candidates, { includePersonaCandidate: state.includePersonaCandidate });
  const next = candidates.length > 2 ? deriveNextSpeaker({ state, messages, candidates, candidateHash }) : null;
  return {
    chatId: chat.id,
    enabled: isGroupSortEnabled(chat),
    includePersonaCandidate: state.includePersonaCandidate,
    candidates,
    candidateHash,
    nextSpeaker: next,
    status: next ? "known" : "unknown",
    hidden: candidates.length <= 2,
  };
}

async function resolveCandidates(runtime, chat, state) {
  const activeIds = resolveActiveCharacterIds(chat);
  const characterRows = await runtime.resources.listCharacters(activeIds);
  const byId = new Map(characterRows.map((row) => [row.id, readCharacterCandidate(row)]));
  const candidates = activeIds.map((id) => byId.get(id) || { id, name: id, kind: "character", talkativeness: 50 });
  const normalizedState = normalizeGroupSortState(state);
  if (normalizedState.includePersonaCandidate && normalizedState.personaCandidate) {
    candidates.push({ ...normalizedState.personaCandidate, talkativeness: 50 });
  }
  return candidates;
}

async function refreshSmartSelection({ app, runtime, chat, candidates, candidateHash, personaName }) {
  const messages = await runtime.persistence.listMessages(chat.id);
  const anchorMessage = latestAnchorMessage(messages);
  if (!anchorMessage) return null;
  const selectedId = await selectSmartSpeakerViaRaw({ app, runtime, chat, messages, candidates, personaName });
  const selected = candidates.find((candidate) => candidate.id === selectedId) || null;
  if (!selected) {
    await patchChatState(runtime, chat, { candidateHash, byAnchor: {} });
    return null;
  }
  const current = readGroupSortState(chat.metadata);
  const nextState = upsertAnchor(current, {
    messageId: anchorMessage.id,
    swipeIndex: Number.isInteger(anchorMessage.activeSwipeIndex) ? anchorMessage.activeSwipeIndex : 0,
    messageSpeakerId: anchorMessage.characterId ?? "",
    nextSpeakerId: selected.id,
    candidateHash,
  });
  await patchChatState(runtime, chat, nextState);
  return selected;
}

async function selectSmartSpeakerViaRaw({ app, runtime, chat, messages, candidates, personaName }) {
  const connectionId = typeof chat.connectionId === "string" ? chat.connectionId : "";
  if (!connectionId) return "";
  try {
    const response = await injectJson(app, "POST", "/api/generate/raw", {
      connectionId,
      messages: buildSmartSelectionPrompt({ messages, candidates, personaName }),
      parameters: {
        temperature: 0.2,
        maxTokens: 512,
        topP: 1,
      },
      streaming: false,
    });
    return parseSmartGroupSelectionIds(response.content, candidates)[0] || "";
  } catch (error) {
    runtime.logger.warn(error, "[Group Sort Order] refresh selector failed; leaving next speaker unknown");
    return "";
  }
}

function buildSmartSelectionPrompt({ messages, candidates, personaName }) {
  return [
    {
      role: "system",
      content: [
        "You are a hidden response orchestrator for a roleplay group chat.",
        "Choose which character or characters should respond next, based on the latest user message, recent scene context, relevance, personality, and who has spoken recently.",
        "Usually choose exactly one character. Choose multiple only when multiple characters have a strong immediate reason to answer.",
        "Do not always choose the first character. Avoid making the same character speak twice in a row unless the context clearly calls for it.",
        'Return ONLY a valid JSON array of character IDs, such as ["character-id"]. No prose, no object wrapper, no markdown.',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `<persona>${personaName}</persona>`,
        "<candidates>",
        formatSmartGroupCandidates(candidates),
        "</candidates>",
        "<recent_transcript>",
        buildRecentTranscript({ messages, candidates, personaName }) || "No recent transcript.",
        "</recent_transcript>",
      ].join("\n"),
    },
  ];
}

function formatSmartGroupCandidates(candidates) {
  return candidates
    .map((candidate) => {
      const fields = [
        `id: ${candidate.id}`,
        `name: ${candidate.name}`,
        `talkativeness: ${normalizeTalkativenessPercent(candidate.talkativeness)}%`,
        candidate.status !== undefined ? `current status: ${candidate.status}` : null,
        candidate.activity ? `current activity: ${candidate.activity}` : null,
        candidate.personality ? `personality: ${String(candidate.personality).slice(0, 500)}` : null,
        candidate.description ? `description: ${String(candidate.description).slice(0, 500)}` : null,
      ].filter((field) => field !== null);
      return fields.map((field, index) => `${index === 0 ? "- " : "  "}${field}`).join("\n");
    })
    .join("\n\n");
}

function buildRecentTranscript({ messages, candidates, personaName }) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-5)
    .map((message) => {
      const speaker = resolveMessageSpeakerName(message, candidates, personaName);
      const content = stripTerminalNextSpeakerMarker(String(message.content || ""))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 900);
      return content ? `${speaker}: ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function resolveMessageSpeakerName(message, candidates, personaName) {
  if (message.role === "user") return personaName;
  if (message.characterId) return candidates.find((candidate) => candidate.id === message.characterId)?.name ?? "Character";
  return "the narrator";
}

function latestAnchorMessage(messages) {
  return [...messages].reverse().find((message) => message?.id && (message.role === "user" || message.role === "assistant")) ?? null;
}

function readCharacterCandidate(row) {
  const parsed = normalizeObject(row.data);
  return {
    id: row.id,
    name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : row.id,
    kind: "character",
    talkativeness: normalizeTalkativenessPercent(parsed.talkativeness),
    personality: typeof parsed.personality === "string" ? parsed.personality.slice(0, 500) : "",
    description: typeof parsed.description === "string" ? parsed.description.slice(0, 500) : "",
  };
}

function normalizeTalkativenessPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function resolvePersonaName(chat, candidates, state) {
  const personaId = typeof chat.personaId === "string" ? chat.personaId : "";
  const statePersona = normalizeGroupSortState(state).personaCandidate;
  return candidates.find((candidate) => candidate.id === personaId)?.name ?? statePersona?.name ?? "Persona";
}

function normalizePersonaCandidate(value) {
  const obj = normalizeObject(value);
  if (typeof obj.id !== "string" || !obj.id.trim()) return null;
  return {
    id: obj.id,
    name: typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : obj.id,
    kind: "persona",
  };
}

function reconcileGroupSortPromptContribution(chatId, candidates) {
  if (!Array.isArray(candidates) || candidates.length <= 2) {
    clearGroupSortPromptContribution(chatId);
    return null;
  }
  return setPromptContribution(chatId, {
    agentType: GROUP_SORT_ORDER_AGENT_TYPE,
    agentName: "Group Sort Order",
    text: buildInstructionText(candidates),
  });
}

function clearGroupSortPromptContribution(chatId) {
  return clearPromptContribution(chatId, GROUP_SORT_ORDER_AGENT_TYPE);
}

async function patchChatState(runtime, chat, statePatch) {
  const currentMetadata = normalizeObject(chat.metadata);
  const manualTrackerAgentTypes = normalizeObject(currentMetadata.manualTrackerAgentTypes);
  await runtime.persistence.updateChatMetadata({
    chatId: chat.id,
    metadata: {
      ...writeGroupSortState(currentMetadata, statePatch),
      manualTrackerAgentTypes: {
        ...manualTrackerAgentTypes,
        [GROUP_SORT_ORDER_AGENT_TYPE]: true,
      },
    },
    updatedAt: new Date().toISOString(),
  });
}

async function injectJson(app, method, url, payload) {
  const response = await app.inject({
    method,
    url,
    headers: { [INTERNAL_HEADER]: "1" },
    ...(payload === undefined ? {} : { payload }),
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.payload || `${response.statusCode} ${response.statusMessage}`);
  }
  if (!response.payload || response.statusCode === 204) return {};
  return JSON.parse(response.payload);
}

function isInternalRequest(request) {
  const value = request.headers?.[INTERNAL_HEADER];
  return value === "1" || value === "true" || (Array.isArray(value) && value.includes("1"));
}
