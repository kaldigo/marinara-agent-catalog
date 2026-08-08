import { PRESENCE_LOREBOOK_NAME_PREFIX, PRESENCE_SUMMARY_OUTLET_NAME } from "../shared/constants.js";
import { readPresenceState, uniqueStrings } from "../shared/presence-state.js";

export function buildSummaryLorebookName(chatId) {
  return `${PRESENCE_LOREBOOK_NAME_PREFIX} - ${chatId}`;
}

export function buildSummaryLorebookEntries({
  chatId,
  summaries,
  audienceBySummaryId = new Map(),
}) {
  const enabledSummaries = (Array.isArray(summaries) ? summaries : [])
    .filter((entry) => entry?.id)
    .filter((entry) => entry.enabled !== false);

  const entries = [];

  for (const summary of enabledSummaries) {
    const characterIds = uniqueStrings(audienceBySummaryId.get(summary.id) || []);
    if (!characterIds.length) continue;
    entries.push({
      name: String(summary.id),
      content: String(summary.content || ""),
      enabled: true,
      constant: true,
      locked: true,
      position: 7,
      outletName: PRESENCE_SUMMARY_OUTLET_NAME,
      order: 10 + entries.length,
      preventRecursion: true,
      excludeFromVectorization: true,
      characterFilterMode: "include",
      characterFilterIds: characterIds,
      generationTriggerFilterMode: "any",
      generationTriggerFilters: [],
      tag: "presence",
      dynamicState: {
        owner: "presence",
        chatId,
        summaryId: String(summary.id),
      },
    });
  }

  return entries;
}

export function buildSummaryAudience({ summary, messagesById, rosterIds, alwaysPresentCharacterIds = [] }) {
  const roster = uniqueStrings(rosterIds);
  const rosterSet = new Set(roster);
  const alwaysPresent = new Set(uniqueStrings(alwaysPresentCharacterIds).filter((id) => rosterSet.has(id)));
  const coveredIds = Array.isArray(summary?.messageIds) && summary.messageIds.length
    ? summary.messageIds
    : Array.isArray(summary?.hiddenMessageIds)
      ? summary.hiddenMessageIds
      : [];
  const coveredMessages = coveredIds.map((id) => messagesById.get(String(id))).filter(Boolean);
  if (!coveredMessages.length) return roster;
  return roster.filter((characterId) =>
    alwaysPresent.has(characterId) ||
    coveredMessages.some((message) => readPresenceState(message, roster).has(characterId)),
  );
}
