import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..", "dist", "package");
const manifestPath = path.join(packageRoot, "manifest.json");

const manifest = readJson(manifestPath);

assert(manifest.id === "impersonate-button", "manifest id must be impersonate-button");
assert(manifest.version === "1.0.0", "manifest version must be 1.0.0");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint must be client.js");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint must be agents.json");
assert(fs.existsSync(path.join(packageRoot, "client.js")), "missing client.js");
assert(fs.existsSync(path.join(packageRoot, "agents.json")), "missing agents.json");
assert(fs.existsSync(path.join(packageRoot, "README.md")), "missing README.md");

const client = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");
assert(client.includes("startImpersonateButtonPackage"), "client bundle missing runtime start");
assert(client.includes("createDomScope"), "client bundle missing _mari-bridge DOM scope");
assert(client.includes('PACKAGE_VERSION = "1.0.0"'), "client package version must match manifest");
assert(client.includes("findOpenQuickActionsMenu"), "client bundle mounts bridge quick actions inside native quick-reply menus");
assert(client.includes("marinara-chat-input-shell"), "client bundle anchors slots to the native input shell");
assert(client.includes("mari-ib-icon-shell"), "client bundle includes native-style quick action icon shells");

console.log("Dist validation passed.");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}
