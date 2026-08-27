import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve("dist/package");
const manifestPath = path.join(packageRoot, "manifest.json");

assert(fs.existsSync(manifestPath), "dist/package/manifest.json exists");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const agents = JSON.parse(fs.readFileSync(path.join(packageRoot, "agents.json"), "utf8"));
assert(manifest.id === "presence", "manifest id is presence");
assert(manifest.version === "1.4.9", "manifest version is 1.4.9");
assert(manifest.engine?.min === "2.4.4" && manifest.engine?.maxExclusive === "2.4.5", "manifest matches the bridge-supported Engine release");
assert(manifest.entrypoints?.server === "server.mjs", "server entrypoint declared");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint declared");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint declared");
assert(manifest.contributions?.slots?.includes("chat-runtime"), "manifest declares its client runtime contribution");
assert(!manifest.contributions?.agentDetail, "manifest leaves native agent detail rendering intact");
assert(!manifest.permissions?.includes("prompt-context"), "Presence no longer requests prompt-context permission");
assert(agents[0]?.category === "tracker", "Presence is exposed as a tracker agent");
assert(agents[0]?.phase === "pre_generation", "Presence declares the required packaged agent phase");
assert(agents[0]?.execution === "feature", "Presence remains a feature runtime agent");
assert(agents[0]?.runtimeDisabled === true, "Presence is not sent through the native model-agent pipeline");
assert(!fs.readFileSync(path.join(packageRoot, "client.js"), "utf8").includes("import "), "client entrypoint is self-contained");
assert(!fs.readFileSync(path.join(packageRoot, "client.js"), "utf8").includes("/ensure"), "client does not poll or migrate chats on load");
const bundledClient = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");
const bundledServerRoutes = fs.readFileSync(path.join(packageRoot, "src/server/routes.js"), "utf8");
const bundledPresenceState = fs.readFileSync(path.join(packageRoot, "src/shared/presence-state.js"), "utf8");
assert(bundledClient.includes("activateClientWithMariBridge"), "client bundles fail-closed SDK activation");
assert(bundledClient.includes("bridgeSession.ui.register"), "client registers native bridge chat settings");
assert(bundledClient.includes('slot: "agent.settings"'), "client extends settings inside the native agent card");
assert(!bundledClient.includes('view !== "settings" && view !== "detail"'), "client does not replace the native agent detail view");
assert(bundledClient.includes('description: "Show or update character presence for this chat"'), "client advertises its slash command");
assert(!bundledClient.includes("mari-native-settings-choice"), "client does not ship a replacement settings framework");
assert(!bundledClient.includes("data-presence-chat-settings"), "client does not DOM-inject Presence chat settings");
assert(!bundledClient.includes("watchActiveChatId"), "client does not poll or scan for active chat state");
assert(bundledClient.includes("body: { characterId, alwaysPresent }"), "built client uses atomic target-only omnipresent settings");
assert(!bundledClient.includes("body: { alwaysPresentCharacterIds"), "built client cannot replace the omnipresent set from stale state");
assert(bundledServerRoutes.includes("Presence refused an unguarded message visibility write"), "built server rejects unguarded visibility writes");
assert(bundledServerRoutes.includes("assertVisibilityPatchScope"), "built server scopes every visibility mutation");
assert(!bundledPresenceState.includes("PRESENCE_MESSAGE_KEY"), "built shared state does not restore the positive attendance store");

for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(fs.existsSync(path.join(packageRoot, relativePath)), `entrypoint exists: ${relativePath}`);
}
const manifestFiles = new Set((manifest.files ?? []).map((file) => file.path));
for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(manifestFiles.has(relativePath), `manifest files include entrypoint: ${relativePath}`);
}

const emittedFiles = listFiles(packageRoot);
for (const file of emittedFiles) {
  if (!/\.(?:mjs|js)$/u.test(file)) continue;
  const content = fs.readFileSync(path.join(packageRoot, file), "utf8");
  assert(!content.includes("_mari-bridge"), `${file} does not reference source-only bridge paths`);
}

await import(pathToFileURL(path.join(packageRoot, "server.mjs")));

function listFiles(root) {
  const files = [];
  function walk(relativeDir) {
    for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      const relative = path.posix.join(relativeDir.split(path.sep).join(path.posix.sep), entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  walk("");
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Dist validation failed: ${message}`);
}

console.log("Presence dist validation passed.");
