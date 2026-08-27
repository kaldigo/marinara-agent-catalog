import { PRESENCE_PACKAGE_KEY, PRESENCE_SCHEMA_VERSION } from "./constants.js";
import { normalizeObject, uniqueStrings } from "./presence-state.js";

export function readPresenceChatState(chat) {
  const metadata = normalizeObject(chat?.metadata);
  const state = normalizeObject(metadata[PRESENCE_PACKAGE_KEY]);
  return {
    version: PRESENCE_SCHEMA_VERSION,
    alwaysPresentCharacterIds: uniqueStrings(state.alwaysPresentCharacterIds),
    knownCharacterIds: uniqueStrings(
      Array.isArray(state.knownCharacterIds) ? state.knownCharacterIds : state.rosterCharacterIds,
    ),
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
