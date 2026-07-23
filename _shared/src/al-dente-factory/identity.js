import {
  activeCharacterIdsForChat,
  characterData,
  getCharacterIds,
  messageContent,
  normalizeName,
  readCharacterName,
} from "./parsers.js";

const CACHE_TTL_MS = 5000;

function cacheGet(cache, key) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.value;
}

function cacheSet(cache, key, value) {
  cache.set(key, { at: Date.now(), value });
  return value;
}

function readPersonaName(persona, fallback = "") {
  const data = characterData(persona);
  return String(persona?.name || data?.name || fallback || persona?.id || "Persona").trim();
}

function addNameIndex(map, name, value) {
  const normalized = normalizeName(name);
  if (normalized && !map.has(normalized)) map.set(normalized, value);
}

export function createIdentityService(state, api, parsers) {
  function readActiveChatId() {
    const stored = localStorage.getItem("marinara-active-chat-id");
    if (stored) return stored;
    const selected = document.querySelector('[data-chat-id][aria-current="true"], [data-chat-id][class*="sidebar-accent"]');
    return selected?.getAttribute("data-chat-id") || "";
  }

  async function getChat(chatId = readActiveChatId()) {
    if (!chatId) return null;
    const key = String(chatId);
    const cached = cacheGet(state.caches.chats, key);
    if (cached) return cached;
    const chat = await api.get(`/chats/${encodeURIComponent(key)}`);
    return cacheSet(state.caches.chats, key, chat);
  }

  async function getMessages(chatId = readActiveChatId()) {
    if (!chatId) return [];
    const key = String(chatId);
    const cached = cacheGet(state.caches.messages, key);
    if (cached) return cached;
    const res = await api.get(`/chats/${encodeURIComponent(key)}/messages`);
    const messages = Array.isArray(res) ? res : res?.messages || res?.data || [];
    return cacheSet(state.caches.messages, key, messages);
  }

  async function getCharacter(characterId) {
    if (!characterId) return null;
    const key = String(characterId);
    const cached = cacheGet(state.caches.characters, key);
    if (cached) return cached;
    const character = await api.get(`/characters/${encodeURIComponent(key)}`).catch(() => null);
    const normalized = character ? { ...character, id: character.id || key, name: readCharacterName(character, key) } : null;
    return cacheSet(state.caches.characters, key, normalized);
  }

  async function getPersona(personaId) {
    if (!personaId) return null;
    const key = String(personaId);
    const cached = cacheGet(state.caches.personas, key);
    if (cached) return cached;
    const persona = await api.get(`/characters/personas/${encodeURIComponent(key)}`).catch(() => null);
    const normalized = persona ? { ...persona, id: persona.id || key, name: readPersonaName(persona, key) } : null;
    return cacheSet(state.caches.personas, key, normalized);
  }

  async function getActivePersona(chatId = readActiveChatId()) {
    const chat = chatId ? await getChat(chatId).catch(() => null) : null;
    const personaId = typeof chat?.personaId === "string" && chat.personaId.trim() ? chat.personaId.trim() : "";
    if (personaId) {
      const persona = await getPersona(personaId);
      if (persona) return persona;
    }
    const active = await api.get("/characters/personas/active").catch(() => null);
    return active ? { ...active, id: active.id || personaId || "active", name: readPersonaName(active, "Persona") } : null;
  }

  async function getRoster(chatId = readActiveChatId()) {
    const chat = await getChat(chatId);
    if (!chat) return null;
    const ids = getCharacterIds(chat);
    const characters = [];
    for (const id of ids) {
      const character = await getCharacter(id);
      characters.push(character || { id, name: id });
    }
    const persona = await getActivePersona(chatId);
    const charactersById = new Map(characters.map((character) => [character.id, character]));
    const charactersByName = new Map();
    for (const character of characters) {
      addNameIndex(charactersByName, character.name, character);
      const data = characterData(character);
      if (Array.isArray(data?.aliases)) {
        for (const alias of data.aliases) addNameIndex(charactersByName, alias, character);
      }
    }
    const personaNames = new Map();
    if (persona) {
      addNameIndex(personaNames, persona.name, persona);
      addNameIndex(personaNames, "{{user}}", persona);
    }

    return {
      chatId,
      chat,
      persona,
      characters,
      characterIds: ids,
      activeCharacterIds: activeCharacterIdsForChat(chat, ids),
      charactersById,
      charactersByName,
      personaNames,
    };
  }

  function matchCharacter(value, roster) {
    if (!value || !roster) return null;
    const raw = String(value).trim();
    return roster.charactersById?.get(raw) || roster.charactersByName?.get(normalizeName(raw)) || null;
  }

  async function resolveSpeaker(message, chatId = readActiveChatId()) {
    const roster = await getRoster(chatId).catch(() => null);
    const characterId = typeof message?.characterId === "string" ? message.characterId.trim() : "";
    if (characterId && roster?.charactersById?.has(characterId)) {
      return { type: "character", character: roster.charactersById.get(characterId), name: roster.charactersById.get(characterId).name };
    }
    if (message?.role === "user" && roster?.persona) {
      return { type: "persona", persona: roster.persona, name: roster.persona.name };
    }
    return { type: message?.role || "unknown", name: messageContent(message).split(":")[0] || "" };
  }

  function clearCache(scope = "all") {
    if (scope === "all" || scope === "chats") state.caches.chats.clear();
    if (scope === "all" || scope === "messages") state.caches.messages.clear();
    if (scope === "all" || scope === "characters") state.caches.characters.clear();
    if (scope === "all" || scope === "personas") state.caches.personas.clear();
  }

  return Object.freeze({
    readActiveChatId,
    getChat,
    getMessages,
    getCharacter,
    getPersona,
    getActivePersona,
    getRoster,
    resolveSpeaker,
    matchCharacter,
    normalizeName,
    clearCache,
    parsers,
  });
}
