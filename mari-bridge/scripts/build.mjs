import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(projectRoot, "dist", "package");
const version = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version;

await fs.rm(path.join(projectRoot, "dist"), { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });
await fs.cp(path.join(projectRoot, "src"), path.join(packageRoot, "src"), { recursive: true });
await fs.cp(path.join(projectRoot, "bootstrap"), path.join(packageRoot, "bootstrap"), { recursive: true });
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));
await fs.writeFile(path.join(packageRoot, "server.mjs"), 'export { activate, selfCheck } from "./src/server/index.js";\n');
await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  id: "mari-bridge",
  name: "Mari Bridge",
  version,
  description: "Installs the version-bound injected bridge runtime used by Marinara capability packages.",
  engine: { min: "2.4.4", maxExclusive: "2.4.5" },
  kind: ["agent"],
  entrypoints: { server: "server.mjs" },
  files: [{ path: "server.mjs", sha256: "0".repeat(64), bytes: 0 }],
  permissions: ["agent-runtime"],
  restartRequired: true,
}, null, 2)}\n`);
console.log(`Built Mari Bridge prepared package: ${path.relative(projectRoot, packageRoot)}`);
