function readImpersonateSettings() {
  const fallback = {
    impersonatePromptTemplate: "",
    impersonatePresetId: null,
    impersonateConnectionId: null,
    impersonateBlockAgents: false,
  };

  try {
    const raw = localStorage.getItem("marinara-engine-ui");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const state = parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
    return {
      impersonatePromptTemplate: typeof state.impersonatePromptTemplate === "string" ? state.impersonatePromptTemplate : "",
      impersonatePresetId:
        typeof state.impersonatePresetId === "string" && state.impersonatePresetId.trim()
          ? state.impersonatePresetId.trim()
          : null,
      impersonateConnectionId:
        typeof state.impersonateConnectionId === "string" && state.impersonateConnectionId.trim()
          ? state.impersonateConnectionId.trim()
          : null,
      impersonateBlockAgents: state.impersonateBlockAgents === true,
    };
  } catch {
    return fallback;
  }
}

async function readChat(chatId) {
  if (!chatId) return null;
  try {
    return await apiRequest(`/chats/${encodeURIComponent(chatId)}`);
  } catch {
    return null;
  }
}

async function readPersonaName(chatId) {
  const chat = await readChat(chatId);
  const personaId = typeof chat?.personaId === "string" && chat.personaId.trim() ? chat.personaId.trim() : "";
  if (personaId) {
    try {
      const persona = await apiRequest(`/characters/personas/${encodeURIComponent(personaId)}`);
      if (typeof persona?.name === "string" && persona.name.trim()) return persona.name.trim();
    } catch {}
  }

  try {
    const persona = await apiRequest("/characters/personas/active");
    if (typeof persona?.name === "string" && persona.name.trim()) return persona.name.trim();
  } catch {}

  return "";
}

async function readChatImpersonatePrompt(chatId) {
  const chat = await readChat(chatId);
  const metadata = readChatMetadata(chat);
  return typeof metadata.impersonatePrompt === "string" ? metadata.impersonatePrompt.trim() : "";
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readChatMetadata(chat) {
  try {
    return typeof chat?.metadata === "string" ? JSON.parse(chat.metadata || "{}") : chat?.metadata || {};
  } catch {
    return {};
  }
}

function readChatCharacterIds(chat) {
  return parseJsonArray(chat?.characterIds)
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => id.trim());
}

async function readPrimaryCharacterName(chat) {
  const characterId = readChatCharacterIds(chat)[0];
  if (!characterId) return "";
  try {
    const character = await apiRequest(`/characters/${encodeURIComponent(characterId)}`);
    const data = typeof character?.data === "string" ? JSON.parse(character.data || "{}") : character?.data;
    return typeof data?.name === "string" ? data.name.trim() : "";
  } catch {
    return "";
  }
}

async function readRegexScripts() {
  try {
    const scripts = await apiRequest("/regex-scripts");
    return Array.isArray(scripts) ? scripts : [];
  } catch {
    return [];
  }
}
