import { formatGmNotesForCommittedContext } from "../../tracker-codecs/gm-notes.js";
import { DEFAULT_FRAGMENTS, normalizeUnifiedSettings } from "../shared/settings.js";
import { readUnifiedCheckpoint } from "../shared/result.js";

const QUEST_GUIDANCE = Object.freeze({
  "story": "Keep at most three active story quests. Complete or fail resolved quests before creating another.",
  "epic-campaign": "There is no active quest cap. Prefer extending a quest over creating a duplicate.",
  "real-life-goals": "Create quests only from real-life goals the user explicitly states for themselves. Never invent or pressure goals.",
  "single-focus": "Keep exactly one active quest at a time. Resolve it before creating the next.",
  "mystery-board": "Treat each case as a quest and its leads, clues, suspects, and unresolved questions as objectives.",
  "custom": "Follow the editable Quests section instructions exactly while retaining the required update schema.",
});

function record(value) {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function enabledSection(settings, name, contract) {
  const fragment = settings.fragments[name] || DEFAULT_FRAGMENTS[name];
  return [`<${name}_tracker_instructions>`, fragment, contract, `</${name}_tracker_instructions>`].join("\n");
}

export function buildUnifiedPromptExtension(settingsValue, context = {}) {
  const settings = normalizeUnifiedSettings(settingsValue);
  const sections = settings.sections;
  const output = [
    "You are producing one atomic Unified Tracker update from the completed conversation history available when this parallel run starts.",
    "Do not infer events from the assistant response currently being generated; it will be considered by a later tracker run.",
    "Return ONLY valid JSON. Return schemaVersion 1 and every enabled top-level section. Do not return disabled sections.",
    "The characters array is intentionally shared by the active persona, saved chat characters, and scene characters. Do not add type, persona/character prefixes, presentCharacters, or inScene.",
  ];

  if (sections.world) output.push(enabledSection(settings, "world", `Required world shape:\n${json({ date: "string|null", time: "string|null", location: "string|null", weather: "string|null", temperature: "string|null", recentEvents: ["string"], customFields: [{ name: "exact existing name", value: "string", icon: "kebab-case icon" }] })}`));
  if (sections.characters || sections.personaStats) {
    const row = { id: "real ID when known", name: "canonical display name", outfit: "string|null", location: "string|null", movement: "string|null", activity: "string|null", mood: "string|null", appearance: "string|null" };
    if (sections.characterStats || sections.personaStats) row.stats = [{ name: "existing configured stat name", value: "number" }];
    output.push(enabledSection(settings, "characters", `Required characters shape:\n${json([row])}\nAlways include the active persona and every saved chat character supplied below. Other rows may be included when relevant to the scene. Preserve omitted values from supplied state. For locked saved characters, do not change mood or appearance.`));
  }
  if (sections.characterStats) output.push(enabledSection(settings, "characterStats", "Only character rows with an existing configured stat schema may contain stats."));
  if (sections.personaStats) output.push(enabledSection(settings, "personaStats", "Only the active persona row may update persona bars. Do not return status or inventory."));
  if (sections.quests) output.push(enabledSection(settings, "quests", `${QUEST_GUIDANCE[settings.questPreset]}\nRequired quests shape:\n${json({ updates: [{ action: "create|update|complete|fail", questName: "exact existing name", description: "string", objectives: [{ text: "string", completed: "boolean" }], rewards: ["string"], notes: "string" }] })}\nIf nothing changed, return {"updates":[]}.`));
  if (sections.gmNotes) output.push(enabledSection(settings, "gmNotes", `Required gmNotes shape:\n${json({ updates: [{ action: "create|update|remove", id: "existing id for update/remove", kind: "reminder|thread|debug", text: "concise note" }] })}\nNever update or remove a locked note. If nothing changed, return {"updates":[]}.`));

  const personaId = typeof context?.memory?._personaId === "string" ? context.memory._personaId : "";
  const required = [];
  if (context.persona) required.push({ id: personaId, name: context.persona.name, role: "active persona", configuredStats: sections.personaStats ? context.persona?.personaStats?.bars ?? [] : undefined });
  for (const character of Array.isArray(context.characters) ? context.characters : []) {
    required.push({ id: character.id, name: character.name, role: "saved chat character", configuredStats: sections.characterStats && character?.rpgStats?.enabled ? character.rpgStats.pools ?? [] : undefined });
  }
  output.push(`<required_character_identities>\n${json(required)}\n</required_character_identities>`);
  output.push(`Output skeleton:\n${json({ schemaVersion: 1, ...(sections.world ? { world: {} } : {}), ...((sections.characters || sections.personaStats) ? { characters: [] } : {}), ...(sections.quests ? { quests: { updates: [] } } : {}), ...(sections.gmNotes ? { gmNotes: { updates: [] } } : {}) })}`);
  return output.join("\n\n");
}

export function formatUnifiedCheckpoint(gameState, settingsValue) {
  const checkpoint = readUnifiedCheckpoint(gameState);
  if (!checkpoint) return "";
  const settings = normalizeUnifiedSettings(settingsValue);
  const result = record(checkpoint.result);
  const filtered = { schemaVersion: 1 };
  if (settings.sections.world && result.world) filtered.world = result.world;
  if ((settings.sections.characters || settings.sections.personaStats) && Array.isArray(result.characters)) filtered.characters = result.characters;
  if (settings.sections.quests && result.quests) filtered.quests = result.quests;
  if (settings.sections.gmNotes && result.gmNotes) filtered.gmNotes = result.gmNotes;
  return Object.keys(filtered).length > 1 ? json(filtered) : "";
}

export function formatUnifiedAgentState(gameState) {
  const checkpoint = readUnifiedCheckpoint(gameState);
  if (!checkpoint) return undefined;
  const state = { checkpoint: checkpoint.result };
  if (checkpoint.sections?.gmNotes) {
    const notes = formatGmNotesForCommittedContext(gameState?.playerStats);
    if (notes) state.gmNotes = notes;
  }
  return state;
}
