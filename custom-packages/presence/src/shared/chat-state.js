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
