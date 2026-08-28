import assert from "node:assert/strict";
import {
  applyPersonaDetailResult,
  filterPersonaDetailFieldsFromCustomTracker,
  formatPersonaDetailContext,
  mergePersonaDetailFields,
} from "../src/server/persona-fields.js";

const reordered = mergePersonaDetailFields(
  [
    { name: "Activity", value: "Waiting" },
    { name: "Other", value: "Kept" },
    { name: "Location", value: "Hall" },
    { name: "Outfit", value: "Coat" },
  ],
  { Activity: "Running", Movement: "Fast", Outfit: "Jacket", Location: "Yard" },
  {},
);
assert.deepEqual(reordered.map((field) => field.name), ["Outfit", "Location", "Movement", "Activity", "Other"]);
assert.equal(reordered.find((field) => field.name === "Activity")?.value, "Running");
assert.equal(reordered.find((field) => field.name === "Other")?.value, "Kept");

const locked = mergePersonaDetailFields(
  [{ name: "Location", value: "Locked room" }],
  { Location: "Outside" },
  { "player.custom.name:Location.value": true },
);
assert.equal(locked[0]?.value, "Locked room");

let savedPatch = null;
let emittedPatch = null;
await applyPersonaDetailResult({
  result: { data: { trackerFields: { Outfit: "Blue coat", Location: "Courtyard", Movement: "Walking", Activity: "Talking" } } },
  state: {
    read: async () => ({ playerStats: { status: "Busy", customTrackerFields: [{ name: "Other", value: "Preserved" }] }, fieldLocks: {} }),
    update: async (patch) => { savedPatch = patch; },
  },
  emitPatch: (patch) => { emittedPatch = patch; },
});
assert.deepEqual(savedPatch, emittedPatch);
assert.equal(savedPatch.playerStats.status, "Busy");
assert.deepEqual(savedPatch.playerStats.customTrackerFields.map((field) => field.name), ["Outfit", "Location", "Movement", "Activity", "Other"]);

const contextFields = [
  { name: "Activity", value: "Talking" },
  { name: "Other", value: "Preserved custom value" },
  { name: "Movement", value: "Walking" },
  { name: "Outfit", value: "Blue coat" },
  { name: "Location", value: "Courtyard" },
];
assert.deepEqual(
  filterPersonaDetailFieldsFromCustomTracker({}, contextFields),
  [{ name: "Other", value: "Preserved custom value" }],
);
assert.deepEqual(
  formatPersonaDetailContext({ latestGameState: { playerStats: { customTrackerFields: contextFields } } }),
  {
    label: "Persona Details",
    content: "Outfit: Blue coat\nLocation: Courtyard\nMovement: Walking\nActivity: Talking",
  },
);
assert.deepEqual(
  formatPersonaDetailContext({ latestGameState: { playerStats: JSON.stringify({ customTrackerFields: contextFields }) } }),
  {
    label: "Persona Details",
    content: "Outfit: Blue coat\nLocation: Courtyard\nMovement: Walking\nActivity: Talking",
  },
);

const clientSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8"));
assert.match(clientSource, /target: "character"/u);
assert.match(clientSource, /target: "persona"/u);
assert.match(clientSource, /marinara-capability-tracker-profile-details/u);
assert.match(clientSource, /Location[\s\S]*Movement[\s\S]*Activity/u);
assert.match(clientSource, /Outfit[\s\S]*Location[\s\S]*Movement[\s\S]*Activity/u);
assert.match(clientSource, /minMinor: 9/u);
const serverSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/server/index.js", import.meta.url), "utf8"));
assert.match(serverSource, /minMinor: 9/u);
assert.match(serverSource, /tracker\.context/u);
assert.match(serverSource, /filterCustomTrackerFields: filterPersonaDetailFieldsFromCustomTracker/u);
assert.match(serverSource, /formatCommitted: formatPersonaDetailContext/u);
console.log("Tracker Profile Details checks passed.");
