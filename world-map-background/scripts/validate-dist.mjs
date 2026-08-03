import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const packageRoot = path.join(projectRoot, "dist", "package");

const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "manifest.json"), "utf8"));
assert(manifest.id === "world-map-background", "manifest id matches package");
assert(manifest.entrypoints?.client === "client.js", "manifest has client entrypoint");
assert(manifest.entrypoints?.agents === "agents.json", "manifest has agent entrypoint");
assert(!manifest.entrypoints?.server, "manifest has no server entrypoint");
assert(manifest.contributions?.slots?.includes("chat-runtime"), "manifest declares chat-runtime slot");
assert(manifest.permissions?.includes("chat-write"), "manifest includes chat-write permission");

const agents = JSON.parse(await fs.readFile(path.join(packageRoot, "agents.json"), "utf8"));
assert(agents[0]?.id === "world-map-background", "agent id matches package");
assert(agents[0]?.execution === "feature", "agent is a feature agent");
assert(agents[0]?.runtimeDisabled === true, "agent runtime is client-owned");
assert(agents[0]?.modeAllowlist?.includes("roleplay"), "agent is available in Roleplay");

const client = await fs.readFile(path.join(packageRoot, "client.js"), "utf8");
assert(client.includes("marinara-capability-world-map-background"), "client defines capability element");
assert(client.includes("watchActiveChatId"), "client bundles bridge active chat watcher");
assert(!/^import\s/m.test(client), "client bundle has no import statements");
assert(!/^export\s/m.test(client), "client bundle has no export statements");

function assert(condition, message) {
  if (!condition) throw new Error(`Dist validation failed: ${message}`);
}

console.log("World Map Background dist validation passed.");
