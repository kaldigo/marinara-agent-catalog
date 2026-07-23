import { createPresenceCommandRouter } from "../client/command-handler.js";
import { buildPresenceLorebookName, readPresenceChatState, writePresenceChatState } from "../shared/chat-state.js";
import { PRESENCE_PACKAGE_ID } from "../shared/constants.js";
import { buildPresenceExtraPatch, normalizeObject, readPresenceState, uniqueStrings } from "../shared/presence-state.js";
import { planRosterBackfill } from "../shared/roster.js";
import { parseMessageRange } from "../../../_mari-bridge/src/ranges.js";
import { readSummaryEntries } from "../../../_mari-bridge/src/summary-tracking.js";
import { buildSummaryAudience, buildSummaryLorebookEntries } from "./summary-mirror.js";

const MESSAGE_CREATE_HOOK_KEY = Symbol.for("marinara.presence.messageCreateHook");

export function registerPresenceMessageCreateHook({ app, runtime }) {
  if (app[MESSAGE_CREATE_HOOK_KEY]) return;
  app[MESSAGE_CREATE_HOOK_KEY] = true;
  app.addHook("onSend", async (request, reply, payload) => {
    try {
      await stampCreatedUserMessage({ app, runtime, request, reply, payload });
    } catch (error) {
      runtime.logger.warn(error, "[Presence] Could not stamp created message");
    }
    return payload;
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

  app.post("/chat/:chatId/reconcile", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
    const state = readPresenceChatState(chat);
    const messages = await persistence.listMessages(req.params.chatId);
    const backfill = planRosterBackfill({
      previousRosterIds: state.rosterCharacterIds,
      currentRosterIds: rosterIds,
      messages,
    });
    for (const patch of backfill.messagePatches) {
      await patchMessageExtra(app, req.params.chatId, patch.messageId, patch.patch);
    }
    await patchChatState(persistence, chat, { rosterCharacterIds: rosterIds });
    return { ok: true, addedCharacterIds: backfill.addedCharacterIds, patchedMessages: backfill.messagePatches.length };
  });

  app.post("/chat/:chatId/summaries/reconcile", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const result = await reconcileSummaryLorebook({ app, runtime, chat });
    return { ok: true, ...result };
  });
}

async function stampCreatedUserMessage({ app, runtime, request, reply, payload }) {
  if (request.method !== "POST") return;
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;
  const url = String(request.url || "");
  if (!/^\/api\/chats\/[^/]+\/messages(?:[?#].*)?$/u.test(url)) return;
  const created = parsePayloadObject(payload);
  if (!created?.id || created.role !== "user") return;
  const chatId = typeof created.chatId === "string" && created.chatId ? created.chatId : extractMessageCreateChatId(url);
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat) return;
  const rosterIds = uniqueStrings(chat.characterIds);
  const activeIds = resolveActiveRosterIds(chat);
  const patch = buildPresenceExtraPatch({
    extra: created.extra,
    rosterIds,
    presentCharacterIds: activeIds,
  });
  await patchMessageExtra(app, chatId, created.id, patch);
}

async function runPresenceCommand({ tokens, app, runtime, chat }) {
  const [action, characterName, ...rangeTokens] = tokens;
  if (action !== "set" && action !== "unset") {
    return { ok: false, feedback: "Usage: /presence <set|unset> <character> <range>" };
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
      if (existing?.id) return existing;
    } catch {
      runtime.logger.warn("[Presence] Stored summary lorebook is missing; recreating");
    }
  }
  const listed = await injectJson(app, "GET", `/api/lorebooks?chatId=${encodeURIComponent(chat.id)}`);
  const found = (Array.isArray(listed) ? listed : []).find((book) => book?.sourceAgentId === PRESENCE_PACKAGE_ID);
  if (found?.id) return found;
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
  if (typeof app.inject !== "function") throw new Error("Presence requires Fastify app.inject for host mutations.");
  const response = await app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload }),
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    let error = `${response.statusCode} ${response.statusMessage}`;
    try {
      error = JSON.parse(response.payload).error || error;
    } catch {
      if (response.payload) error = response.payload;
    }
    throw new Error(error);
  }
  if (response.statusCode === 204 || !response.payload) return {};
  return JSON.parse(response.payload);
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
