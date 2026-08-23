import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = path.resolve("dist/package");
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "manifest.json"), "utf8"));
const agents = JSON.parse(fs.readFileSync(path.join(packageRoot, "agents.json"), "utf8"));

assert(manifest.id === "group-sort-order", "manifest id is stable");
assert(manifest.entrypoints?.server === "server.mjs", "server entrypoint is declared");
assert(manifest.entrypoints?.agents === "agents.json", "agent definitions are declared");
assert(!manifest.entrypoints?.client, "no client runtime is shipped");
assert(!manifest.contributions?.agentDetail, "native agent detail is not replaced");
assert(JSON.stringify(manifest.permissions) === JSON.stringify(["agent-runtime"]), "only agent runtime permission remains");
assert(agents[0]?.id === "group-sort-order", "agent id matches package");
assert(agents[0]?.runtimeDisabled === true, "native executor skips the selector definition");
assert(agents[0]?.execution !== "feature", "definition uses the normal native agent editor");
assert(agents[0]?.defaultPromptTemplate?.includes("valid JSON array"), "native prompt editor receives the selector prompt");

for (const relativePath of Object.values(manifest.entrypoints)) {
  assert(fs.existsSync(path.join(packageRoot, relativePath)), `entrypoint exists: ${relativePath}`);
}
for (const file of listFiles(packageRoot)) {
  if (!/\.(?:mjs|js)$/u.test(file)) continue;
  const content = fs.readFileSync(path.join(packageRoot, file), "utf8");
  assert(!content.includes("../../../_mari-bridge"), `${file} does not reference source-only bridge paths`);
  assert(!content.includes("<next_speaker>"), `${file} contains no legacy main-response marker handling`);
}
await import(pathToFileURL(path.join(packageRoot, "server.mjs")));

function listFiles(root) {
  const files = [];
  const walk = (relativeDir) => {
    for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
      const relative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) walk(relative);
      else files.push(relative);
    }
  };
  walk("");
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Dist validation failed: ${message}`);
}

console.log("Group Sort Order server-only distribution validated.");
