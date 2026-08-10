import {
  PRESENCE_LOREBOOK_NAME_PREFIX,
  PRESENCE_PACKAGE_KEY,
  PRESENCE_SCHEMA_VERSION,
} from "./constants.js";
import { normalizeObject, uniqueStrings } from "./presence-state.js";

export function readPresenceChatState(chat) {
  const metadata = normalizeObject(chat?.metadata);
  const state = normalizeObject(metadata[PRESENCE_PACKAGE_KEY]);
  return {
    version: PRESENCE_SCHEMA_VERSION,
    alwaysPresentCharacterIds: uniqueStrings(state.alwaysPresentCharacterIds),
    rosterCharacterIds: uniqueStrings(state.rosterCharacterIds),
    summaryLorebookId: typeof state.summaryLorebookId === "string" ? state.summaryLorebookId : null,
    summaryPresenceById: normalizeStringArrayMap(state.summaryPresenceById),
    pendingSummaryRestore: normalizePendingSummaryRestore(state.pendingSummaryRestore),
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
  };
}

export function writePresenceChatState(metadata, patch, now = new Date().toISOString()) {
  const normalized = normalizeObject(metadata);
  const previous = readPresenceChatState({ metadata: normalized });
  return {
    ...normalized,
    [PRESENCE_PACKAGE_KEY]: {
      ...previous,
      ...normalizeObject(patch),
      version: PRESENCE_SCHEMA_VERSION,
      updatedAt: now,
    },
  };
}

export function buildPresenceLorebookName(chatId) {
  return `${PRESENCE_LOREBOOK_NAME_PREFIX} - ${chatId || "active chat"}`;
}

function normalizeStringArrayMap(value) {
  const input = normalizeObject(value);
  const output = {};
  for (const [key, ids] of Object.entries(input)) {
    if (Array.isArray(ids)) output[key] = uniqueStrings(ids);
  }
  return output;
}

function normalizeBooleanMap(value) {
  const input = normalizeObject(value);
  const output = {};
  for (const [key, enabled] of Object.entries(input)) {
    if (typeof enabled === "boolean") output[key] = enabled;
  }
  return output;
}

function normalizePendingSummaryRestore(value) {
  const input = normalizeObject(value);
  const enabledStateById = normalizeBooleanMap(input.enabledStateById);
  const chatId = typeof input.chatId === "string" && input.chatId.trim() ? input.chatId.trim() : "";
  const runId = typeof input.runId === "string" && input.runId.trim() ? input.runId.trim() : "";
  if (!chatId || !runId || Object.keys(enabledStateById).length === 0) return null;
  return {
    chatId,
    runId,
    lorebookId: typeof input.lorebookId === "string" && input.lorebookId.trim() ? input.lorebookId.trim() : null,
    enabledStateById,
    startedAt: typeof input.startedAt === "string" && input.startedAt.trim() ? input.startedAt.trim() : null,
  };
}
