import { normalizeId } from "./strings.js";

export function maybeJson(value, fallback = null) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function recordOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function chatMetadata(chat) {
  return recordOrEmpty(maybeJson(chat?.metadata, chat?.metadata || {}));
}

export function messageExtra(message) {
  return recordOrEmpty(maybeJson(message?.extra, message?.extra || {}));
}

export function characterData(character) {
  return recordOrEmpty(maybeJson(character?.data, character?.data || {}));
}

export function messageContent(message) {
  return String(message?.content ?? message?.mes ?? message?.message ?? "");
}

export function readCharacterName(character, fallback = "") {
  const data = characterData(character);
  return String(character?.name || data?.name || fallback || character?.id || "Character").trim();
}

export function readCharacterDescription(character) {
  const data = characterData(character);
  const extensions = recordOrEmpty(maybeJson(data?.extensions, data?.extensions || {}));
  return String(
    [character?.description, data?.description, extensions?.backstory]
      .find((value) => typeof value === "string" && value.trim()) || "",
  );
}

export function getCharacterIds(chat) {
  const ids = maybeJson(chat?.characterIds, []);
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.trim()).map(String) : [];
}

export function getInactiveCharacterIds(chat) {
  const inactive = chatMetadata(chat).inactiveCharacterIds;
  return Array.isArray(inactive) ? inactive.filter((id) => typeof id === "string" && id.trim()).map(String) : [];
}

export function activeCharacterIdsForChat(chat, rosterIds = getCharacterIds(chat)) {
  const inactive = new Set(getInactiveCharacterIds(chat));
  const active = rosterIds.filter((id) => !inactive.has(id));
  return active.length ? active : rosterIds;
}

export function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeEntityId(value) {
  return normalizeId(value, "");
}

export function createParsersSurface() {
  return Object.freeze({
    maybeJson,
    recordOrEmpty,
    chatMetadata,
    messageExtra,
    characterData,
    messageContent,
    readCharacterName,
    readCharacterDescription,
    getCharacterIds,
    getInactiveCharacterIds,
    activeCharacterIdsForChat,
    normalizeName,
    normalizeEntityId,
  });
}
