import { PRESENCE_PACKAGE_KEY, PRESENCE_SCHEMA_VERSION, PRESENCE_LOREBOOK_NAME_PREFIX } from "./constants.js";
import { normalizeObject, uniqueStrings } from "./presence-state.js";

export function readPresenceChatState(chat) {
  const metadata = normalizeObject(chat?.metadata);
  const state = normalizeObject(metadata[PRESENCE_PACKAGE_KEY]);
  return {
    version: PRESENCE_SCHEMA_VERSION,
    rosterCharacterIds: uniqueStrings(state.rosterCharacterIds),
    summaryLorebookId: typeof state.summaryLorebookId === "string" ? state.summaryLorebookId : null,
    summaryEntryEnabledById: normalizeBooleanMap(state.summaryEntryEnabledById),
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

function normalizeBooleanMap(value) {
  const input = normalizeObject(value);
  const output = {};
  for (const [key, enabled] of Object.entries(input)) {
    if (typeof enabled === "boolean") output[key] = enabled;
  }
  return output;
}
