import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "package");
const sdkRoot = path.resolve(root, "..", "_mari-bridge", "sdk");
const version = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;

await fs.rm(path.join(root, "dist"), { recursive: true, force: true });
await fs.mkdir(path.join(out, "src", "server"), { recursive: true });
await fs.mkdir(path.join(out, "src", "shared"), { recursive: true });
await fs.mkdir(path.join(out, "bridge-sdk"), { recursive: true });
for (const name of ["contracts.js", "server.js"]) {
  await fs.copyFile(path.join(sdkRoot, name), path.join(out, "bridge-sdk", name));
}

for (const name of ["index.js"]) {
  const source = (await fs.readFile(path.join(root, "src", "server", name), "utf8"))
    .replace('../../../_mari-bridge/sdk/server.js', '../../bridge-sdk/server.js');
  await fs.writeFile(path.join(out, "src", "server", name), source);
}
await fs.copyFile(path.join(root, "src", "shared", "state.js"), path.join(out, "src", "shared", "state.js"));
await fs.copyFile(path.join(root, "agents", "agents.json"), path.join(out, "agents.json"));
await fs.copyFile(path.join(root, "README.md"), path.join(out, "README.md"));
await fs.writeFile(path.join(out, "server.mjs"), 'export { activate, selfCheck } from "./src/server/index.js";\n');

const clientParts = [];
for (const file of [
  path.join(sdkRoot, "contracts.js"),
  path.join(sdkRoot, "client.js"),
  path.join(root, "src", "shared", "state.js"),
  path.join(root, "src", "client", "runtime.js"),
]) {
  clientParts.push(stripModuleSyntax(await fs.readFile(file, "utf8")));
}
await fs.writeFile(path.join(out, "client.js"), `${clientParts.join("\n\n")}\n`);

const manifest = {
  schemaVersion: 1,
  id: "gm-notes",
  name: "GM Notes",
  version,
  description: "Tracks reminders, unresolved threads, and diagnostics in committed GameState context.",
  engine: { min: "2.4.3", maxExclusive: "2.4.4" },
  kind: ["agent"],
  entrypoints: { server: "server.mjs", client: "client.js", agents: "agents.json" },
  contributions: { slots: ["chat-runtime"] },
  files: [
    { path: "server.mjs", sha256: "0".repeat(64), bytes: 0 },
    { path: "client.js", sha256: "0".repeat(64), bytes: 0 },
    { path: "agents.json", sha256: "0".repeat(64), bytes: 0 },
  ],
  permissions: ["agent-runtime", "chat-read", "chat-write", "ui"],
  restartRequired: true,
};
await fs.writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Built GM Notes prepared package.");

function stripModuleSyntax(content) {
  return content
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export\s+/gm, "");
}
