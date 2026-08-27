import { readPresenceChatState, writePresenceChatState } from "../shared/chat-state.js";
import { PRESENCE_PACKAGE_ID } from "../shared/constants.js";
import {
  assertVisibilityPatchScope,
  buildPresenceExtraPatch,
  buildVisibilityDeltaPatch,
  normalizeObject,
  readPresenceState,
  uniqueStrings,
  visibilityPatchChanges,
} from "../shared/presence-state.js";
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
    await patchMessageExtra(bridgeSession, req.params.chatId, req.params.messageId, patch, {
      previousExtra: message.extra,
      allowedCharacterIds: rosterIds,
      operation: "Explicit message-presence edit",
    });
    return { ok: true, patch };
  });

  app.patch("/chat/:chatId/settings", async (req, reply) => {
    const chat = await persistence.getChat(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (!isPresenceTrackerEnabled(chat)) {
      return reply.status(409).send({ error: "Presence tracker is not enabled for this chat." });
    }
    const body = normalizeObject(req.body);
    if (typeof body.characterId !== "string" || typeof body.alwaysPresent !== "boolean") {
      return reply.status(400).send({ error: "characterId and boolean alwaysPresent are required" });
    }
    const result = await updatePresenceChatSettings({
      bridgeSession,
      runtime,
      chat,
      characterId: body.characterId,
      alwaysPresent: body.alwaysPresent,
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
  assertVisibilityPatchScope({
    extra,
    patch,
    allowedCharacterIds: uniqueStrings(chat.characterIds),
    operation: "New-message presence stamp",
  });
  return { extra: { ...extra, ...patch } };
}

async function applyPersistedMessagePresence({ bridgeSession, runtime, event }) {
  if (event.kind !== "regenerate" && event.kind !== "continue") return;
  if (!event.chatId || !event.message?.id || !isStampableMessageRole(event.message.role)) return;
  const chat = await runtime.persistence.getChat(event.chatId);
  if (!chat || !isPresenceTrackerEnabled(chat)) return;
  const extra = normalizeObject(event.message.extra);
  if (extra.hiddenFromAI === true) return;
  const patch = buildVisibilityDeltaPatch({
    extra,
    visibleCharacterIds: resolveAlwaysPresentRosterIds(chat),
  });
  if (visibilityPatchChanges(extra, patch)) {
    await patchMessageExtra(bridgeSession, chat.id, event.message.id, patch, {
      previousExtra: extra,
      allowedCharacterIds: resolveAlwaysPresentRosterIds(chat),
      operation: "Regenerate/continue omnipresent repair",
    });
  }
}

async function applyChangedChatPresence({ bridgeSession, runtime, event }) {
  if (!event.chatId || !event.changedKeys?.some((key) => PRESENCE_CHAT_KEYS.has(key))) return;
  const chat = await runtime.persistence.getChat(event.chatId);
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
  const alwaysPresentCharacterIds = state.alwaysPresentCharacterIds;
  const messages = await runtime.persistence.listMessages(chat.id);
  if (state.knownCharacterIds.length === 0) {
    await patchChatState(runtime.persistence, chat.id, { knownCharacterIds: rosterIds });
    return { addedCharacterIds: [], patchedMessages: 0, initialized: true };
  }
  const backfill = planRosterBackfill({
    knownCharacterIds: state.knownCharacterIds,
    currentRosterIds: rosterIds,
    messages,
    alwaysPresentCharacterIds,
  });
  for (const patch of backfill.messagePatches) {
    await patchMessageExtra(bridgeSession, chat.id, patch.messageId, patch.patch, {
      previousExtra: patch.previousExtra,
      allowedCharacterIds: patch.allowedCharacterIds,
      operation: "New-character backfill",
    });
  }
  const knownCharacterIds = uniqueStrings([...state.knownCharacterIds, ...rosterIds]);
  if (knownCharacterIds.length !== state.knownCharacterIds.length) {
    await patchChatState(runtime.persistence, chat.id, { knownCharacterIds });
  }
  return {
    addedCharacterIds: backfill.addedCharacterIds,
    patchedMessages: backfill.messagePatches.length,
  };
}

async function updatePresenceChatSettings({
  bridgeSession,
  runtime,
  chat,
  characterId,
  alwaysPresent,
}) {
  const rosterIds = (await resolveRoster(runtime, chat)).map((character) => character.id);
  if (characterId && !rosterIds.includes(characterId)) throw new Error(`Character not found: ${characterId}`);
  let previousAlwaysPresent = [];
  let normalizedAlwaysPresent = [];
  await patchChatState(runtime.persistence, chat.id, (state) => {
    previousAlwaysPresent = state.alwaysPresentCharacterIds;
    const next = new Set(previousAlwaysPresent);
    if (characterId) {
      if (alwaysPresent) next.add(characterId);
      else next.delete(characterId);
    }
    normalizedAlwaysPresent = [...next];
    return { alwaysPresentCharacterIds: normalizedAlwaysPresent };
  });
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  const previous = new Set(previousAlwaysPresent);
  const newlyEnabled = normalizedAlwaysPresent.filter((id) => !previous.has(id));
  const patchedMessages = await enforceAlwaysPresentOnMessages({
    bridgeSession,
    runtime,
    chat: freshChat,
    characterIds: newlyEnabled,
  });
  return { alwaysPresentCharacterIds: normalizedAlwaysPresent, patchedMessages };
}

async function enforceAlwaysPresentOnMessages({ bridgeSession, runtime, chat, characterIds }) {
  const visibleCharacterIds = uniqueStrings(characterIds);
  if (!visibleCharacterIds.length) return 0;
  let patched = 0;
  const messages = await runtime.persistence.listMessages(chat.id);
  const planned = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const extra = normalizeObject(message?.extra);
    if (!message?.id || extra.hiddenFromAI === true) continue;
    const patch = buildVisibilityDeltaPatch({ extra, visibleCharacterIds });
    if (!visibilityPatchChanges(extra, patch)) continue;
    assertVisibilityPatchScope({
      extra,
      patch,
      allowedCharacterIds: visibleCharacterIds,
      operation: "Omnipresent history repair",
    });
    planned.push({ messageId: message.id, previousExtra: extra, patch });
  }
  for (const item of planned) {
    await patchMessageExtra(bridgeSession, chat.id, item.messageId, item.patch, {
      previousExtra: item.previousExtra,
      allowedCharacterIds: visibleCharacterIds,
      operation: "Omnipresent history repair",
    });
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
  const alwaysPresentCharacterIds = resolveAlwaysPresentRosterIds(chat);
  const targetIsAlwaysPresent = alwaysPresentCharacterIds.includes(target.id);
  const planned = [];
  for (const message of selected) {
    const patch = buildVisibilityDeltaPatch({
      extra: message.extra,
      hiddenCharacterIds: hidden && !targetIsAlwaysPresent ? [target.id] : [],
      visibleCharacterIds: !hidden || targetIsAlwaysPresent ? [target.id] : [],
    });
    if (visibilityPatchChanges(message.extra, patch)) {
      assertVisibilityPatchScope({
        extra: message.extra,
        patch,
        allowedCharacterIds: [target.id],
        operation: "Scoped Presence range edit",
      });
      planned.push({ messageId: message.id, previousExtra: message.extra, patch });
    }
  }
  for (const item of planned) {
    await patchMessageExtra(bridgeSession, chat.id, item.messageId, item.patch, {
      previousExtra: item.previousExtra,
      allowedCharacterIds: [target.id],
      operation: "Scoped Presence range edit",
    });
  }
  return {
    ok: true,
    feedback: `${hidden ? "Unset" : "Set"} ${target.name} presence on ${selected.length} message${selected.length === 1 ? "" : "s"}.${hidden && targetIsAlwaysPresent ? " Always-present kept them visible." : ""}`,
    updated: selected.length,
  };
}

async function resyncPresenceChat({ bridgeSession, runtime, chat }) {
  const roster = await reconcileRoster({ bridgeSession, runtime, chat });
  const freshChat = (await runtime.persistence.getChat(chat.id)) || chat;
  const updated = await enforceAlwaysPresentOnMessages({
    bridgeSession,
    runtime,
    chat: freshChat,
    characterIds: readPresenceChatState(freshChat).alwaysPresentCharacterIds,
  });
  return {
    ok: true,
    feedback: `Reconciled ${roster.addedCharacterIds.length} new character${roster.addedCharacterIds.length === 1 ? "" : "s"} and repaired omnipresent access on ${updated} message${updated === 1 ? "" : "s"}.`,
    updated,
    addedCharacterIds: roster.addedCharacterIds,
  };
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

async function patchMessageExtra(bridgeSession, chatId, messageId, patch, guard) {
  if (!guard) throw new Error("Presence refused an unguarded message visibility write");
  assertVisibilityPatchScope({
    extra: guard.previousExtra,
    patch,
    allowedCharacterIds: guard.allowedCharacterIds,
    operation: guard.operation,
  });
  return injectJson(
    bridgeSession,
    "PATCH",
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`,
    patch,
  );
}

async function patchChatState(persistence, chatId, statePatch) {
  return persistence.withChatLock(chatId, async () => {
    const chat = await persistence.getChat(chatId);
    if (!chat) return null;
    const currentState = readPresenceChatState(chat);
    const resolvedPatch = typeof statePatch === "function" ? statePatch(currentState) : statePatch;
    const metadata = writePresenceChatState(chat.metadata, resolvedPatch);
    await persistence.updateChatMetadata({ chatId, metadata, updatedAt: new Date().toISOString() });
    return readPresenceChatState({ metadata });
  });
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
