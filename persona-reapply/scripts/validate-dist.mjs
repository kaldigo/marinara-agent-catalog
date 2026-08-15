import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..", "dist", "package");
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "manifest.json"), "utf8"));
const agents = JSON.parse(fs.readFileSync(path.join(packageRoot, "agents.json"), "utf8"));
const client = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");
const server = fs.readFileSync(path.join(packageRoot, "server.mjs"), "utf8");

assert.equal(manifest.id, "persona-reapply");
assert.equal(manifest.version, "1.0.2");
assert.deepEqual(manifest.permissions, ["chat-read", "chat-write", "routes", "ui"]);
assert.equal(manifest.restartRequired, true);
assert.equal(manifest.entrypoints.client, "client.js");
assert.equal(manifest.entrypoints.server, "server.mjs");
assert.equal(agents[0]?.execution, "feature");
assert(!/^\s*import\s/m.test(client), "client entrypoint is self-contained");
assert(client.includes("function registerMessageActionContribution"), "client bundles the message-action bridge");
assert(client.includes("function registerBridgeSlashCommand"), "client bundles the command bridge");
assert(server.includes('./src/server/index.js'), "server entrypoint targets packaged server source");
assert(fs.existsSync(path.join(packageRoot, "bridge", "host-routes.js")), "server bridge helper is packaged");
assert(fs.existsSync(path.join(packageRoot, "bridge", "capability-slots.js")), "message-action bridge is packaged");

console.log("Persona Reapply prepared package checks passed.");
