import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "package");
const sdkRoot = path.resolve(root, "..", "_mari-bridge", "sdk");
const codecRoot = path.resolve(root, "..", "_tracker-codecs");
const version = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;

await fs.rm(path.join(root, "dist"), { recursive: true, force: true });
for (const directory of ["bridge-sdk", "src/server", "src/shared", "tracker-codecs"]) {
  await fs.mkdir(path.join(out, directory), { recursive: true });
}
for (const name of ["contracts.js", "server.js"]) await fs.copyFile(path.join(sdkRoot, name), path.join(out, "bridge-sdk", name));
for (const name of ["gm-notes.js", "profile-details.js"]) await fs.copyFile(path.join(codecRoot, name), path.join(out, "tracker-codecs", name));
for (const name of ["settings.js", "result.js"]) {
  const source = (await fs.readFile(path.join(root, "src", "shared", name), "utf8"))
    .replaceAll('../../../_tracker-codecs/', '../../tracker-codecs/');
  await fs.writeFile(path.join(out, "src", "shared", name), source);
}
for (const name of ["prompt.js", "index.js"]) {
  const source = (await fs.readFile(path.join(root, "src", "server", name), "utf8"))
    .replace('../../../_mari-bridge/sdk/server.js', '../../bridge-sdk/server.js')
    .replaceAll('../../../_tracker-codecs/', '../../tracker-codecs/');
  await fs.writeFile(path.join(out, "src", "server", name), source);
}
await fs.copyFile(path.join(root, "agents", "agents.json"), path.join(out, "agents.json"));
await fs.copyFile(path.join(root, "README.md"), path.join(out, "README.md"));
await fs.writeFile(path.join(out, "server.mjs"), 'export { activate, selfCheck } from "./src/server/index.js";\n');

const clientParts = [];
for (const file of [
  path.join(sdkRoot, "contracts.js"),
  path.join(sdkRoot, "client.js"),
  path.join(root, "src", "shared", "settings.js"),
  path.join(root, "src", "client", "runtime.js"),
]) clientParts.push(stripModuleSyntax(await fs.readFile(file, "utf8")));
await fs.writeFile(path.join(out, "client.js"), `${clientParts.join("\n\n").trimEnd()}\n`);

const manifest = {
  schemaVersion: 1,
  id: "unified-tracker",
  name: "Unified Tracker",
  version,
  description: "Combines selected native tracker domains into one structured Roleplay post-processing request.",
  engine: { min: "2.4.4", maxExclusive: "2.4.5" },
  kind: ["agent"],
  entrypoints: { server: "server.mjs", client: "client.js", agents: "agents.json" },
  contributions: { slots: ["chat-runtime"] },
  files: [
    { path: "server.mjs", sha256: "0".repeat(64), bytes: 0 },
    { path: "client.js", sha256: "0".repeat(64), bytes: 0 },
    { path: "agents.json", sha256: "0".repeat(64), bytes: 0 }
  ],
  permissions: ["agent-runtime", "chat-read", "chat-write", "prompt-context", "storage", "ui"],
  restartRequired: true
};
await fs.writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Built Unified Tracker prepared package.");

function stripModuleSyntax(content) {
  return content.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "").replace(/^export\s+/gm, "");
}
