import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(projectRoot, "dist", "package");
const sdkRoot = path.resolve(projectRoot, "..", "_mari-bridge", "sdk");
const version = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version;
await fs.rm(path.join(projectRoot, "dist"), { recursive: true, force: true });
await fs.mkdir(path.join(packageRoot, "src", "server"), { recursive: true });
await fs.cp(sdkRoot, path.join(packageRoot, "bridge-sdk"), { recursive: true });
const serverSource = (await fs.readFile(path.join(projectRoot, "src", "server", "index.js"), "utf8"))
  .replace('../../../_mari-bridge/sdk/server.js', '../../bridge-sdk/server.js');
await fs.writeFile(path.join(packageRoot, "src", "server", "index.js"), serverSource);
await fs.writeFile(path.join(packageRoot, "server.mjs"), 'export { activate, selfCheck } from "./src/server/index.js";\n');

const contracts = stripModuleSyntax(await fs.readFile(path.join(sdkRoot, "contracts.js"), "utf8"));
const clientSdk = stripModuleSyntax(await fs.readFile(path.join(sdkRoot, "client.js"), "utf8"));
const clientRuntime = await fs.readFile(path.join(projectRoot, "src", "client", "runtime.js"), "utf8");
await fs.writeFile(path.join(packageRoot, "client.js"), [contracts, clientSdk, clientRuntime, ""].join("\n\n"));
await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  id: "mari-bridge-smoke",
  name: "Mari Bridge Smoke Test",
  version,
  description: "Test-only consumer that proves Mari Bridge SDK gating and cleanup.",
  engine: { min: "2.4.2", maxExclusive: "3.0.0" },
  kind: ["agent"],
  entrypoints: { server: "server.mjs", client: "client.js" },
  contributions: { slots: ["chat-runtime"] },
  files: [{ path: "server.mjs", sha256: "0".repeat(64), bytes: 0 }],
  permissions: ["prompt-context", "routes", "ui"],
  restartRequired: true,
}, null, 2)}\n`);
console.log("Built Mari Bridge smoke package.");

function stripModuleSyntax(content) {
  return content
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^export\s+/gm, "");
}
