import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(projectRoot, "dist", "package");
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.id, "mari-bridge");
assert.equal(manifest.restartRequired, true);
for (const entrypoint of Object.values(manifest.entrypoints)) await fs.access(path.join(root, entrypoint));
for (const required of [
  "bootstrap/register.mjs",
  "src/server/runtime.js",
  "src/server/result-registry.js",
  "src/server/tracker-context-registry.js",
  "src/client/runtime.js",
]) {
  await fs.access(path.join(root, required));
}
console.log("Mari Bridge prepared package validated.");
