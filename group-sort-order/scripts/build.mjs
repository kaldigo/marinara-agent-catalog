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

await copyTree(path.join(projectRoot, "src/shared"), path.join(packageRoot, "src/shared"));
await copyTree(path.join(projectRoot, "src/server"), path.join(packageRoot, "src/server"), rewriteSourceImports);
await fs.mkdir(path.join(packageRoot, "bridge-sdk"), { recursive: true });
for (const file of ["contracts.js", "server.js"]) {
  await fs.copyFile(path.join(sdkRoot, file), path.join(packageRoot, "bridge-sdk", file));
}
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

await writeFile(path.join(packageRoot, "server.mjs"), `export { activate, selfCheck } from "./src/server/index.js";\n`);
await writeFile(path.join(packageRoot, "agents.json"), `${JSON.stringify(agentDefinitions(), null, 2)}\n`);
await writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);

console.log(`Built Group Sort Order prepared package: ${path.relative(projectRoot, packageRoot)}`);

function manifest() {
  return {
    schemaVersion: 1,
    id: "group-sort-order",
    name: "Group Sort Order",
    version,
    description: "Tracks the next roleplay participant across turns using native prompt, generation, and composer hooks.",
    engine: { min: "2.4.4", maxExclusive: "2.4.5" },
    kind: ["agent"],
    entrypoints: {
      server: "server.mjs",
      agents: "agents.json"
    },
    files: [
      { path: "server.mjs", sha256: "0".repeat(64), bytes: 0 },
      { path: "agents.json", sha256: "0".repeat(64), bytes: 0 }
    ],
    permissions: ["agent-runtime", "chat-read", "chat-write", "prompt-context"],
    restartRequired: true
  };
}

function agentDefinitions() {
  return [
    {
      id: "group-sort-order",
      name: "Group Sort Order",
      description: "Tracks the next character or persona, displays the handoff above the composer, and provides a fallback selector when the main response omits it.",
      category: "misc",
      phase: "pre_generation",
      enabledByDefault: false,
      runtimeDisabled: true,
      modeAllowlist: ["roleplay", "visual_novel"],
      defaultTools: [],
      defaultSettings: {
        maxTokens: 128,
        temperature: 0.2,
        selectorPrompt: [
          "You are a hidden next-participant selector for a roleplay group chat.",
          "Choose exactly one supplied candidate to speak next using the current scene, relevance, personality, talkativeness, and who spoke recently.",
          "Never choose the participant who just spoke.",
          "Return ONLY a valid JSON array containing one candidate ID, such as [\"candidate-id\"]. No prose or markdown."
        ].join("\n")
      },
      defaultPromptTemplate: [
        "At the very end of your response, choose exactly one participant who should speak next in this roleplay group chat.",
        "Choose from the supplied candidates using the current scene, relevance, personality, and who has spoken recently.",
        "Never choose the participant who is currently responding.",
        "Candidates:",
        "{{candidates}}",
        "Append exactly one terminal marker after the response text:",
        "{{marker}}",
        "Put only the selected candidate ID inside the marker. Do not add prose, JSON, or markdown after it."
      ].join("\n")
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

function rewriteSourceImports(content) {
  return content.replaceAll("../../../_mari-bridge/sdk/", "../../bridge-sdk/");
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
