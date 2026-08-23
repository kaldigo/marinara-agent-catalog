import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageRoot = path.join(distRoot, "package");
const sdkRoot = path.resolve(projectRoot, "..", "_mari-bridge", "sdk");
const version = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8")).version;

if (!existsSync(sdkRoot)) {
  throw new Error("Missing shared root: _mari-bridge");
}

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });

await copyTree(path.join(projectRoot, "src/client"), path.join(packageRoot, "src/client"));
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

await writeFile(path.join(packageRoot, "client.js"), await buildClientEntrypoint());
await writeFile(path.join(packageRoot, "agents.json"), `${JSON.stringify(agentDefinitions(), null, 2)}\n`);
await writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);

console.log(`Built World Map Background prepared package: ${path.relative(projectRoot, packageRoot)}`);

function manifest() {
  return {
    schemaVersion: 1,
    id: "world-map-background",
    name: "World Map Background",
    version,
    description: "Uses the active World Maps location reference image as the Roleplay chat background.",
    engine: { min: "2.4.3", maxExclusive: "2.4.4" },
    kind: ["agent"],
    entrypoints: {
      client: "client.js",
      agents: "agents.json"
    },
    contributions: {
      slots: ["chat-runtime"]
    },
    files: [],
    permissions: ["chat-read", "chat-write", "ui"],
    restartRequired: false
  };
}

function agentDefinitions() {
  return [
    {
      id: "world-map-background",
      name: "World Map Background",
      description: "Uses the active World Maps location reference image as the Roleplay chat background.",
      category: "tracker",
      phase: "pre_generation",
      execution: "feature",
      enabledByDefault: false,
      runtimeDisabled: true,
      modeAllowlist: ["roleplay"],
      defaultTools: [],
      defaultSettings: {},
      defaultPromptTemplate: ""
    }
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

async function buildClientEntrypoint() {
  const chunks = [];
  for (const file of ["contracts.js", "client.js"]) {
    const source = await fs.readFile(path.join(sdkRoot, file), "utf8");
    chunks.push(`// bridge-sdk/${file}\n${stripBrowserModuleSyntax(source).trim()}\n`);
  }
  const runtimeSource = await fs.readFile(path.join(projectRoot, "src/client/runtime.js"), "utf8");
  chunks.push(`// src/client/runtime.js\n${stripBrowserModuleSyntax(runtimeSource).trim()}\n`);
  return `${chunks.join("\n")}\n`;
}

function stripBrowserModuleSyntax(content) {
  return content
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import .*?;\r?\n/gm, "")
    .replace(/^export async function /gm, "async function ")
    .replace(/^export function /gm, "function ")
    .replace(/^export const /gm, "const ")
    .replace(/^export let /gm, "let ")
    .replace(/^export var /gm, "var ")
    .replace(/^export class /gm, "class ")
    .replace(/^export \{[^}]*\};?\r?\n/gm, "");
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
