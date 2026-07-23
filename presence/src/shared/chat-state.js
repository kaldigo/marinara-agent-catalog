import {
  PRESENCE_LOREBOOK_NAME_PREFIX,
  PRESENCE_MIGRATION_VERSION,
  PRESENCE_PACKAGE_KEY,
  PRESENCE_SCHEMA_VERSION,
} from "./constants.js";
import { normalizeObject, uniqueStrings } from "./presence-state.js";

export function readPresenceChatState(chat) {
  const metadata = normalizeObject(chat?.metadata);
  const state = normalizeObject(metadata[PRESENCE_PACKAGE_KEY]);
  return {
    version: PRESENCE_SCHEMA_VERSION,
    rosterCharacterIds: uniqueStrings(state.rosterCharacterIds),
    summaryLorebookId: typeof state.summaryLorebookId === "string" ? state.summaryLorebookId : null,
    summaryEntryEnabledById: normalizeBooleanMap(state.summaryEntryEnabledById),
    extensionMigrationVersion:
      typeof state.extensionMigrationVersion === "number" ? state.extensionMigrationVersion : 0,
    extensionMigratedAt: typeof state.extensionMigratedAt === "string" ? state.extensionMigratedAt : null,
    extensionMigrationUnresolved: normalizeMigrationUnresolved(state.extensionMigrationUnresolved),
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

export function buildExtensionMigrationMarker({ unresolved = [], now = new Date().toISOString() } = {}) {
  return {
    extensionMigrationVersion: PRESENCE_MIGRATION_VERSION,
    extensionMigratedAt: now,
    extensionMigrationUnresolved: normalizeMigrationUnresolved(unresolved),
  };
}

function normalizeBooleanMap(value) {
  const input = normalizeObject(value);
  const output = {};
  for (const [key, enabled] of Object.entries(input)) {
    if (typeof enabled === "boolean") output[key] = enabled;
  }
  return output;
}

function normalizeMigrationUnresolved(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const item = normalizeObject(entry);
      const messageId = typeof item.messageId === "string" ? item.messageId : "";
      const values = uniqueStrings(item.values);
      return messageId && values.length ? { messageId, values } : null;
    })
    .filter(Boolean);
}
