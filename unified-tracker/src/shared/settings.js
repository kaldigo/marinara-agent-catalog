export const UNIFIED_TRACKER_ID = "unified-tracker";
export const UNIFIED_TRACKER_RESULT_TYPE = "unified_tracker_update";
export const UNIFIED_TRACKER_NAMESPACE = "unified-tracker";

export const DEFAULT_SECTIONS = Object.freeze({
  world: true,
  characters: true,
  characterStats: false,
  personaStats: false,
  quests: false,
  gmNotes: false,
});

export const QUEST_PRESETS = Object.freeze(["story", "epic-campaign", "real-life-goals", "single-focus", "mystery-board", "custom"]);

export const DEFAULT_FRAGMENTS = Object.freeze({
  world: "Preserve the current world unless the completed conversation history supplied for this run changes it. Advance time realistically and retain every configured custom world field.",
  characters: "Track the active persona, every saved chat character, and scene-relevant returning characters. Preserve unchanged scene details and remove an incidental character only after they clearly leave the scene.",
  characterStats: "Update only existing configured character stats, proportionally to events. Never invent a new stat row.",
  personaStats: "Update only existing configured persona stat bars, proportionally to events. Do not return persona status or inventory.",
  quests: "Track only meaningful goals with stakes or narrative weight. Use exact existing quest names for updates and return the complete objective list when replacing objectives.",
  gmNotes: "Keep only durable reminders, unresolved threads, and continuity risks not already owned by another enabled tracker section.",
});

function record(value) {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanFragment(value, fallback) {
  return typeof value === "string" ? value.trim().slice(0, 8_000) : fallback;
}

export function normalizeUnifiedSettings(value) {
  const source = record(value);
  const rawSections = record(source.sections);
  const rawFragments = record(source.fragments);
  const sections = Object.fromEntries(Object.entries(DEFAULT_SECTIONS).map(([key, fallback]) => [
    key,
    typeof rawSections[key] === "boolean" ? rawSections[key] : fallback,
  ]));
  if (!sections.characters) sections.characterStats = false;
  return Object.freeze({
    schemaVersion: 1,
    sections: Object.freeze(sections),
    addToMainPrompt: source.addToMainPrompt !== false,
    questPreset: QUEST_PRESETS.includes(source.questPreset) ? source.questPreset : "story",
    fragments: Object.freeze(Object.fromEntries(Object.entries(DEFAULT_FRAGMENTS).map(([key, fallback]) => [
      key,
      cleanFragment(rawFragments[key], fallback),
    ]))),
  });
}

export function settingsFromChat(chat) {
  const metadata = record(chat?.metadata);
  return normalizeUnifiedSettings(metadata[UNIFIED_TRACKER_NAMESPACE]);
}

export function unifiedIsActive(chat) {
  const metadata = record(chat?.metadata);
  return chat?.mode === "roleplay"
    && metadata.enableAgents !== false
    && Array.isArray(metadata.activeAgentIds)
    && metadata.activeAgentIds.includes(UNIFIED_TRACKER_ID);
}
