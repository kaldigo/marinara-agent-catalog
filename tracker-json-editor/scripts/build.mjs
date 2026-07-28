import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const packageRoot = path.join(projectRoot, "dist", "package");
const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));

await fs.rm(path.join(projectRoot, "dist"), { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });

const clientSource = await fs.readFile(path.join(projectRoot, "src", "client.js"), "utf8");
await fs.writeFile(path.join(packageRoot, "client.js"), clientSource.replaceAll("__PACKAGE_VERSION__", packageJson.version));
await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(packageJson.version), null, 2)}\n`);
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

console.log(`Built Tracker JSON Editor prepared package: ${path.relative(projectRoot, packageRoot)}`);

function manifest(version) {
  return {
    schemaVersion: 1,
    id: "tracker-json-editor",
    name: "Tracker JSON Editor",
    version,
    description: "Adds per-section tracker JSON export/import buttons beside tracker rerun controls.",
    engine: { min: "2.3.3", maxExclusive: "3.0.0" },
    kind: ["agent"],
    entrypoints: {
      client: "client.js"
    },
    files: [
      { path: "client.js", sha256: "0".repeat(64), bytes: 0 }
    ],
    permissions: ["chat-read", "chat-write", "ui"],
    restartRequired: false
  };
}
