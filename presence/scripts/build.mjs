import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageRoot = path.join(distRoot, "package");
const bridgeRoot = path.resolve(projectRoot, "..", "_mari-bridge", "src");
const version = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version;

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });

await copyTree(path.join(projectRoot, "src/shared"), path.join(packageRoot, "src/shared"));
await copyTree(path.join(projectRoot, "src/server"), path.join(packageRoot, "src/server"), rewriteSourceImports);
await copyTree(path.join(projectRoot, "src/client"), path.join(packageRoot, "src/client"), rewriteSourceImports);
await copyTree(bridgeRoot, path.join(packageRoot, "bridge"));
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

await writeFile(path.join(packageRoot, "server.mjs"), `export { activate, selfCheck } from "./src/server/index.js";\n`);
await writeFile(path.join(packageRoot, "client.js"), `import "./src/client/runtime.js";\n`);
await writeFile(path.join(packageRoot, "agents.json"), `${JSON.stringify(agentDefinitions(), null, 2)}\n`);
await writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);

console.log(`Built Presence prepared package: ${path.relative(projectRoot, packageRoot)}`);

function manifest() {
  return {
    schemaVersion: 1,
    id: "presence",
    name: "Presence",
    version,
    description:
      "Tracks per-message character presence and mirrors chat summaries into character-scoped lorebook context.",
    engine: { min: "2.3.3", maxExclusive: "3.0.0" },
    kind: ["agent"],
    entrypoints: {
      server: "server.mjs",
      client: "client.js",
      agents: "agents.json",
    },
    files: [{ path: "server.mjs", sha256: "0".repeat(64), bytes: 0 }],
    permissions: ["agent-runtime", "chat-read", "chat-write", "prompt-context", "routes", "storage", "ui"],
    restartRequired: true,
  };
}

function agentDefinitions() {
  return [
    {
      id: "presence",
      name: "Presence",
      description: "Feature runtime for per-message character presence and scoped chat summaries.",
      category: "misc",
      phase: "pre_generation",
      execution: "feature",
      enabledByDefault: false,
      modeAllowlist: ["roleplay", "visual_novel"],
      defaultTools: [],
      defaultSettings: {},
      defaultPromptTemplate: "",
    },
  ];
}

async function copyTree(from, to, transform = (content) => content) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, target, transform);
    } else if (entry.isFile()) {
      const content = await fs.readFile(source, "utf8");
      await writeFile(target, transform(content));
    }
  }
}

function rewriteSourceImports(content) {
  return content.replaceAll("../../../_mari-bridge/src/", "../../bridge/");
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function bytesFile(file) {
  return statSync(file).size;
}

if (!existsSync(bridgeRoot)) {
  throw new Error("Missing shared root: _mari-bridge");
}
