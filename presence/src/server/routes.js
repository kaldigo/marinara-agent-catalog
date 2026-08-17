import { readPresenceChatState, writePresenceChatState } from "../shared/chat-state.js";
import { PRESENCE_PACKAGE_ID } from "../shared/constants.js";
import { buildPresenceExtraPatch, normalizeObject, readPresenceState, uniqueStrings } from "../shared/presence-state.js";
import { planRosterBackfill } from "../shared/roster.js";
import { injectHostJson } from "../../../_mari-bridge/src/host-routes.js";
import { parseMessageRange } from "../../../_mari-bridge/src/ranges.js";
import { createPresenceCommandRouter } from "./command-router.js";

const MESSAGE_CREATE_HOOK_KEY = Symbol.for("marinara.presence.messageCreateHook");
const GENERATE_REQUEST_STATE = new WeakMap();
const EARLY_USER_STAMP_TIMEOUT_MS = 5_000;
const EARLY_USER_STAMP_INTERVAL_MS = 50;

export function registerPresenceMessageCreateHook({ app, runtime }) {
  if (app[MESSAGE_CREATE_HOOK_KEY]) return;
  app[MESSAGE_CREATE_HOOK_KEY] = true;
  app.addHook("preHandler", async (request) => {
    await captureGenerationRequestState({ app, runtime, request });
  });
  app.addHook("onSend", async (request, reply, payload) => {
    try {
      await stampCreatedMessage({ app, runtime, request, reply, payload });
      await ensureAfterChatSettingsChange({ app, runtime, request, reply });
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

export function createPresenceRoutes({ app, hostApp = app, runtime }) {
  const persistence = runtime.persistence;
  const logger = runtime.logger;

  app.get("/chat/:chatId/state", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const messages = await persistence.listMessages(req.params.chatId);
    const roster = await resolveRoster(runtime, chat, hostApp);
    return {
      chatId: chat.id,
      enabled: isPresenceTrackerEnabled(chat),
      roster,
      state: readPresenceChatState(chat),
      messages: messages.map((message, index) => ({
        id: message.id,
        index: index + 1,
        role: message.role,
        characterId: message.characterId,
        presence: [...readPresenceState(message, roster.map((character) => character.id))],
      })),
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
      alwaysPresentCharacterIds: resolveAlwaysPresentRosterIds(chat),
    });
    await patchMessageExtra(hostApp, req.params.chatId, req.params.messageId, patch);
    return { ok: true, patch };
  });

  app.patch("/chat/:chatId/settings", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (!isPresenceTrackerEnabled(chat)) {
      return reply.status(409).send({ error: "Presence tracker is not enabled for this chat." });
    }
    const body = normalizeObject(req.body);
    const result = await updatePresenceChatSettings({
      app: hostApp,
      runtime,
      chat,
      alwaysPresentCharacterIds: uniqueStrings(body.alwaysPresentCharacterIds),
    });
    const freshChat = (await persistence.getChat(req.params.chatId)) || chat;
    return { ok: true, state: readPresenceChatState(freshChat), ...result };
  });

  app.post("/chat/:chatId/command", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (!isPresenceTrackerEnabled(chat)) {
      return reply.status(409).send({ error: "Presence tracker is not enabled for this chat." });
    }
    const raw = String(normalizeObject(req.body).text || "");
    const router = createPresenceCommandRouter({
      runPresenceCommand: (args) => runPresenceCommand({ ...args, app: hostApp, runtime, chat }),
      runScopedHideCommand: (args) => runScopedHideCommand({ ...args, app: hostApp, runtime, chat }),
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
    const result = await ensurePresenceChatLifecycle({ app: hostApp, runtime, chat });
    return { ok: true, ...result };
  });
}

async function captureGenerationRequestState({ app, runtime, request }) {
  if (isPresenceInternalRequest(request)) return;
  if (String(request.method || "").toUpperCase() !== "POST" || !isNormalGenerateUrl(request.url)) return;
  const body = normalizeObject(request.body);
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  const messages = await runtime.persistence.listMessages(chatId);
  const beforeMessageIds = new Set(messages.map((message) => message.id).filter(Boolean));
  const state = {
    chatId,
    beforeMessageIds,
    regenerateMessageId: typeof body.regenerateMessageId === "string" ? body.regenerateMessageId : "",
    continueMessageId: typeof body.continueMessageId === "string" ? body.continueMessageId : "",
    earlyUserStampPromise: null,
  };
  if (shouldWatchGeneratedUserMessage(body)) {
    state.earlyUserStampPromise = stampGeneratedUserMessageSoon({
      app,
      runtime,
      chatId,
      beforeMessageIds,
      submissionId: typeof body.submissionId === "string" ? body.submissionId : "",
    }).catch((error) => {
      runtime.logger.warn(error, "[Presence] Could not early-stamp generated user message");
      return { stamped: false };
    });
  }
  GENERATE_REQUEST_STATE.set(request, state);
}

async function stampCreatedMessage({ app, runtime, request, reply, payload }) {
  if (request.method !== "POST" || reply.statusCode < 200 || reply.statusCode >= 300) return;
  const url = String(request.url || "");
  if (!/^\/api\/chats\/[^/]+\/messages(?:[?#].*)?$/u.test(url)) return;
  const created = parsePayloadObject(payload);
  if (!created?.id || !isStampableMessageRole(created.role)) return;
  const chatId = typeof created.chatId === "string" && created.chatId ? created.chatId : extractMessageCreateChatId(url);
  if (!chatId) return;
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  await stampMessageWithActivePresence({ app, chat, message: created, overwriteExisting: true });
}

async function finishGenerationLifecycle({ app, runtime, request, reply }) {
  const state = GENERATE_REQUEST_STATE.get(request);
  if (!state) return;
  GENERATE_REQUEST_STATE.delete(request);
  if (reply.statusCode < 200 || reply.statusCode >= 300) return;
  const chat = await runtime.persistence.getChat(state.chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  await stampGeneratedMessages({ app, runtime, chat, state });
}

async function stampGeneratedMessages({ app, runtime, chat, state }) {
  const messages = await runtime.persistence.listMessages(state.chatId);
  const createdMessages = messages.filter((message) => !state.beforeMessageIds.has(message.id));
  const createdMessageIds = new Set(createdMessages.map((message) => message.id).filter(Boolean));
  const targetIds = new Set([
    ...createdMessages.filter((message) => isStampableMessageRole(message.role)).map((message) => message.id),
    state.regenerateMessageId,
    state.continueMessageId,
  ].filter(Boolean));
  for (const message of messages) {
    if (!targetIds.has(message.id)) continue;
    await stampMessageWithActivePresence({
      app,
      chat,
      message,
      overwriteExisting: createdMessageIds.has(message.id),
    });
  }
  return [...targetIds];
}

async function stampGeneratedUserMessageSoon({ app, runtime, chatId, beforeMessageIds, submissionId }) {
  const deadline = Date.now() + EARLY_USER_STAMP_TIMEOUT_MS;
  do {
    const messages = await runtime.persistence.listMessages(chatId);
    const message = findGeneratedUserMessage(messages, beforeMessageIds, submissionId);
    if (message) {
      const chat = await runtime.persistence.getChat(chatId);
      if (!chat || !isPresenceTrackerEnabled(chat)) return { stamped: false };
      await stampMessageWithActivePresence({ app, chat, message, overwriteExisting: true });
      return { stamped: true, messageId: message.id };
    }
    await delay(EARLY_USER_STAMP_INTERVAL_MS);
  } while (Date.now() < deadline);
  return { stamped: false };
}

function findGeneratedUserMessage(messages, beforeMessageIds, submissionId) {
  const createdUsers = (Array.isArray(messages) ? messages : []).filter(
    (message) => message?.id && message.role === "user" && !beforeMessageIds.has(message.id),
  );
  if (!createdUsers.length) return null;
  if (submissionId) {
    return createdUsers.find((message) => normalizeObject(message.extra).submissionId === submissionId) || null;
  }
  return createdUsers[createdUsers.length - 1];
}

async function stampMessageWithActivePresence({ app, chat, message, overwriteExisting }) {
  if (!message?.id) return;
  const extra = normalizeObject(message.extra);
  if (!overwriteExisting && hasPositivePresence(message)) return;
  const rosterIds = uniqueStrings(chat.characterIds);
  const presentCharacterIds = !overwriteExisting && Array.isArray(extra.hiddenFromAICharacterIds)
    ? [...readPresenceState(message, rosterIds)]
    : resolveActiveRosterIds(chat);
  const patch = buildPresenceExtraPatch({
    extra,
    rosterIds,
    presentCharacterIds,
    alwaysPresentCharacterIds: resolveAlwaysPresentRosterIds(chat),
  });
  await patchMessageExtra(app, chat.id, message.id, patch);
}

async function ensureAfterChatSettingsChange({ app, runtime, request, reply }) {
  if (reply.statusCode < 200 || reply.statusCode >= 300 || isPresenceInternalRequest(request)) return;
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
  if (chat && isPresenceTrackerEnabled(chat)) await ensurePresenceChatLifecycle({ app, runtime, chat });
}

async function runPresenceCommand({ tokens, app, runtime, chat }) {
  const action = String(tokens[0] || "").toLowerCase();
  if (action === "resync") return resyncPresenceChat({ app, runtime, chat });
  const [, characterName, ...rangeTokens] = tokens;
  if (action !== "set" && action !== "unset") {
    return { ok: false, feedback: "Usage: /presence <set|unset> <character> <range> or /presence resync" };
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
  if (!isPresenceTrackerEnabled(chat)) return { skipped: true, enabled: false };
  const roster = await reconcileRoster({ app, runtime, chat });
  return { enabled: true, roster };
}

async function reconcileRoster({ app, runtime, chat }) {
  const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
  const state = readPresenceChatState(chat);
  const alwaysPresentCharacterIds = state.alwaysPresentCharacterIds.filter((id) => rosterIds.includes(id));
  const messages = await runtime.persistence.listMessages(chat.id);
  if (state.rosterCharacterIds.length === 0) {
    let patchedMessages = 0;
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!message?.id || normalizeObject(message.extra).hiddenFromAI === true) continue;
      await patchMessageExtra(app, chat.id, message.id, buildPresenceExtraPatch({
        extra: message.extra,
        rosterIds,
        presentCharacterIds: [...readPresenceState(message, rosterIds)],
        alwaysPresentCharacterIds,
      }));
      patchedMessages += 1;
    }
    const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
    await patchChatState(runtime.persistence, freshChat, { rosterCharacterIds: rosterIds, alwaysPresentCharacterIds });
    return { addedCharacterIds: [], patchedMessages, initialized: true };
  }
  const backfill = planRosterBackfill({
    previousRosterIds: state.rosterCharacterIds,
    currentRosterIds: rosterIds,
    messages,
    alwaysPresentCharacterIds,
  });
  let initializedMessages = 0;
  if (backfill.addedCharacterIds.length === 0) {
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!message?.id || hasPositivePresence(message) || normalizeObject(message.extra).hiddenFromAI === true) continue;
      await patchMessageExtra(app, chat.id, message.id, buildPresenceExtraPatch({
        extra: message.extra,
        rosterIds,
        presentCharacterIds: [...readPresenceState(message, state.rosterCharacterIds)],
        alwaysPresentCharacterIds,
      }));
      initializedMessages += 1;
    }
  }
  for (const patch of backfill.messagePatches) {
    await patchMessageExtra(app, chat.id, patch.messageId, patch.patch);
  }
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  await patchChatState(runtime.persistence, freshChat, { rosterCharacterIds: rosterIds, alwaysPresentCharacterIds });
  return {
    addedCharacterIds: backfill.addedCharacterIds,
    patchedMessages: backfill.messagePatches.length + initializedMessages,
    initializedMessages,
  };
}

async function updatePresenceChatSettings({ app, runtime, chat, alwaysPresentCharacterIds }) {
  const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
  const normalizedAlwaysPresent = uniqueStrings(alwaysPresentCharacterIds).filter((id) => rosterIds.includes(id));
  await patchChatState(runtime.persistence, chat, { alwaysPresentCharacterIds: normalizedAlwaysPresent });
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  const patchedMessages = await enforceAlwaysPresentOnMessages({
    app,
    runtime,
    chat: freshChat,
    rosterIds,
    alwaysPresentCharacterIds: normalizedAlwaysPresent,
  });
  return { alwaysPresentCharacterIds: normalizedAlwaysPresent, patchedMessages };
}

async function enforceAlwaysPresentOnMessages({ app, runtime, chat, rosterIds, alwaysPresentCharacterIds }) {
  const forced = new Set(uniqueStrings(alwaysPresentCharacterIds).filter((id) => rosterIds.includes(id)));
  if (!forced.size) return 0;
  let patched = 0;
  const messages = await runtime.persistence.listMessages(chat.id);
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id || normalizeObject(message.extra).hiddenFromAI === true) continue;
    const present = readPresenceState(message, rosterIds);
    const beforeSize = present.size;
    for (const characterId of forced) present.add(characterId);
    if (present.size === beforeSize && hasPositivePresence(message)) continue;
    await patchMessageExtra(app, chat.id, message.id, buildPresenceExtraPatch({
      extra: message.extra,
      rosterIds,
      presentCharacterIds: [...present],
      alwaysPresentCharacterIds,
    }));
    patched += 1;
  }
  return patched;
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
  const alwaysPresentCharacterIds = resolveAlwaysPresentRosterIds(chat);
  const targetIsAlwaysPresent = alwaysPresentCharacterIds.includes(target.id);
  for (const message of selected) {
    const present = readPresenceState(message, rosterIds);
    if (hidden && !targetIsAlwaysPresent) present.delete(target.id);
    else present.add(target.id);
    await patchMessageExtra(app, chat.id, message.id, buildPresenceExtraPatch({
      extra: message.extra,
      rosterIds,
      presentCharacterIds: [...present],
      alwaysPresentCharacterIds,
    }));
  }
  return {
    ok: true,
    feedback: `${hidden ? "Unset" : "Set"} ${target.name} presence on ${selected.length} message${selected.length === 1 ? "" : "s"}.${hidden && targetIsAlwaysPresent ? " Always-present kept them visible." : ""}`,
    updated: selected.length,
  };
}

async function resyncPresenceChat({ app, runtime, chat }) {
  const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
  const alwaysPresentCharacterIds = resolveAlwaysPresentRosterIds(chat);
  const messages = await runtime.persistence.listMessages(chat.id);
  let updated = 0;
  let skippedGlobal = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id) continue;
    if (normalizeObject(message.extra).hiddenFromAI === true) {
      skippedGlobal += 1;
      continue;
    }
    const present = readPresenceState(message, rosterIds);
    await patchMessageExtra(app, chat.id, message.id, buildPresenceExtraPatch({
      extra: message.extra,
      rosterIds,
      presentCharacterIds: [...present],
      alwaysPresentCharacterIds,
    }));
    updated += 1;
  }
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  await patchChatState(runtime.persistence, freshChat, {
    rosterCharacterIds: rosterIds,
    alwaysPresentCharacterIds,
  });
  return {
    ok: true,
    feedback: `Resynced Presence on ${updated} message${updated === 1 ? "" : "s"}.${skippedGlobal ? ` Left ${skippedGlobal} globally hidden message${skippedGlobal === 1 ? "" : "s"} unchanged.` : ""}`,
    updated,
    skippedGlobal,
  };
}

function hasPositivePresence(message) {
  return Array.isArray(normalizeObject(normalizeObject(message?.extra).marinaraPresence).presentCharacterIds);
}

async function resolveRoster(runtime, chat, app = null) {
  const ids = uniqueStrings(chat?.characterIds);
  const records = await runtime.resources.listCharacters(ids);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return Promise.all(ids.map(async (id) => {
    const record = recordsById.get(id);
    const display = readCharacterDisplay(record?.data);
    let avatarUrl = display.avatarUrl;
    if (app) {
      try {
        const hostCharacter = await injectJson(app, "GET", `/api/characters/${encodeURIComponent(id)}`);
        if (typeof hostCharacter?.avatarPath === "string" && hostCharacter.avatarPath.trim()) {
          avatarUrl = hostCharacter.avatarPath.trim();
        }
      } catch {
        // Initials remain usable if this host does not expose character avatars.
      }
    }
    return { id, name: display.name || id, avatarUrl };
  }));
}

function resolveActiveRosterIds(chat) {
  const rosterIds = uniqueStrings(chat?.characterIds);
  const inactive = new Set(uniqueStrings(normalizeObject(chat?.metadata).inactiveCharacterIds));
  return rosterIds.filter((id) => !inactive.has(id));
}

function resolveAlwaysPresentRosterIds(chat) {
  const rosterIds = new Set(uniqueStrings(chat?.characterIds));
  return readPresenceChatState(chat).alwaysPresentCharacterIds.filter((id) => rosterIds.has(id));
}

function resolveCharacterByName(roster, name) {
  const normalized = normalizeLookup(name);
  if (!normalized) return null;
  return roster.find((character) => normalizeLookup(character.name) === normalized || character.id === name)
    ?? roster.find((character) => normalizeLookup(character.name).includes(normalized))
    ?? null;
}

function readCharacterDisplay(data) {
  const parsed = normalizeObject(data);
  return {
    name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : null,
    avatarUrl: typeof parsed.avatarPath === "string" && parsed.avatarPath.trim() ? parsed.avatarPath.trim() : null,
  };
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
  await persistence.updateChatMetadata({ chatId: chat.id, metadata, updatedAt: new Date().toISOString() });
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
  if (!uniqueStrings(metadata.activeAgentIds).includes(PRESENCE_PACKAGE_ID)) return false;
  return metadata.enableAgents !== false;
}

function isStampableMessageRole(role) {
  return role === "user" || role === "assistant" || role === "narrator";
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

function shouldWatchGeneratedUserMessage(body) {
  if (normalizeObject(body).impersonate === true) return false;
  if (typeof body.userMessage === "string" && body.userMessage.length > 0) return true;
  if (Array.isArray(body.attachments) && body.attachments.length > 0) return true;
  const pendingSpatialTransition = body.pendingSpatialTransition;
  return !!pendingSpatialTransition && typeof pendingSpatialTransition === "object" && !Array.isArray(pendingSpatialTransition);
}

function isPresenceInternalRequest(request) {
  const value = request.headers?.["x-presence-internal"];
  return value === "1" || value === "true" || (Array.isArray(value) && value.includes("1"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
