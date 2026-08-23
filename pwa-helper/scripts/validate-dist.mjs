import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("dist/package");
const manifestPath = path.join(packageRoot, "manifest.json");
const clientPath = path.join(packageRoot, "client.js");
const generationMonitorSourcePath = path.resolve("src/client/generation-monitor.js");

assert(fs.existsSync(manifestPath), "dist/package/manifest.json exists");
assert(fs.existsSync(clientPath), "dist/package/client.js exists");
assert(!fs.existsSync(path.join(packageRoot, "agents.json")), "no fake agent definition is emitted");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const client = fs.readFileSync(clientPath, "utf8");
const generationMonitorSource = fs.readFileSync(generationMonitorSourcePath, "utf8");

assert(manifest.schemaVersion === 1, "manifest schemaVersion is 1");
assert(manifest.id === "pwa-helper", "manifest id is pwa-helper");
assert(manifest.name === "PWA Helper", "manifest name is PWA Helper");
assert(manifest.version === "1.0.7", "manifest version is 1.0.7");
assert(manifest.engine?.min === "2.4.3", "manifest engine min matches Mari Bridge");
assert(manifest.engine?.maxExclusive === "2.4.4", "manifest stops before an unpatched Engine release");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint declared");
assert(!manifest.entrypoints?.agents, "no agents entrypoint is declared");
assert(!manifest.entrypoints?.server, "server entrypoint is not declared");
assert(manifest.permissions.length === 1 && manifest.permissions[0] === "ui", "manifest only requests ui permission");
assert(manifest.restartRequired === false, "manifest does not require restart");
assert(JSON.stringify(manifest.contributions?.slots) === JSON.stringify(["chat-runtime"]), "package is loaded as a global chat runtime extension");

assert(!client.includes("import "), "client entrypoint is self-contained");
assert(client.includes("customElements.define(ELEMENT_TAG, PwaHelperElement)"), "client registers package element");
assert(client.includes("navigator.wakeLock.request(\"screen\")"), "client requests screen wake lock");
assert(client.includes("window[PUBLIC_API_KEY] = api"), "client exposes public API fallback");
assert(client.includes('PACKAGE_VERSION = "1.0.7"'), "client package version matches manifest");
assert(client.includes("marinara:pwa-helper-ready"), "client dispatches ready event");
assert(client.includes("`${PACKAGE_ID}:bridge-generation`"), "client has bridge generation wake lease");
assert(client.includes("activateClientWithMariBridge"), "client activates through the Mari Bridge SDK");
assert(client.includes('"generation.lifecycle"'), "client requires bridge generation lifecycle capability");
assert(client.includes("bridgeGeneration.subscribe"), "client subscribes to bridge generation snapshots");
assert(client.includes("bridgeGeneration.getSnapshot"), "client reads bridge generation snapshots");
assert(!client.includes("ensureGenerationLifecycleBridge"), "client does not embed the legacy bridge lifecycle");
assert(!generationMonitorSource.includes("querySelector"), "PWA generation monitor does not query DOM buttons");
assert(!generationMonitorSource.includes("MutationObserver"), "PWA generation monitor does not observe DOM mutations");
assert(!generationMonitorSource.includes("mari-chat-send-btn"), "PWA generation monitor does not target Marinara send buttons");
assert(client.includes("IOS_ICON_GRADIENT = [\"#4de5dd\", \"#eb8951\", \"#e15c8c\"]"), "client uses Mari gradient icon background");
assert(client.includes("IOS_ICON_LOGO_FILL = \"#ffffff\""), "client masks logo to white");
assert(client.includes("ensureHeadLink(\"apple-touch-icon\")"), "client installs apple-touch-icon");
assert(client.includes("globalCompositeOperation = \"source-in\""), "client masks source icon");

for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(fs.existsSync(path.join(packageRoot, relativePath)), `entrypoint exists: ${relativePath}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Dist validation failed: ${message}`);
}

console.log("PWA Helper dist validation passed.");
