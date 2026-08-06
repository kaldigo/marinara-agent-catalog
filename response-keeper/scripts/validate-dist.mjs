import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("dist/package");
const manifestPath = path.join(packageRoot, "manifest.json");

assert(fs.existsSync(manifestPath), "dist/package/manifest.json exists");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const client = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");
const agents = JSON.parse(fs.readFileSync(path.join(packageRoot, "agents.json"), "utf8"));

assert(manifest.id === "response-keeper", "manifest id is response-keeper");
assert(manifest.version === JSON.parse(fs.readFileSync("package.json", "utf8")).version, "manifest version matches package.json");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint declared");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint declared");
assert(manifest.permissions.includes("chat-read"), "chat-read permission declared");
assert(manifest.permissions.includes("chat-write"), "chat-write permission declared");
assert(!manifest.permissions.includes("routes"), "server routes are not required");
assert(agents[0]?.id === "response-keeper", "feature marker agent id is response-keeper");
assert(agents[0]?.modeAllowlist?.includes("roleplay"), "roleplay mode is allowed");
assert(!agents[0]?.modeAllowlist?.includes("game"), "game mode is excluded");
assert(client.includes("regenerateMessageId"), "client handles stopped regenerations");
assert(client.includes("continueMessageId"), "client handles stopped continuations");
assert(client.includes("appendContinuationMessageContent"), "continue appends partial content without adding a swipe");
assert(client.includes("manualEdit: false"), "continue clears manual edit classification");
assert(!client.includes("continuedAt"), "continue does not add extra audit metadata");
assert(client.includes("manualEdit"), "client marks manual edit swipes");
assert(client.includes("installFetchInterceptor"), "client uses bridge fetch interception");
assert(!client.includes("import "), "client entrypoint is self-contained");

function assert(condition, message) {
  if (!condition) throw new Error(`Dist validation failed: ${message}`);
}
