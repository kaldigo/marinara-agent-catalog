import { PRESENCE_LOREBOOK_NAME_PREFIX, PRESENCE_SUMMARY_OUTLET_NAME } from "../shared/constants.js";
import { normalizeObject, readPresenceState, uniqueStrings } from "../shared/presence-state.js";

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

  const entries = [
    createWrapperEntry({ chatId, name: "__presence_chat_summaries_open", content: "<chat_summaries>", order: 0 }),
  ];

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

  entries.push(createWrapperEntry({
    chatId,
    name: "__presence_chat_summaries_close",
    content: "</chat_summaries>",
    order: 999999,
  }));

  return entries;
}

export function buildSummaryAudience({ summary, messagesById, rosterIds }) {
  const roster = uniqueStrings(rosterIds);
  const coveredIds = Array.isArray(summary?.messageIds) && summary.messageIds.length
    ? summary.messageIds
    : Array.isArray(summary?.hiddenMessageIds)
      ? summary.hiddenMessageIds
      : [];
  const coveredMessages = coveredIds.map((id) => messagesById.get(String(id))).filter(Boolean);
  if (!coveredMessages.length) return roster;
  return roster.filter((characterId) =>
    coveredMessages.some((message) => readPresenceState(message, roster).has(characterId)),
  );
}

function createWrapperEntry({ chatId, name, content, order }) {
  return {
    name,
    content,
    enabled: true,
    constant: true,
    locked: true,
    position: 7,
    outletName: PRESENCE_SUMMARY_OUTLET_NAME,
    order,
    preventRecursion: true,
    excludeFromVectorization: true,
    characterFilterMode: "any",
    characterFilterIds: [],
    generationTriggerFilterMode: "any",
    generationTriggerFilters: [],
    tag: "presence",
    dynamicState: {
      owner: "presence",
      chatId,
      wrapper: true,
    },
  };
}
