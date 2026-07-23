import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageDir = path.join(distRoot, "Marinara-PWA-Helper");
const jsLimitBytes = 1024 * 1024;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifest = await readJson(path.join(packageDir, "manifest.json"));
const importJson = await readJson(path.join(distRoot, "pwa-helper.json"));
const js = await fs.readFile(path.join(packageDir, "pwa-helper.js"), "utf8");

assert(manifest.kind === "marinara.extension", "Packaged manifest kind is invalid.");
assert(manifest.version === 1, "Packaged manifest version must be 1.");
assert(manifest.config?.name === "PWA Helper", "Packaged manifest name is invalid.");
assert(manifest.config?.jsPath === "pwa-helper.js", "Packaged manifest jsPath is invalid.");
assert(importJson.kind === "marinara.extension", "Import JSON kind is invalid.");
assert(importJson.version === manifest.version, "Import JSON version does not match packaged manifest.");
assert(importJson.config?.js === js, "Import JSON JS does not match packaged JS.");
assert(Buffer.byteLength(js, "utf8") <= jsLimitBytes, "Built JS exceeds Marinara extension byte limit.");
assert(js.includes("navigator.wakeLock.request(\"screen\")"), "Built JS is missing screen wake lock request.");
assert(js.includes("window[FACTORY_KEY] = factory"), "Built JS is missing alDenteFactory registration.");
assert(js.includes("src/al-dente-factory/wake-lock.js"), "Built JS is missing modular alDenteFactory wake lock source.");
assert(js.includes("const wakeLock = createWakeLockController(state);"), "Built JS is missing alDenteFactory wake lock controller.");
assert(js.includes("activeLeases: () => wakeStatus().activeLeases"), "Built JS is missing alDenteFactory wake lock surface.");
assert(js.includes("src/al-dente-factory/services.js"), "Built JS is missing alDenteFactory services source.");
assert(js.includes("src/al-dente-factory/operations.js"), "Built JS is missing alDenteFactory operations source.");
assert(js.includes("src/al-dente-factory/identity.js"), "Built JS is missing alDenteFactory identity source.");
assert(js.includes("src/al-dente-factory/fetch-hub.js"), "Built JS is missing alDenteFactory fetch hub source.");
assert(js.includes("src/al-dente-factory/commands.js"), "Built JS is missing alDenteFactory command source.");
assert(js.includes("marinara = Object.freeze"), "Built JS is missing alDenteFactory Marinara adapter surface.");
assert(js.includes("pwa-helper:native-generation"), "Built JS is missing PWA Helper native generation lease.");
assert(js.includes("mari-chat-send-btn"), "Built JS is missing Marinara send button detection.");
assert(js.includes("IOS_ICON_GRADIENT = [\"#4de5dd\", \"#eb8951\", \"#e15c8c\"]"), "Built JS is missing iOS touch icon gradient.");
assert(js.includes("IOS_ICON_LOGO_FILL = \"#ffffff\""), "Built JS is missing iOS touch icon white logo fill.");
assert(js.includes("ensureHeadLink(\"apple-touch-icon\")"), "Built JS is missing iOS apple-touch-icon override.");
assert(js.includes("globalCompositeOperation = \"source-in\""), "Built JS is missing generated iOS touch icon logo mask.");
assert(js.includes("canvas.toDataURL(\"image/png\")"), "Built JS is missing generated iOS touch icon PNG.");

console.log("Dist validation passed.");
