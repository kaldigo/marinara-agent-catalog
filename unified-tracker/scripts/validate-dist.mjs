import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../dist/package/", import.meta.url);
for (const path of ["manifest.json", "server.mjs", "client.js", "agents.json", "src/server/index.js", "src/shared/result.js", "tracker-codecs/gm-notes.js"]) await access(new URL(path, root));
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
assert.equal(manifest.id, "unified-tracker");
assert.equal(manifest.version, "1.0.0");
assert.equal(manifest.engine.min, "2.4.4");
assert.equal(manifest.entrypoints.agents, "agents.json");
console.log("Unified Tracker prepared package validated.");
