import { buildPresenceExtraPatch, normalizeObject, readPresenceState, uniqueStrings } from "./presence-state.js";

export function planRosterBackfill({ previousRosterIds, currentRosterIds, messages }) {
  const previous = uniqueStrings(previousRosterIds);
  const current = uniqueStrings(currentRosterIds);
  if (!previous.length) return { addedCharacterIds: [], messagePatches: [] };
  const previousSet = new Set(previous);
  const added = current.filter((id) => !previousSet.has(id));
  if (!added.length) return { addedCharacterIds: [], messagePatches: [] };

  const messagePatches = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id) continue;
    const extra = normalizeObject(message.extra);
    if (extra.hiddenFromAI === true) continue;

    const present = readPresenceState(message, previous);
    const patch = buildPresenceExtraPatch({
      extra,
      rosterIds: current,
      presentCharacterIds: [...present],
    });
    messagePatches.push({ messageId: message.id, patch });
  }

  return { addedCharacterIds: added, messagePatches };
}
