import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageRoot = path.join(distRoot, "package");
const bridgeRoot = path.resolve(projectRoot, "..", "_mari-bridge", "src");
const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));

const bridgeSources = [
  "composer-dom.js",
  "generation-stream.js",
  "ui-slots.js",
  "generation-lifecycle.js",
  "fetch-intercept.js",
];
const clientSources = [
  "constants.js",
  "styles.js",
  "icons.js",
  "api.js",
  "prompts.js",
  "regex.js",
  "generation.js",
  "runtime.js",
];

if (!existsSync(bridgeRoot)) {
  throw new Error("Missing shared root: _mari-bridge");
}

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });

await fs.writeFile(path.join(packageRoot, "client.js"), await buildClientSource());
await fs.writeFile(path.join(packageRoot, "agents.json"), `${JSON.stringify(agentDefinitions(), null, 2)}\n`);
await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

console.log(`Built Impersonate Button prepared package: ${path.relative(projectRoot, packageRoot)}`);

async function buildClientSource() {
  const chunks = [];
  for (const file of bridgeSources) {
    const source = await fs.readFile(path.join(bridgeRoot, file), "utf8");
    chunks.push(`// bridge/${file}\n${stripExports(source).trim()}\n`);
  }
  for (const file of clientSources) {
    const source = await fs.readFile(path.join(projectRoot, "src", "client", file), "utf8");
    chunks.push(`// src/client/${file}\n${stripExports(source).trim()}\n`);
  }

  return [
    "(() => {",
    "  \"use strict\";",
    indent(chunks.join("\n")),
    "  startImpersonateButtonPackage();",
    "})();",
    "",
  ].join("\n");
}

function stripExports(source) {
  return source
    .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];\r?\n/gm, "")
    .replace(/^import .*?;\r?\n/gm, "")
    .replace(/^export\s+/gm, "");
}

function manifest() {
  return {
    schemaVersion: 1,
    id: "impersonate-button",
    name: "Impersonate Button",
    version: pkg.version,
    description: "Adds package-era composer quick actions for dry-run persona generation helpers.",
    engine: { min: "2.3.3", maxExclusive: "3.0.0" },
    kind: ["agent"],
    entrypoints: {
      client: "client.js",
      agents: "agents.json",
    },
    files: [{ path: "client.js", sha256: "0".repeat(64), bytes: 0 }],
    permissions: ["chat-read", "chat-write", "network", "storage", "ui"],
    restartRequired: false,
  };
}

function agentDefinitions() {
  return [
    {
      id: "impersonate-button",
      name: "Impersonate Button",
      description: "Feature marker for package-era dry-run persona generation composer actions.",
      category: "misc",
      phase: "pre_generation",
      execution: "feature",
      enabledByDefault: false,
      libraryHidden: true,
      runtimeDisabled: true,
      modeAllowlist: ["roleplay", "visual_novel"],
      defaultTools: [],
      defaultSettings: {},
      defaultPromptTemplate: "",
    },
  ];
}

function indent(content) {
  return content
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}
