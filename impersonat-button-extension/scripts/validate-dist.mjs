import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageDir = path.join(distRoot, "Marinara-Impersonate-Button");
const jsLimitBytes = 1024 * 1024;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifest = await readJson(path.join(packageDir, "manifest.json"));
const importJson = await readJson(path.join(distRoot, "impersonate-button.json"));
const js = await fs.readFile(path.join(packageDir, "impersonate-button.js"), "utf8");
const css = await fs.readFile(path.join(packageDir, "impersonate-button.css"), "utf8");

assert(manifest.kind === "marinara.extension", "Packaged manifest kind is invalid.");
assert(manifest.version === 14, "Packaged manifest version must be 14.");
assert(manifest.config?.name === "Impersonate Button", "Packaged manifest name is invalid.");
assert(manifest.config?.jsPath === "impersonate-button.js", "Packaged manifest jsPath is invalid.");
assert(manifest.config?.cssPath === "impersonate-button.css", "Packaged manifest cssPath is invalid.");
assert(importJson.kind === "marinara.extension", "Import JSON kind is invalid.");
assert(importJson.version === manifest.version, "Import JSON version does not match packaged manifest.");
assert(importJson.config?.js === js, "Import JSON JS does not match packaged JS.");
assert(importJson.config?.css === css, "Import JSON CSS does not match packaged CSS.");
assert(Buffer.byteLength(js, "utf8") <= jsLimitBytes, "Built JS exceeds Marinara extension byte limit.");
assert(js.includes("window[FACTORY_KEY] = factory"), "Built JS is missing packaged alDenteFactory bootstrap.");
assert(js.includes("src/al-dente-factory/identity.js"), "Built JS is missing factory identity helpers.");
assert(js.includes("src/al-dente-factory/commands.js"), "Built JS is missing factory command helpers.");
assert(js.includes("src/al-dente-factory/operations.js"), "Built JS is missing factory operation helpers.");
assert(js.includes("src/al-dente-factory/sse.js"), "Built JS is missing factory SSE helpers.");
assert(js.includes("stripImpersonateSpeakerPrefix"), "Built JS is missing impersonate prefix filtering.");
assert(js.includes("impersonate-button:dry-run"), "Built JS is missing impersonate operation integration.");
assert(css.includes(".mari-si-button"), "Built CSS is missing impersonate button styles.");

console.log("Dist validation passed.");
