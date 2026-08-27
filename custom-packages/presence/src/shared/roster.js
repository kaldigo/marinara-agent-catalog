import {
  assertVisibilityPatchScope,
  buildVisibilityDeltaPatch,
  normalizeObject,
  uniqueStrings,
  visibilityPatchChanges,
} from "./presence-state.js";

export function planRosterBackfill({ knownCharacterIds, currentRosterIds, messages, alwaysPresentCharacterIds = [] }) {
  const previous = uniqueStrings(knownCharacterIds);
  const current = uniqueStrings(currentRosterIds);
  if (!previous.length) return { addedCharacterIds: [], messagePatches: [] };
  const previousSet = new Set(previous);
  const added = current.filter((id) => !previousSet.has(id));
  if (!added.length) return { addedCharacterIds: [], messagePatches: [] };
  const alwaysPresent = new Set(uniqueStrings(alwaysPresentCharacterIds));
  const hiddenAdded = added.filter((id) => !alwaysPresent.has(id));
  if (!hiddenAdded.length) return { addedCharacterIds: added, messagePatches: [] };

  const messagePatches = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id) continue;
    const extra = normalizeObject(message.extra);
    if (extra.hiddenFromAI === true) continue;

    const patch = buildVisibilityDeltaPatch({
      extra,
      hiddenCharacterIds: hiddenAdded,
    });
    if (!visibilityPatchChanges(extra, patch)) continue;
    assertVisibilityPatchScope({
      extra,
      patch,
      allowedCharacterIds: hiddenAdded,
      operation: "New-character backfill",
    });
    messagePatches.push({ messageId: message.id, previousExtra: extra, allowedCharacterIds: hiddenAdded, patch });
  }

  return { addedCharacterIds: added, messagePatches };
}
