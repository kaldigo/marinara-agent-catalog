import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve("dist/package");
const manifestPath = path.join(packageRoot, "manifest.json");

assert(fs.existsSync(manifestPath), "dist/package/manifest.json exists");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const agents = JSON.parse(fs.readFileSync(path.join(packageRoot, "agents.json"), "utf8"));
assert(manifest.id === "presence", "manifest id is presence");
assert(manifest.version === "1.0.4", "manifest version is 1.0.4");
assert(manifest.engine?.maxExclusive === "3.0.0", "manifest caps Presence before unknown Engine 3 behavior");
assert(manifest.entrypoints?.server === "server.mjs", "server entrypoint declared");
assert(manifest.entrypoints?.client === "client.js", "client entrypoint declared");
assert(manifest.entrypoints?.agents === "agents.json", "agents entrypoint declared");
assert(agents[0]?.category === "tracker", "Presence is exposed as a tracker agent");
assert(agents[0]?.phase === "pre_generation", "Presence declares the required packaged agent phase");
assert(agents[0]?.execution === "feature", "Presence remains a feature runtime agent");
assert(!fs.readFileSync(path.join(packageRoot, "client.js"), "utf8").includes("import "), "client entrypoint is self-contained");
assert(fs.readFileSync(path.join(packageRoot, "client.js"), "utf8").includes("/ensure"), "client ensures chats on load");

for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(fs.existsSync(path.join(packageRoot, relativePath)), `entrypoint exists: ${relativePath}`);
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
