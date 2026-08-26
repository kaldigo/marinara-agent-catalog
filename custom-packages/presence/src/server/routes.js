import { readPresenceChatState, writePresenceChatState } from "../shared/chat-state.js";
import { PRESENCE_PACKAGE_ID } from "../shared/constants.js";
import { buildPresenceExtraPatch, normalizeObject, readPresenceState, uniqueStrings } from "../shared/presence-state.js";
import { planRosterBackfill } from "../shared/roster.js";
import { parseMessageRange } from "../shared/message-range.js";
import { createPresenceCommandRouter } from "./command-router.js";

const PRESENCE_CHAT_KEYS = new Set(["characterIds", "inactiveCharacterIds", "activeAgentIds", "enableAgents"]);

export function registerPresenceHooks({ runtime, bridgeSession }) {
  bridgeSession.messages.register({
    id: "active-presence",
    prepare: ({ input }) => prepareCreatedMessage({ runtime, input }),
    afterPersist: (event) => applyPersistedMessagePresence({ runtime, bridgeSession, event }),
  });
  return bridgeSession.chats.register({
    id: "presence-roster",
    onChanged: (event) => applyChangedChatPresence({ runtime, bridgeSession, event }),
  });
}

export function createPresenceRoutes({ app, runtime, bridgeSession }) {
  const persistence = runtime.persistence;
  const logger = runtime.logger;

  app.get("/chat/:chatId/state", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const messages = await persistence.listMessages(req.params.chatId);
    const roster = await resolveRoster(runtime, chat, bridgeSession);
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
    await patchMessageExtra(bridgeSession, req.params.chatId, req.params.messageId, patch);
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
      bridgeSession,
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
      runPresenceCommand: (args) => runPresenceCommand({ ...args, bridgeSession, runtime, chat }),
      runScopedHideCommand: (args) => runScopedHideCommand({ ...args, bridgeSession, runtime, chat }),
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
    const result = await ensurePresenceChatLifecycle({ bridgeSession, runtime, chat });
    return { ok: true, ...result };
  });
}

async function prepareCreatedMessage({ runtime, input }) {
  if (!input?.chatId || !isStampableMessageRole(input.role)) return null;
  const chat = await runtime.persistence.getChat(input.chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return null;
  const extra = normalizeObject(input.extra);
  const patch = buildPresenceExtraPatch({
    extra,
    rosterIds: uniqueStrings(chat.characterIds),
    presentCharacterIds: resolveActiveRosterIds(chat),
    alwaysPresentCharacterIds: resolveAlwaysPresentRosterIds(chat),
  });
  return { extra: { ...extra, ...patch } };
}

async function applyPersistedMessagePresence({ bridgeSession, runtime, event }) {
  if (event.kind !== "regenerate" && event.kind !== "continue") return;
  if (!event.chatId || !event.message?.id || !isStampableMessageRole(event.message.role)) return;
  const chat = await runtime.persistence.getChat(event.chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  await stampMessageWithActivePresence({ bridgeSession, chat, message: event.message, overwriteExisting: true });
}

async function stampMessageWithActivePresence({ bridgeSession, chat, message, overwriteExisting }) {
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
  await patchMessageExtra(bridgeSession, chat.id, message.id, patch);
}

async function applyChangedChatPresence({ bridgeSession, runtime, event }) {
  if (!event.chatId || !event.changedKeys?.some((key) => PRESENCE_CHAT_KEYS.has(key))) return;
  const chat = event.chat ?? await runtime.persistence.getChat(event.chatId);
  if (chat && isPresenceTrackerEnabled(chat)) await ensurePresenceChatLifecycle({ bridgeSession, runtime, chat });
}

async function runPresenceCommand({ tokens, bridgeSession, runtime, chat }) {
  const action = String(tokens[0] || "").toLowerCase();
  if (action === "resync") return resyncPresenceChat({ bridgeSession, runtime, chat });
  const [, characterName, ...rangeTokens] = tokens;
  if (action !== "set" && action !== "unset") {
    return { ok: false, feedback: "Usage: /presence <set|unset> <character> <range> or /presence resync" };
  }
  return setPresenceForRange({
    bridgeSession,
    runtime,
    chat,
    hidden: action === "unset",
    characterName,
    rangeTokens,
  });
}

async function ensurePresenceChatLifecycle({ bridgeSession, runtime, chat }) {
  if (!isPresenceTrackerEnabled(chat)) return { skipped: true, enabled: false };
  const roster = await reconcileRoster({ bridgeSession, runtime, chat });
  return { enabled: true, roster };
}

async function reconcileRoster({ bridgeSession, runtime, chat }) {
  const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
  const state = readPresenceChatState(chat);
  const alwaysPresentCharacterIds = state.alwaysPresentCharacterIds.filter((id) => rosterIds.includes(id));
  const messages = await runtime.persistence.listMessages(chat.id);
  if (state.rosterCharacterIds.length === 0) {
    let patchedMessages = 0;
    for (const message of Array.isArray(messages) ? messages : []) {
      if (!message?.id || normalizeObject(message.extra).hiddenFromAI === true) continue;
      await patchMessageExtra(bridgeSession, chat.id, message.id, buildPresenceExtraPatch({
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
      await patchMessageExtra(bridgeSession, chat.id, message.id, buildPresenceExtraPatch({
        extra: message.extra,
        rosterIds,
        presentCharacterIds: [...readPresenceState(message, state.rosterCharacterIds)],
        alwaysPresentCharacterIds,
      }));
      initializedMessages += 1;
    }
  }
  for (const patch of backfill.messagePatches) {
    await patchMessageExtra(bridgeSession, chat.id, patch.messageId, patch.patch);
  }
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  await patchChatState(runtime.persistence, freshChat, { rosterCharacterIds: rosterIds, alwaysPresentCharacterIds });
  return {
    addedCharacterIds: backfill.addedCharacterIds,
    patchedMessages: backfill.messagePatches.length + initializedMessages,
    initializedMessages,
  };
}

async function updatePresenceChatSettings({ bridgeSession, runtime, chat, alwaysPresentCharacterIds }) {
  const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
  const normalizedAlwaysPresent = uniqueStrings(alwaysPresentCharacterIds).filter((id) => rosterIds.includes(id));
  await patchChatState(runtime.persistence, chat, { alwaysPresentCharacterIds: normalizedAlwaysPresent });
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  const patchedMessages = await enforceAlwaysPresentOnMessages({
    bridgeSession,
    runtime,
    chat: freshChat,
    rosterIds,
    alwaysPresentCharacterIds: normalizedAlwaysPresent,
  });
  return { alwaysPresentCharacterIds: normalizedAlwaysPresent, patchedMessages };
}

async function enforceAlwaysPresentOnMessages({ bridgeSession, runtime, chat, rosterIds, alwaysPresentCharacterIds }) {
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
    await patchMessageExtra(bridgeSession, chat.id, message.id, buildPresenceExtraPatch({
      extra: message.extra,
      rosterIds,
      presentCharacterIds: [...present],
      alwaysPresentCharacterIds,
    }));
    patched += 1;
  }
  return patched;
}

async function runScopedHideCommand({ hidden, tokens, bridgeSession, runtime, chat }) {
  const [characterName, ...rangeTokens] = tokens;
  return setPresenceForRange({ bridgeSession, runtime, chat, hidden, characterName, rangeTokens });
}

async function setPresenceForRange({ bridgeSession, runtime, chat, hidden, characterName, rangeTokens }) {
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
    await patchMessageExtra(bridgeSession, chat.id, message.id, buildPresenceExtraPatch({
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

async function resyncPresenceChat({ bridgeSession, runtime, chat }) {
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
    await patchMessageExtra(bridgeSession, chat.id, message.id, buildPresenceExtraPatch({
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

async function resolveRoster(runtime, chat, bridgeSession = null) {
  const ids = uniqueStrings(chat?.characterIds);
  const records = await runtime.resources.listCharacters(ids);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return Promise.all(ids.map(async (id) => {
    const record = recordsById.get(id);
    const display = readCharacterDisplay(record?.data);
    let avatarUrl = display.avatarUrl;
    if (bridgeSession) {
      try {
        const hostCharacter = await injectJson(bridgeSession, "GET", `/api/characters/${encodeURIComponent(id)}`);
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

async function patchMessageExtra(bridgeSession, chatId, messageId, patch) {
  return injectJson(
    bridgeSession,
    "PATCH",
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`,
    patch,
  );
}

async function patchChatState(persistence, chat, statePatch) {
  const metadata = writePresenceChatState(chat.metadata, statePatch);
  await persistence.updateChatMetadata({ chatId: chat.id, metadata, updatedAt: new Date().toISOString() });
}

async function injectJson(bridgeSession, method, url, payload) {
  return bridgeSession.host.request({
    method,
    path: url,
    ...(payload === undefined ? {} : { body: payload }),
    headers: { "x-presence-internal": "1" },
  });
}

function normalizeLookup(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isPresenceTrackerEnabled(chat) {
  const metadata = normalizeObject(chat?.metadata);
  if (!uniqueStrings(metadata.activeAgentIds).includes(PRESENCE_PACKAGE_ID)) return false;
  return metadata.enableAgents === true;
}

function isStampableMessageRole(role) {
  return role === "user" || role === "assistant" || role === "narrator";
}
