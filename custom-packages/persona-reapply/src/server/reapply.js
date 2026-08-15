export function parseMessageExtra(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function personaData(record) {
  if (!record) return null;
  let data = record.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}

export function buildRefreshedPersonaSnapshot(existing, persona, personaId) {
  const current = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : null;
  const resolvedPersonaId = String(current?.personaId || personaId || "").trim();
  if (!resolvedPersonaId) throw new Error("No persona is associated with this message.");

  const base = current
    ? { ...current }
    : {
        personaId: resolvedPersonaId,
        name: String(persona.name || "Persona"),
        avatarUrl: persona.avatarPath || null,
        avatarCrop: persona.avatarCrop || null,
      };

  return {
    ...base,
    personaId: resolvedPersonaId,
    nameColor: persona.nameColor || null,
    dialogueColor: persona.dialogueColor || null,
    boxColor: persona.boxColor || null,
  };
}

export function selectMessagePersonaId(message, chat) {
  const extra = parseMessageExtra(message?.extra);
  const snapshot = extra.personaSnapshot;
  const savedId = snapshot && typeof snapshot === "object" ? String(snapshot.personaId || "").trim() : "";
  return savedId || String(chat?.personaId || "").trim();
}
