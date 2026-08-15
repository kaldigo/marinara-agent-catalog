import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageRoot = path.join(distRoot, "package");
const bridgeRoot = path.resolve(projectRoot, "..", "_mari-bridge", "src");
const version = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version;

if (!existsSync(bridgeRoot)) throw new Error("Missing shared root: _mari-bridge");

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });

await copyTree(path.join(projectRoot, "src", "server"), path.join(packageRoot, "src", "server"), rewriteServerImports);
await copyTree(bridgeRoot, path.join(packageRoot, "bridge"));
await writeFile(path.join(packageRoot, "client.js"), await buildClientEntrypoint());
await writeFile(path.join(packageRoot, "server.mjs"), `export { activate, selfCheck } from "./src/server/index.js";\n`);
await writeFile(path.join(packageRoot, "agents.json"), `${JSON.stringify(agentDefinitions(), null, 2)}\n`);
await writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

console.log(`Built Persona Reapply prepared package: ${path.relative(projectRoot, packageRoot)}`);

async function buildClientEntrypoint() {
  const source = await fs.readFile(path.join(projectRoot, "src", "client", "runtime.js"), "utf8");
  return source.replaceAll('../../../_mari-bridge/src/', './assets/bridge/');
}

function rewriteServerImports(content) {
  return content.replaceAll("../../../_mari-bridge/src/", "../../bridge/");
}

function manifest() {
  return {
    schemaVersion: 1,
    id: "persona-reapply",
    name: "Persona Reapply",
    version,
    description: "Refreshes saved persona colours on individual messages or across a whole chat.",
    engine: { min: "2.4.2", maxExclusive: "3.0.0" },
    kind: ["agent"],
    entrypoints: {
      server: "server.mjs",
      client: "client.js",
      agents: "agents.json",
    },
    files: [
      { path: "server.mjs", sha256: "0".repeat(64), bytes: 0 },
      { path: "client.js", sha256: "0".repeat(64), bytes: 0 },
      { path: "agents.json", sha256: "0".repeat(64), bytes: 0 },
    ],
    permissions: ["chat-read", "chat-write", "routes", "ui"],
    restartRequired: true,
  };
}

function agentDefinitions() {
  return [
    {
      id: "persona-reapply",
      name: "Persona Reapply",
      description: "Feature runtime for refreshing historical persona message colours.",
      category: "misc",
      phase: "pre_generation",
      execution: "feature",
      enabledByDefault: false,
      libraryHidden: true,
      runtimeDisabled: true,
      modeAllowlist: ["conversation", "roleplay", "visual_novel"],
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
    if (entry.isDirectory()) await copyTree(source, target, transform);
    else if (entry.isFile()) await writeFile(target, transform(await fs.readFile(source, "utf8")));
  }
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
