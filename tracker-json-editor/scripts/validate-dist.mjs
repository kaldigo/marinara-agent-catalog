import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("dist/package");
const manifestPath = path.join(packageRoot, "manifest.json");
const clientPath = path.join(packageRoot, "client.js");

assert(fs.existsSync(manifestPath), "dist/package/manifest.json exists");
assert(fs.existsSync(clientPath), "dist/package/client.js exists");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const client = fs.readFileSync(clientPath, "utf8");

assert(manifest.id === "tracker-json-editor", "manifest id is tracker-json-editor");
assert(manifest.version === "1.0.2", "manifest version is 1.0.2");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint declared");
assert(!manifest.entrypoints?.server, "server entrypoint is not declared");
assert(manifest.permissions.includes("chat-read"), "manifest requests chat-read");
assert(manifest.permissions.includes("chat-write"), "manifest requests chat-write");
assert(manifest.permissions.includes("ui"), "manifest requests ui");
assert(client.includes("TRACKER_JSON_EDITOR_VERSION = \"1.0.2\""), "client version is stamped");
assert(client.includes("marinara-capability-tracker-json-editor"), "client registers package element");
assert(client.includes("mergeSectionPatchForSave"), "client merges partial playerStats patches before saving");
assert(client.includes("activeQuests: playerStats.activeQuests"), "client exposes quest-only playerStats patches");
assert(client.includes("/api/chats/"), "client uses chat game-state endpoints");
assert(client.includes("MutationObserver"), "client watches tracker headers");
assert(client.includes("data-tracker-json-editor-button"), "client marks injected buttons");
assert(client.includes("presentCharacters"), "client supports character tracker patches");
assert(client.includes("worldCustomFields"), "client supports world tracker patches");

for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(fs.existsSync(path.join(packageRoot, relativePath)), `entrypoint exists: ${relativePath}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Dist validation failed: ${message}`);
}

console.log("Tracker JSON Editor dist validation passed.");
