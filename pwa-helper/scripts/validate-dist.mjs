import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("dist/package");
const manifestPath = path.join(packageRoot, "manifest.json");
const clientPath = path.join(packageRoot, "client.js");
const agentsPath = path.join(packageRoot, "agents.json");
const generationMonitorSourcePath = path.resolve("src/client/generation-monitor.js");

assert(fs.existsSync(manifestPath), "dist/package/manifest.json exists");
assert(fs.existsSync(clientPath), "dist/package/client.js exists");
assert(fs.existsSync(agentsPath), "dist/package/agents.json exists");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const agents = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
const client = fs.readFileSync(clientPath, "utf8");
const generationMonitorSource = fs.readFileSync(generationMonitorSourcePath, "utf8");

assert(manifest.schemaVersion === 1, "manifest schemaVersion is 1");
assert(manifest.id === "pwa-helper", "manifest id is pwa-helper");
assert(manifest.name === "PWA Helper", "manifest name is PWA Helper");
assert(manifest.version === "1.0.3", "manifest version is 1.0.3");
assert(manifest.engine?.min === "2.3.3", "manifest engine min is 2.3.3");
assert(manifest.engine?.maxExclusive === "3.0.0", "manifest caps before Engine 3");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint declared");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint declared");
assert(!manifest.entrypoints?.server, "server entrypoint is not declared");
assert(manifest.permissions.length === 1 && manifest.permissions[0] === "ui", "manifest only requests ui permission");
assert(manifest.restartRequired === false, "manifest does not require restart");
assert(agents.length === 1, "one packaged agent definition is emitted");
assert(agents[0]?.id === "pwa-helper", "packaged agent id is pwa-helper");
assert(agents[0]?.phase === "pre_generation", "packaged agent declares a Marinara phase");
assert(agents[0]?.execution === "feature", "packaged agent is a feature marker");
assert(agents[0]?.libraryHidden === true, "packaged agent is hidden from the library");
assert(agents[0]?.runtimeDisabled === true, "packaged agent runtime is disabled");

assert(!client.includes("import "), "client entrypoint is self-contained");
assert(client.includes("customElements.define(ELEMENT_TAG, PwaHelperElement)"), "client registers package element");
assert(client.includes("navigator.wakeLock.request(\"screen\")"), "client requests screen wake lock");
assert(client.includes("window[PUBLIC_API_KEY] = api"), "client exposes public API fallback");
assert(client.includes('PACKAGE_VERSION = "1.0.3"'), "client package version matches manifest");
assert(client.includes("marinara:pwa-helper-ready"), "client dispatches ready event");
assert(client.includes("`${PACKAGE_ID}:bridge-generation`"), "client has bridge generation wake lease");
assert(client.includes("mari-bridge:generation-state"), "client consumes bridge generation state events");
assert(client.includes("mari-bridge:generating-main"), "client consumes bridge main generation events");
assert(client.includes("mari-bridge:generating-agent"), "client consumes bridge agent generation events");
assert(client.includes("ensureGenerationLifecycleBridge"), "client starts the bridge generation lifecycle");
assert(client.includes("getBridgeGenerationSnapshot"), "client reads bridge generation snapshots");
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
