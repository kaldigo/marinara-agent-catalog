import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..", "dist", "package");
const manifestPath = path.join(packageRoot, "manifest.json");

const manifest = readJson(manifestPath);

assert(manifest.id === "impersonate-button", "manifest id must be impersonate-button");
assert(manifest.version === "0.1.1", "manifest version must be 0.1.1");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint must be client.js");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint must be agents.json");
assert(fs.existsSync(path.join(packageRoot, "client.js")), "missing client.js");
assert(fs.existsSync(path.join(packageRoot, "agents.json")), "missing agents.json");
assert(fs.existsSync(path.join(packageRoot, "README.md")), "missing README.md");

const client = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");
assert(client.includes("startImpersonateButtonPackage"), "client bundle missing runtime start");
assert(client.includes("createDomScope"), "client bundle missing _mari-bridge DOM scope");
assert(client.includes('PACKAGE_VERSION = "0.1.1"'), "client package version must match manifest");

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
