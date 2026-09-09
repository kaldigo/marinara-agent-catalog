import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyUnifiedPackageState, nativeDerivedResults, normalizeUnifiedResult, validateUnifiedResult } from "../src/shared/result.js";
import { normalizeUnifiedSettings } from "../src/shared/settings.js";
import { buildUnifiedPromptExtension, formatUnifiedCheckpoint } from "../src/server/prompt.js";

const settings = normalizeUnifiedSettings({ sections: { world: true, characters: true, characterStats: false, personaStats: true, quests: true, gmNotes: true } });
const context = {
  memory: { _personaId: "persona-1" },
  persona: { name: "Alex", personaStats: { bars: [{ name: "Energy", value: 80, max: 100, color: "#fff" }] } },
  characters: [{ id: "char-1", name: "Morgan", rpgStats: { enabled: false } }],
  characterTrackerHistory: [{ characterId: "char-1", name: "Morgan", outfit: "coat", mood: "calm" }],
};
const data = {
  schemaVersion: 1,
  world: { date: "Day 2", customFields: [] },
  characters: [
    { id: "char-1", name: "Morgan", mood: "alert", stats: [{ name: "HP", value: 1 }] },
    { id: "persona-1", name: "Alex", outfit: "blue shirt", stats: [{ name: "Energy", value: 72 }] },
  ],
  quests: { updates: [] },
  gmNotes: { updates: [{ action: "create", kind: "thread", text: "The sealed door remains unexplored." }] },
};
validateUnifiedResult(data, settings);
const normalized = normalizeUnifiedResult(data, settings, { state: { presentCharacters: [] }, agentContext: context });
assert.equal(normalized.output.characters[0].name, "Morgan");
assert.equal(normalized.output.characters[0].outfit, "coat");
assert.equal(normalized.output.characters[0].stats, undefined);
assert.equal(normalized.output.characters[1].name, "Alex");
assert.equal(normalized.output.characters[1].stats[0].value, 72);
assert.equal(Object.hasOwn(normalized.output, "persona"), false);
assert.equal(normalized.persona.name, "Alex");
assert.deepEqual(normalized.trackedCharacters.map((entry) => entry.name), ["Morgan"]);
const native = nativeDerivedResults({ agentId: "a", agentType: "unified-tracker" }, normalized);
assert.deepEqual(native.map((entry) => entry.type), ["game_state_update", "character_tracker_update", "persona_stats_update", "quest_update"]);
const nativeCharacters = native.find((entry) => entry.type === "character_tracker_update").data.presentCharacters;
assert.equal(Object.isFrozen(nativeCharacters), false);
nativeCharacters.splice(0, nativeCharacters.length, { ...nativeCharacters[0], name: "Canonical Morgan" });
assert.equal(nativeCharacters[0].name, "Canonical Morgan");
assert.equal(normalized.trackedCharacters[0].name, "Morgan");
const locked = normalizeUnifiedResult({
  ...data,
  characters: [
    { id: "char-1", name: "Morgan", mood: "furious", appearance: "mud-covered" },
    data.characters[1],
  ],
}, settings, {
  state: {
    presentCharacters: [{ characterId: "char-1", name: "Morgan", mood: "calm", appearance: "clean" }],
    fieldLocks: {
      "characters.id:char-1.mood": true,
      "characters.id:char-1.appearance": true,
    },
  },
  agentContext: context,
});
assert.equal(locked.trackedCharacters[0].mood, "calm");
assert.equal(locked.trackedCharacters[0].appearance, "clean");
const playerStats = applyUnifiedPackageState({ playerStats: { packageState: { other: { keep: true } } } }, normalized, { messageId: "m1", swipeIndex: 2 });
assert.equal(playerStats.packageState.other.keep, true);
assert.equal(playerStats.packageState["gm-notes"].notes.length, 1);
assert.equal(playerStats.packageState["unified-tracker"].source.swipeIndex, 2);
const customPrompt = buildUnifiedPromptExtension(normalizeUnifiedSettings({
  sections: { world: false, characters: true, characterStats: false, personaStats: false, quests: false, gmNotes: false },
  fragments: { characters: "Use this chat-specific character contract." },
}), context);
assert.match(customPrompt, /Use this chat-specific character contract\./u);
assert.match(customPrompt, /"characters": \[\]/u);
assert.doesNotMatch(customPrompt, /<world_tracker_instructions>/u);
const checkpoint = formatUnifiedCheckpoint({ playerStats }, normalizeUnifiedSettings({
  sections: { world: false, characters: true, characterStats: false, personaStats: false, quests: false, gmNotes: false },
}));
assert.match(checkpoint, /"characters"/u);
assert.doesNotMatch(checkpoint, /"world"/u);
assert.doesNotMatch(checkpoint, /"gmNotes"/u);
assert.throws(() => validateUnifiedResult({ schemaVersion: 1 }, settings), /missing enabled section/u);
const agents = JSON.parse(await readFile(new URL("../agents/agents.json", import.meta.url), "utf8"));
assert.equal(agents[0].defaultSettings.resultType, "unified_tracker_update");
assert.equal(agents[0].phase, "parallel");
assert.equal(agents[0].defaultSettings.skipOnRegenerate, true);
assert.deepEqual(agents[0].modeAllowlist, ["roleplay"]);
console.log("Unified Tracker source checks passed.");
