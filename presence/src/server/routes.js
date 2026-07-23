import {
  buildPresenceLorebookName,
  readPresenceChatState,
  writePresenceChatState,
} from "../shared/chat-state.js";
import { PRESENCE_PACKAGE_ID } from "../shared/constants.js";
import { buildPresenceExtraPatch, normalizeObject, readPresenceState, uniqueStrings } from "../shared/presence-state.js";
import { planRosterBackfill } from "../shared/roster.js";
import { injectHostJson } from "../../../_mari-bridge/src/host-routes.js";
import { parseMessageRange } from "../../../_mari-bridge/src/ranges.js";
import { diffSummaryEntries, inferSummaryHintFromRoute, readSummaryEntries } from "../../../_mari-bridge/src/summary-tracking.js";
import { createPresenceCommandRouter } from "./command-router.js";
import { buildSummaryAudience, buildSummaryLorebookEntries } from "./summary-mirror.js";

const MESSAGE_CREATE_HOOK_KEY = Symbol.for("marinara.presence.messageCreateHook");
const GENERATE_REQUEST_STATE = new WeakMap();
const SUMMARY_REQUEST_STATE = new WeakMap();

export function registerPresenceMessageCreateHook({ app, runtime }) {
  if (app[MESSAGE_CREATE_HOOK_KEY]) return;
  app[MESSAGE_CREATE_HOOK_KEY] = true;
  app.addHook("preHandler", async (request) => {
    await captureGenerationRequestState({ runtime, request });
    await captureSummaryRequestState({ runtime, request });
  });
  app.addHook("onSend", async (request, reply, payload) => {
    try {
      await stampCreatedMessage({ app, runtime, request, reply, payload });
      await ensureAfterChatSettingsChange({ app, runtime, request, reply });
      await reconcileSummariesAfterHostChange({ app, runtime, request, reply });
    } catch (error) {
      runtime.logger.warn(error, "[Presence] Could not process response hook");
    }
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    try {
      await finishGenerationLifecycle({ app, runtime, request, reply });
    } catch (error) {
      runtime.logger.warn(error, "[Presence] Could not finish generation lifecycle");
    }
  });
}

export function createPresenceRoutes({ app, runtime }) {
  const persistence = runtime.persistence;
  const logger = runtime.logger;

  app.get("/chat/:chatId/state", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const messages = await persistence.listMessages(req.params.chatId);
    const roster = await resolveRoster(runtime, chat);
    return {
      chatId: chat.id,
      roster,
      state: readPresenceChatState(chat),
      messages: messages.map((message, index) => ({
        id: message.id,
        index: index + 1,
        role: message.role,
        characterId: message.characterId,
        presence: [...readPresenceState(message, roster.map((character) => character.id))],
      })),
      summaries: readSummaryEntries(chat),
    };
  });

  app.post("/chat/:chatId/messages/:messageId/presence", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (!isPresenceTrackerEnabled(chat)) {
      return reply.status(409).send({ error: "Presence tracker is not enabled for this chat." });
    }
    const messages = await persistence.listMessages(req.params.chatId);
    const message = messages.find((item) => item.id === req.params.messageId);
    if (!message) return reply.status(404).send({ error: "Message not found" });
    const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
    const body = normalizeObject(req.body);
    const patch = buildPresenceExtraPatch({
      extra: message.extra,
      rosterIds,
      presentCharacterIds: uniqueStrings(body.presentCharacterIds),
    });
    await patchMessageExtra(app, req.params.chatId, req.params.messageId, patch);
    return { ok: true, patch };
  });

  app.post("/chat/:chatId/command", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (!isPresenceTrackerEnabled(chat)) {
      return reply.status(409).send({ error: "Presence tracker is not enabled for this chat." });
    }
    const raw = String(normalizeObject(req.body).text || "");
    const router = createPresenceCommandRouter({
      runPresenceCommand: (args) => runPresenceCommand({ ...args, app, runtime, chat }),
      runScopedHideCommand: (args) => runScopedHideCommand({ ...args, app, runtime, chat }),
    });
    try {
      const result = await router.run(raw, { chatId: chat.id });
      if (!result.handled) return reply.status(400).send({ error: "Unsupported Presence command" });
      return result.result ?? { ok: true };
    } catch (error) {
      logger.warn(error, "[Presence] command failed");
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/chat/:chatId/ensure", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const result = await ensurePresenceChatLifecycle({ app, runtime, chat });
    return { ok: true, ...result };
  });
}

async function captureGenerationRequestState({ runtime, request }) {
  if (isPresenceInternalRequest(request)) return;
  const method = String(request.method || "").toUpperCase();
  if (method !== "POST") return;
  const url = String(request.url || "");
  if (!isNormalGenerateUrl(url)) return;
  const body = normalizeObject(request.body);
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  const messages = await runtime.persistence.listMessages(chatId);
  GENERATE_REQUEST_STATE.set(request, {
    chatId,
    beforeMessageIds: new Set(messages.map((message) => message.id).filter(Boolean)),
    summaryEntriesBefore: readSummaryEntries(chat),
    regenerateMessageId: typeof body.regenerateMessageId === "string" ? body.regenerateMessageId : "",
    continueMessageId: typeof body.continueMessageId === "string" ? body.continueMessageId : "",
  });
}

async function captureSummaryRequestState({ runtime, request }) {
  if (isPresenceInternalRequest(request)) return;
  const url = String(request.url || "");
  if (url.includes("/api/presence/")) return;
  const body = normalizeObject(request.body);
  const hint = inferSummaryHintFromRoute(request.method, url, body);
  if (hint.source === "unknown") return;
  const chatId = extractChatRouteId(url) || (typeof body.chatId === "string" ? body.chatId : "");
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  SUMMARY_REQUEST_STATE.set(request, {
    chatId,
    hint,
    summaryEntriesBefore: readSummaryEntries(chat),
  });
}

async function stampCreatedMessage({ app, runtime, request, reply, payload }) {
  if (request.method !== "POST") return;
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;
  const url = String(request.url || "");
  if (!/^\/api\/chats\/[^/]+\/messages(?:[?#].*)?$/u.test(url)) return;
  const created = parsePayloadObject(payload);
  if (!created?.id || !isStampableMessageRole(created.role)) return;
  const chatId = typeof created.chatId === "string" && created.chatId ? created.chatId : extractMessageCreateChatId(url);
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  await stampMessageWithActivePresence({ app, runtime, chat, message: created, overwriteExisting: true });
}

async function finishGenerationLifecycle({ app, runtime, request, reply }) {
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;
  const state = GENERATE_REQUEST_STATE.get(request);
  if (!state) return;
  GENERATE_REQUEST_STATE.delete(request);
  const chat = await runtime.persistence.getChat(state.chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  await stampGeneratedMessages({ app, runtime, chat, state });
  const freshChat = (await runtime.persistence.getChat(state.chatId)) || chat;
  if (isPresenceTrackerEnabled(freshChat)) {
    const summaryEvents = diffSummaryEntries(state.summaryEntriesBefore, readSummaryEntries(freshChat), {
      source: "generation",
    });
    if (summaryEvents.length > 0) {
      await reconcileSummaryLorebook({ app, runtime, chat: freshChat });
    }
  }
}

async function stampGeneratedMessages({ app, runtime, chat, state }) {
  const messages = await runtime.persistence.listMessages(state.chatId);
  const createdMessages = messages.filter((message) => !state.beforeMessageIds.has(message.id));
  const targetIds = new Set(
    [
      ...createdMessages.filter((message) => isStampableMessageRole(message.role)).map((message) => message.id),
      state.regenerateMessageId,
      state.continueMessageId,
    ].filter(Boolean),
  );
  for (const message of messages) {
    if (!targetIds.has(message.id)) continue;
    await stampMessageWithActivePresence({ app, runtime, chat, message, overwriteExisting: false });
  }
}

async function stampMessageWithActivePresence({ app, runtime, chat, message, overwriteExisting }) {
  if (!message?.id) return;
  const extra = normalizeObject(message.extra);
  if (!overwriteExisting && Array.isArray(extra.hiddenFromAICharacterIds)) return;
  const rosterIds = uniqueStrings(chat.characterIds);
  const activeIds = resolveActiveRosterIds(chat);
  const patch = buildPresenceExtraPatch({
    extra,
    rosterIds,
    presentCharacterIds: activeIds,
  });
  await patchMessageExtra(app, chat.id, message.id, patch);
}

async function ensureAfterChatSettingsChange({ app, runtime, request, reply }) {
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;
  if (isPresenceInternalRequest(request)) return;
  const method = String(request.method || "").toUpperCase();
  if (method !== "PATCH" && method !== "PUT") return;
  const url = String(request.url || "");
  if (!/^\/api\/chats\/[^/?#]+(?:\/metadata)?(?:[?#].*)?$/u.test(url)) return;
  const body = normalizeObject(request.body);
  const touchesPresenceSettings =
    Array.isArray(body.characterIds) ||
    Object.prototype.hasOwnProperty.call(body, "activeAgentIds") ||
    Object.prototype.hasOwnProperty.call(body, "enableAgents");
  if (!touchesPresenceSettings) return;
  const chatId = extractChatRootId(url) || extractChatMetadataRouteId(url);
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat) return;
  if (isPresenceTrackerEnabled(chat)) {
    await ensurePresenceChatLifecycle({ app, runtime, chat });
  } else {
    await suspendPresenceChatLifecycle({ app, runtime, chat });
  }
}

async function reconcileSummariesAfterHostChange({ app, runtime, request, reply }) {
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;
  if (isPresenceInternalRequest(request)) return;
  const state = SUMMARY_REQUEST_STATE.get(request);
  if (!state) return;
  SUMMARY_REQUEST_STATE.delete(request);
  const chat = await runtime.persistence.getChat(state.chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  const summaryEvents = diffSummaryEntries(state.summaryEntriesBefore, readSummaryEntries(chat), state.hint);
  if (summaryEvents.length > 0) {
    await reconcileSummaryLorebook({ app, runtime, chat });
  }
}

async function runPresenceCommand({ tokens, app, runtime, chat }) {
  const [rawAction, characterName, ...rangeTokens] = tokens;
  const action = String(rawAction || "").toLowerCase();
  if (action !== "set" && action !== "unset") {
    return {
      ok: false,
      feedback: "Usage: /presence <set|unset> <character> <range>",
    };
  }
  return setPresenceForRange({
    app,
    runtime,
    chat,
    hidden: action === "unset",
    characterName,
    rangeTokens,
  });
}

async function ensurePresenceChatLifecycle({ app, runtime, chat }) {
  if (!isPresenceTrackerEnabled(chat)) {
    await suspendPresenceChatLifecycle({ app, runtime, chat });
    return { skipped: true, enabled: false };
  }
  const roster = await reconcileRoster({ app, runtime, chat });
  const afterRoster = (await runtime.persistence.getChat(chat.id)) || chat;
  const summaries = await reconcileSummaryLorebook({ app, runtime, chat: afterRoster });
  return { enabled: true, roster, summaries };
}

async function suspendPresenceChatLifecycle({ app, runtime, chat }) {
  const state = readPresenceChatState(chat);
  if (!state.summaryLorebookId) return { disabledLorebook: false };
  try {
    const lorebook = await injectJson(app, "GET", `/api/lorebooks/${encodeURIComponent(state.summaryLorebookId)}`);
    if (!lorebook?.id || lorebook.enabled === false) return { disabledLorebook: false };
    await injectJson(app, "PATCH", `/api/lorebooks/${encodeURIComponent(lorebook.id)}`, { enabled: false });
    return { disabledLorebook: true };
  } catch (error) {
    runtime.logger.warn(error, "[Presence] Could not disable summary lorebook for inactive tracker");
    return { disabledLorebook: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function reconcileRoster({ app, runtime, chat }) {
  const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
  const state = readPresenceChatState(chat);
  const messages = await runtime.persistence.listMessages(chat.id);
  const backfill = planRosterBackfill({
    previousRosterIds: state.rosterCharacterIds,
    currentRosterIds: rosterIds,
    messages,
  });
  for (const patch of backfill.messagePatches) {
    await patchMessageExtra(app, chat.id, patch.messageId, patch.patch);
  }
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  await patchChatState(runtime.persistence, freshChat, { rosterCharacterIds: rosterIds });
  return { addedCharacterIds: backfill.addedCharacterIds, patchedMessages: backfill.messagePatches.length };
}

async function runScopedHideCommand({ hidden, tokens, app, runtime, chat }) {
  const [characterName, ...rangeTokens] = tokens;
  return setPresenceForRange({ app, runtime, chat, hidden, characterName, rangeTokens });
}

async function setPresenceForRange({ app, runtime, chat, hidden, characterName, rangeTokens }) {
  const roster = await resolveRoster(runtime, chat);
  const target = resolveCharacterByName(roster, characterName);
  if (!target) throw new Error(`Character not found: ${characterName || "(missing)"}`);
  const messages = await runtime.persistence.listMessages(chat.id);
  const selected = parseMessageRange(rangeTokens, messages);
  const rosterIds = roster.map((character) => character.id);
  for (const message of selected) {
    const present = readPresenceState(message, rosterIds);
    if (hidden) present.delete(target.id);
    else present.add(target.id);
    const patch = buildPresenceExtraPatch({
      extra: message.extra,
      rosterIds,
      presentCharacterIds: [...present],
    });
    await patchMessageExtra(app, chat.id, message.id, patch);
  }
  return {
    ok: true,
    feedback: `${hidden ? "Unset" : "Set"} ${target.name} presence on ${selected.length} message${selected.length === 1 ? "" : "s"}.`,
    updated: selected.length,
  };
}

async function reconcileSummaryLorebook({ app, runtime, chat }) {
  const messages = await runtime.persistence.listMessages(chat.id);
  const roster = await resolveRoster(runtime, chat);
  const rosterIds = roster.map((character) => character.id);
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const state = readPresenceChatState(chat);
  const summaries = readSummaryEntries(chat);
  const lorebook = await ensureSummaryLorebook({ app, runtime, chat, state });
  const currentMirrorEntries = await injectJson(app, "GET", `/api/lorebooks/${encodeURIComponent(lorebook.id)}/entries`);
  const mirrorEnabledBySummaryId = new Map(
    (Array.isArray(currentMirrorEntries) ? currentMirrorEntries : [])
      .filter((entry) => normalizeObject(entry.dynamicState).owner === "presence")
      .flatMap((entry) => {
        const summaryId = normalizeObject(entry.dynamicState).summaryId;
        return typeof summaryId === "string" ? [[summaryId, entry.enabled !== false]] : [];
      }),
  );
  const summaryEntryEnabledById = {
    ...state.summaryEntryEnabledById,
  };
  for (const summary of summaries) {
    if (!summary?.id) continue;
    if (mirrorEnabledBySummaryId.has(summary.id)) {
      summaryEntryEnabledById[summary.id] = mirrorEnabledBySummaryId.get(summary.id) !== false;
    } else if (!Object.prototype.hasOwnProperty.call(summaryEntryEnabledById, summary.id)) {
      summaryEntryEnabledById[summary.id] = summary.enabled !== false;
    }
  }
  const audienceBySummaryId = new Map(
    summaries.map((summary) => [summary.id, buildSummaryAudience({ summary, messagesById, rosterIds })]),
  );
  const enabledBySummaryId = new Map(Object.entries(summaryEntryEnabledById));
  const entries = buildSummaryLorebookEntries({
    chatId: chat.id,
    summaries,
    audienceBySummaryId,
    enabledBySummaryId,
  });
  await replaceOwnedLorebookEntries(app, lorebook.id, entries);
  const disabledNativeSummaries = await disableNativeSummaryEntries(app, chat.id, summaries);
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  await patchChatState(runtime.persistence, freshChat, {
    summaryLorebookId: lorebook.id,
    summaryEntryEnabledById,
  });
  return { lorebookId: lorebook.id, entries: entries.length, disabledNativeSummaries };
}

async function ensureSummaryLorebook({ app, runtime, chat, state }) {
  if (state.summaryLorebookId) {
    try {
      const existing = await injectJson(app, "GET", `/api/lorebooks/${encodeURIComponent(state.summaryLorebookId)}`);
      if (existing?.id) return ensureLorebookEnabled(app, existing);
    } catch {
      runtime.logger.warn("[Presence] Stored summary lorebook is missing; recreating");
    }
  }
  const listed = await injectJson(app, "GET", `/api/lorebooks?chatId=${encodeURIComponent(chat.id)}`);
  const found = (Array.isArray(listed) ? listed : []).find((book) => book?.sourceAgentId === PRESENCE_PACKAGE_ID);
  if (found?.id) return ensureLorebookEnabled(app, found);
  return injectJson(app, "POST", "/api/lorebooks", {
    name: buildPresenceLorebookName(chat.id),
    description: "Character-scoped mirror of this chat's summaries for Presence.",
    chatId: chat.id,
    enabled: true,
    sourceAgentId: PRESENCE_PACKAGE_ID,
    category: "uncategorized",
    tags: ["presence", "chat-summaries"],
  });
}

async function ensureLorebookEnabled(app, lorebook) {
  if (lorebook.enabled !== false) return lorebook;
  return injectJson(app, "PATCH", `/api/lorebooks/${encodeURIComponent(lorebook.id)}`, { enabled: true });
}

async function replaceOwnedLorebookEntries(app, lorebookId, entries) {
  const current = await injectJson(app, "GET", `/api/lorebooks/${encodeURIComponent(lorebookId)}/entries`);
  for (const entry of Array.isArray(current) ? current : []) {
    if (normalizeObject(entry.dynamicState).owner === "presence" || entry.tag === "presence") {
      await injectJson(app, "DELETE", `/api/lorebooks/${encodeURIComponent(lorebookId)}/entries/${encodeURIComponent(entry.id)}`);
    }
  }
  for (const entry of entries) {
    await injectJson(app, "POST", `/api/lorebooks/${encodeURIComponent(lorebookId)}/entries`, entry);
  }
}

async function disableNativeSummaryEntries(app, chatId, summaries) {
  let disabled = 0;
  for (const summary of Array.isArray(summaries) ? summaries : []) {
    if (!summary?.id || summary.enabled === false) continue;
    await injectJson(app, "PATCH", `/api/chats/${encodeURIComponent(chatId)}/summary-entries`, {
      operation: "toggle",
      entryId: summary.id,
      enabled: false,
    });
    disabled += 1;
  }
  return disabled;
}

async function resolveRoster(runtime, chat) {
  const ids = uniqueStrings(chat?.characterIds);
  const records = await runtime.resources.listCharacters(ids);
  const nameById = new Map(records.map((record) => [record.id, readCharacterName(record.data)]));
  return ids.map((id) => ({ id, name: nameById.get(id) || id }));
}

function resolveActiveRosterIds(chat) {
  const rosterIds = uniqueStrings(chat?.characterIds);
  const metadata = normalizeObject(chat?.metadata);
  const inactive = new Set(uniqueStrings(metadata.inactiveCharacterIds));
  return rosterIds.filter((id) => !inactive.has(id));
}

function resolveCharacterByName(roster, name) {
  const normalized = normalizeLookup(name);
  if (!normalized) return null;
  return (
    roster.find((character) => normalizeLookup(character.name) === normalized || character.id === name) ??
    roster.find((character) => normalizeLookup(character.name).includes(normalized)) ??
    null
  );
}

function readCharacterName(data) {
  const parsed = normalizeObject(data);
  return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null;
}

async function patchMessageExtra(app, chatId, messageId, patch) {
  return injectJson(
    app,
    "PATCH",
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`,
    patch,
  );
}

async function patchChatState(persistence, chat, statePatch) {
  const metadata = writePresenceChatState(chat.metadata, statePatch);
  await persistence.updateChatMetadata({
    chatId: chat.id,
    metadata,
    updatedAt: new Date().toISOString(),
  });
}

async function injectJson(app, method, url, payload) {
  return injectHostJson(app, method, url, payload, { internalHeader: "x-presence-internal" });
}

function normalizeLookup(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parsePayloadObject(payload) {
  if (!payload) return null;
  if (typeof payload === "string") return normalizeObject(payload);
  if (Buffer.isBuffer(payload)) return normalizeObject(payload.toString("utf8"));
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return null;
}

function extractMessageCreateChatId(url) {
  const match = String(url || "").match(/^\/api\/chats\/([^/?#]+)\/messages(?:[?#].*)?$/u);
  return match ? decodeURIComponent(match[1]) : "";
}

function isPresenceTrackerEnabled(chat) {
  const metadata = normalizeObject(chat?.metadata);
  const activeAgentIds = uniqueStrings(metadata.activeAgentIds);
  if (!activeAgentIds.includes(PRESENCE_PACKAGE_ID)) return false;
  return metadata.enableAgents !== false;
}

function isStampableMessageRole(role) {
  return role === "user" || role === "assistant" || role === "narrator";
}

function extractChatRouteId(url) {
  const match = String(url || "").match(/^\/api\/chats\/([^/?#]+)\//u);
  return match ? decodeURIComponent(match[1]) : "";
}

function extractChatRootId(url) {
  const match = String(url || "").match(/^\/api\/chats\/([^/?#]+)(?:[?#].*)?$/u);
  return match ? decodeURIComponent(match[1]) : "";
}

function extractChatMetadataRouteId(url) {
  const match = String(url || "").match(/^\/api\/chats\/([^/?#]+)\/metadata(?:[?#].*)?$/u);
  return match ? decodeURIComponent(match[1]) : "";
}

function isNormalGenerateUrl(url) {
  return /^\/api\/generate(?:[?#].*)?$/u.test(String(url || ""));
}

function isPresenceInternalRequest(request) {
  const value = request.headers?.["x-presence-internal"];
  return value === "1" || value === "true" || (Array.isArray(value) && value.includes("1"));
}
