// Script tools can propose data changes; snapshot ownership stays with Marinara.
const sceneFields = ["date", "time", "location", "weather", "temperature"];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const comparable = (name) => name.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
const emptyPlayer = () => ({ stats: [], attributes: null, skills: {}, inventory: [], activeQuests: [], status: "" });

// Match Engine 2.4.6's data shapes. Unknown properties (including nested lock
// controls) fail closed instead of being silently lost during native persistence.
export function validateScriptGameStatePatch(value) {
  const string = (v) => typeof v === "string";
  const name = (v) => string(v) && !!v.trim();
  const number = (v) => typeof v === "number" && Number.isFinite(v);
  const boolean = (v) => typeof v === "boolean";
  const nullable = (check) => (v) => v === null || check(v);
  const array = (check) => (v) => Array.isArray(v) && v.every(check);
  const map = (check) => (v) => record(v) && Object.entries(v).every(([k, x]) =>
    !["__proto__", "prototype", "constructor"].includes(k) && check(x));
  const shape = (fields, required = Object.keys(fields)) => (v) => record(v)
    && required.every((k) => Object.hasOwn(v, k))
    && Object.entries(v).every(([k, x]) => Object.hasOwn(fields, k) && fields[k](x));
  const stat = shape({ name, value: number, max: number, color: string });
  const trackerRow = shape({ name, qty: number, description: string, location: string }, ["name"]);
  const worldField = shape({ name, value: string, icon: nullable(string) }, ["name", "value"]);
  const customField = shape({ name, value: string });
  const inventory = shape({ name, description: string, quantity: number, location: string });
  const quest = shape({ questEntryId: string, name, currentStage: number,
    objectives: array(shape({ text: string, completed: boolean })), completed: boolean });
  const character = shape({ characterId: string, name, emoji: string, mood: string,
    action: string, appearance: nullable(string), outfit: nullable(string), avatarPath: nullable(string),
    avatarCrop: () => true, portraitFocusX: number, portraitFocusY: number, portraitZoom: number,
    customFields: map(string), stats: array(stat), thoughts: nullable(string),
  }, ["characterId", "name", "emoji", "mood", "appearance", "outfit", "customFields", "stats", "thoughts"]);
  const player = shape({ stats: array(stat), attributes: nullable(shape({ str: number, dex: number,
    con: number, int: number, wis: number, cha: number })), skills: map(number), inventory: array(inventory),
    activeQuests: array(quest), status: string, customTrackerFields: array(customField),
    inventoryTrackerCurrencies: array(trackerRow), inventoryTrackerEquipped: array(trackerRow),
    inventoryTrackerInventory: array(trackerRow),
  }, []);
  const fields = Object.fromEntries(sceneFields.map((field) => [field, nullable(string)]));
  const worldRows = (v) => array(worldField)(v) || (shape({ updates: array(worldField), removed: array(string) }, [])(v)
    && (Object.hasOwn(v, "updates") || Object.hasOwn(v, "removed")));
  Object.assign(fields, { worldCustomFields: worldRows, presentCharacters: array(character),
    recentEvents: array(string), playerStats: nullable(player), personaStats: nullable(array(stat)) });
  if (!record(value) || Object.keys(value).length === 0) throw new Error("GameState patch must be a non-empty object.");
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`GameState field ${key} is not writable by Script tools.`);
    if (!fields[key](entry)) throw new Error(`Invalid GameState value for ${key}.`);
  }
  // Duplicate identities can make native row/lock matching ambiguous. Reject
  // them before a second copy of a locked row can masquerade as a new row.
  const unique = (rows, label, id) => {
    const keys = (rows ?? []).map((row) => id && row[id]?.trim() ? `id:${row[id].trim()}` : `name:${comparable(row.name)}`);
    if (new Set(keys).size !== keys.length) throw new Error(`Duplicate ${label} identities.`);
  };
  unique(Array.isArray(value.worldCustomFields) ? value.worldCustomFields : value.worldCustomFields?.updates, "worldCustomFields");
  unique(value.presentCharacters, "presentCharacters", "characterId");
  unique(value.personaStats, "personaStats");
  for (const character of value.presentCharacters ?? []) unique(character.stats, "character stats");
  for (const key of ["stats", "inventory", "customTrackerFields", "inventoryTrackerCurrencies", "inventoryTrackerEquipped", "inventoryTrackerInventory"]) {
    unique(value.playerStats?.[key], `playerStats.${key}`);
  }
  unique(value.playerStats?.activeQuests, "quests", "questEntryId");
  return value;
}

// Each script's calls become one atomic patch. Arrays use last-assignment wins;
// playerStats is a partial object, so unrelated player trackers are preserved.
export function mergeScriptGameStateEffects(effects) {
  if (!Array.isArray(effects) || effects.length > 64) throw new Error("Invalid Script effects.");
  let patch = {};
  for (const effect of effects) {
    if (!record(effect) || effect.type !== "game_state_patch") throw new Error("Unknown Script effect.");
    validateScriptGameStatePatch(effect.patch);
    patch = { ...patch, ...effect.patch,
      ...(record(effect.patch.playerStats) ? { playerStats: { ...patch.playerStats, ...effect.patch.playerStats } } : {}),
    };
  }
  if (Buffer.byteLength(JSON.stringify(patch), "utf8") > 256 * 1024) throw new Error("Script GameState patch exceeds 256 KiB.");
  return effects.length ? patch : null;
}

export function prepareScriptGameStatePatch(input, current, locationIsAuthoritative, applyLocks, normalizeWorldFields) {
  validateScriptGameStatePatch(input);
  if (Object.hasOwn(input, "location") && locationIsAuthoritative) {
    throw new Error("Location is controlled by Spatial Context. Use the game's movement controls.");
  }
  const patch = structuredClone(input);
  if (Array.isArray(patch.worldCustomFields)) patch.worldCustomFields = normalizeWorldFields(patch.worldCustomFields);
  if (record(patch.playerStats)) patch.playerStats = { ...emptyPlayer(), ...current?.playerStats, ...patch.playerStats };
  // Native lock merging only operates on arrays/objects. Expand null clears for
  // that check so they cannot bypass locks on contained rows or cells.
  const checked = { ...patch,
    ...(patch.personaStats === null ? { personaStats: [] } : {}),
    ...(patch.playerStats === null ? { playerStats: { ...emptyPlayer(), customTrackerFields: [],
      inventoryTrackerCurrencies: [], inventoryTrackerEquipped: [], inventoryTrackerInventory: [] } } : {}),
  };
  const unlockedState = current ? structuredClone(current) : null;
  for (const field of unlockedState?.playerStats?.customTrackerFields ?? []) delete field.locked;
  const unlocked = applyLocks(checked, unlockedState, {});
  const locked = applyLocks(checked, current);
  for (const key of Object.keys(checked)) {
    if (JSON.stringify(locked[key]) !== JSON.stringify(unlocked[key])) {
      throw new Error(`The ${key} field contains a locked value; no change was applied.`);
    }
  }
  return { ...locked,
    ...(patch.personaStats === null ? { personaStats: null } : {}),
    ...(patch.playerStats === null ? { playerStats: null } : {}),
  };
}

// Run the mixed native/script queue in model call order at the native save
// boundary. Scripts are never re-executed when their proposed effects commit.
export async function executePendingScriptGameStateCalls(calls, executeNative, context) {
  const results = [];
  for (const call of calls) {
    if (context.isAborted()) break;
    if (!call.mariBridgeScriptPatch) {
      results.push(...await executeNative([call], context));
      continue;
    }
    try {
      await context.applyScriptGameStatePatch(call.mariBridgeScriptPatch);
      results.push({ name: call.name, success: true, result: JSON.stringify({ applied: true, pending: false }) });
    } catch (error) {
      results.push({ name: call.name, success: false, result: JSON.stringify({ error: error.message }) });
    }
  }
  return results;
}
