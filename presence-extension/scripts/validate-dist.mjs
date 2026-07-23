import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageDir = path.join(distRoot, "Presence");
const jsLimitBytes = 1024 * 1024;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifest = await readJson(path.join(packageDir, "manifest.json"));
const importJson = await readJson(path.join(distRoot, "presence.json"));
const js = await fs.readFile(path.join(packageDir, "presence.js"), "utf8");

assert(manifest.kind === "marinara.extension", "Packaged manifest kind is invalid.");
assert(manifest.version === 1, "Packaged manifest version must be 1.");
assert(manifest.config?.name === "Presence", "Packaged manifest name is invalid.");
assert(manifest.config?.jsPath === "presence.js", "Packaged manifest jsPath is invalid.");
assert(importJson.kind === "marinara.extension", "Import JSON kind is invalid.");
assert(importJson.version === manifest.version, "Import JSON version does not match packaged manifest.");
assert(importJson.config?.js === js, "Import JSON JS does not match packaged JS.");
assert(Buffer.byteLength(js, "utf8") <= jsLimitBytes, "Built JS exceeds Marinara extension byte limit.");
assert(js.includes("window[FACTORY_KEY] = factory"), "Built JS is missing packaged alDenteFactory bootstrap.");
assert(js.includes("src/al-dente-factory/fetch-hub.js"), "Built JS is missing factory fetch hub helpers.");
assert(js.includes("src/al-dente-factory/commands.js"), "Built JS is missing factory command helpers.");
assert(js.includes("src/al-dente-factory/generation.js"), "Built JS is missing factory generation helpers.");
assert(js.includes("src/al-dente-factory/messages.js"), "Built JS is missing factory message helpers.");
assert(js.includes("src/al-dente-factory/operations.js"), "Built JS is missing factory operation helpers.");
assert(js.includes("src/al-dente-factory/parsers.js"), "Built JS is missing factory parser helpers.");
assert(js.includes("presence:fetch-generate"), "Built JS is missing Presence fetch generate integration.");
assert(js.includes("presence:fetch-message-create"), "Built JS is missing Presence message create integration.");
assert(js.includes("presence:generate"), "Built JS is missing Presence shared generation integration.");
assert(js.includes("presence:command"), "Built JS is missing Presence command integration.");

console.log("Dist validation passed.");
