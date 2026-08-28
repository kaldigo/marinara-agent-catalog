import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(projectRoot, "dist", "package");
const sdkRoot = path.resolve(projectRoot, "..", "_mari-bridge", "sdk");
const version = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version;

await fs.rm(path.join(projectRoot, "dist"), { recursive: true, force: true });
await fs.mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
await fs.mkdir(path.join(packageRoot, "bridge-sdk"), { recursive: true });
for (const file of ["contracts.js", "server.js"]) {
  await fs.copyFile(path.join(sdkRoot, file), path.join(packageRoot, "bridge-sdk", file));
}
for (const file of ["index.js", "persona-fields.js"]) {
  const source = (await fs.readFile(path.join(projectRoot, "src", "server", file), "utf8"))
    .replaceAll('../../../_mari-bridge/sdk/', '../../bridge-sdk/');
  await fs.writeFile(path.join(packageRoot, "src", "server", file), source);
}
await fs.writeFile(path.join(packageRoot, "server.mjs"), 'export { activate, selfCheck } from "./src/server/index.js";\n');

const clientChunks = [];
for (const file of ["contracts.js", "client.js"]) {
  clientChunks.push(stripModuleSyntax(await fs.readFile(path.join(sdkRoot, file), "utf8")));
}
clientChunks.push(stripModuleSyntax(await fs.readFile(path.join(projectRoot, "src", "client", "runtime.js"), "utf8")));
await fs.writeFile(path.join(packageRoot, "client.js"), `${clientChunks.join("\n\n")}\n`);
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));
await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  id: "tracker-profile-details",
  name: "Tracker Profile Details",
  version,
  description: "Shows selected GameState custom fields as ordered native character and persona profile details.",
  engine: { min: "2.4.4", maxExclusive: "2.4.5" },
  kind: ["agent"],
  entrypoints: { server: "server.mjs", client: "client.js" },
  contributions: { slots: ["chat-runtime"] },
  files: [{ path: "server.mjs", sha256: "0".repeat(64), bytes: 0 }],
  permissions: ["agent-runtime", "ui"],
  restartRequired: true,
}, null, 2)}\n`);
console.log("Built Tracker Profile Details prepared package.");

function stripModuleSyntax(content) {
  return content
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import .*?;\r?\n/gm, "")
    .replace(/^export async function /gm, "async function ")
    .replace(/^export function /gm, "function ")
    .replace(/^export const /gm, "const ")
    .replace(/^export class /gm, "class ")
    .replace(/^export \{[^}]*\};?\r?\n/gm, "");
}
