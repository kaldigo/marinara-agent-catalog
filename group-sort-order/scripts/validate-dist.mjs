import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve("dist/package");
const manifestPath = path.join(packageRoot, "manifest.json");

assert(fs.existsSync(manifestPath), "dist/package/manifest.json exists");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const agents = JSON.parse(fs.readFileSync(path.join(packageRoot, "agents.json"), "utf8"));
assert(manifest.id === "group-sort-order", "manifest id is group-sort-order");
assert(manifest.version === "1.2.4", "manifest version is 1.2.4");
assert(manifest.engine?.min === "2.4.0", "manifest requires the capability request resolver introduced in Engine 2.4");
assert(manifest.engine?.maxExclusive === "3.0.0", "manifest caps before unknown Engine 3 behavior");
assert(manifest.entrypoints?.server === "server.mjs", "server entrypoint declared");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint declared");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint declared");
assert(manifest.contributions?.slots?.includes("chat-runtime"), "chat-runtime contribution declared");
assert(manifest.contributions?.slots?.includes("chat-settings"), "chat-settings contribution declared");
assert(manifest.contributions?.agentDetail?.agentIds?.includes("group-sort-order"), "Group Sort Order agent detail contribution declared");
assert(agents[0]?.id === "group-sort-order", "feature agent id matches package");
assert(agents[0]?.execution === "feature", "agent is feature execution");
assert(agents[0]?.category === "misc", "feature agent category is misc");
assert(agents[0]?.runtimeDisabled === true, "feature marker does not run as a tracker agent");
const clientSource = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");
assert(clientSource.includes("marinara-capability-group-sort-order"), "client registers capability element");
assert(!clientSource.includes("import "), "client entrypoint is self-contained");
assert(clientSource.includes("activateClientWithMariBridge"), "client bundles fail-closed SDK activation");
assert(clientSource.includes("bridgeSession.ui.register"), "client registers the native bridge UI slot");
assert(clientSource.includes('slot: "composer.above-input"'), "client targets the composer-above-input slot");
assert(clientSource.includes("bridgeSession.chat.active.subscribe"), "client subscribes to bridge active-chat state");
assert(!clientSource.includes("declarePackageGeneration"), "client does not declare refresh as generation activity");
assert(!clientSource.includes("createComposerGenerationLock"), "client does not bundle composer generation lock code");
assert(!clientSource.includes("Stop generating"), "client cannot turn the send button into Stop for refresh");
assert(clientSource.includes("border-radius:999px"), "client uses round GSO icon buttons");
assert(clientSource.includes("view?.hidden !== false"), "client hides GSO bar until server view explicitly shows it");
assert(clientSource.includes("width:13px; height:13px"), "client uses smaller GSO icons");
assert(clientSource.includes("bindActiveChat(chatId || \"\")"), "client binds GSO state to bridge active chat");
assert(!clientSource.includes("readCapabilityChatId() || chatId"), "client does not prefer stale capability chat ids");
assert(!clientSource.includes("propsChatIds"), "client does not cache stale capability chat ids");
assert(!clientSource.includes("querySelector(\"[data-chat-id]\")"), "client does not inspect the DOM for active chat state");

for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(fs.existsSync(path.join(packageRoot, relativePath)), `entrypoint exists: ${relativePath}`);
}
const manifestFiles = new Set((manifest.files ?? []).map((file) => file.path));
for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(manifestFiles.has(relativePath), `manifest files include entrypoint: ${relativePath}`);
}

for (const file of listFiles(packageRoot)) {
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

console.log("Group Sort Order dist validation passed.");
