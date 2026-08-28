import assert from "node:assert/strict";
import fs from "node:fs/promises";

const root = new URL("../dist/package/", import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL("manifest.json", root), "utf8"));
assert.equal(manifest.id, "tracker-profile-details");
assert.equal(manifest.version, "1.0.1");
assert.equal(manifest.entrypoints.client, "client.js");
assert.equal(manifest.entrypoints.server, "server.mjs");
assert.deepEqual(manifest.permissions, ["agent-runtime", "ui"]);
const client = await fs.readFile(new URL("client.js", root), "utf8");
assert.doesNotMatch(client, /^import\s/mu);
assert.doesNotMatch(client, /^export\s/mu);
assert.match(client, /tracker\.detail-fields/u);
const server = await fs.readFile(new URL("src/server/index.js", root), "utf8");
assert.match(server, /agentPrompts\.register/u);
assert.match(server, /agentResults\.register/u);
console.log("Tracker Profile Details dist validation passed.");
