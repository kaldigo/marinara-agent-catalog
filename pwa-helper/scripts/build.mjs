import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageRoot = path.join(distRoot, "package");
const sdkRoot = path.resolve(projectRoot, "..", "_mari-bridge", "sdk");

const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;

const clientSources = [
  "constants.js",
  "status.js",
  "wake-lock.js",
  "ios-icon.js",
  "generation-monitor.js",
  "runtime.js",
];

if (!existsSync(sdkRoot)) {
  throw new Error("Missing shared root: _mari-bridge");
}

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });

await fs.writeFile(path.join(packageRoot, "client.js"), await buildClientSource());
await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

console.log(`Built PWA Helper prepared package: ${path.relative(projectRoot, packageRoot)}`);

async function buildClientSource() {
  const chunks = [];
  for (const file of ["contracts.js", "client.js"]) {
    const sourcePath = path.join(sdkRoot, file);
    const source = stripBrowserModuleSyntax(await fs.readFile(sourcePath, "utf8"));
    chunks.push(`// bridge-sdk/${file}\n${source.trim()}\n`);
  }
  for (const file of clientSources) {
    const sourcePath = path.join(projectRoot, "src", "client", file);
    const source = stripBrowserModuleSyntax(await fs.readFile(sourcePath, "utf8"));
    chunks.push(`// src/client/${file}\n${source.trim()}\n`);
  }

  return [
    chunks.join("\n"),
    "const cleanupPwaHelperClient = await activateClientWithMariBridge(",
    "  {",
    '    consumerId: "pwa-helper",',
    "    api: { major: 1, minMinor: 0 },",
    '    require: ["client.bridge-first", "consumer.sessions", "generation.lifecycle", "runtime.health"],',
    "  },",
    "  async (bridgeSession) => {",
    "    startPwaHelper(bridgeSession);",
    "    return stopPwaHelper;",
    "  },",
    ");",
    "",
  ].join("\n");
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

function manifest() {
  return {
    schemaVersion: 1,
    id: "pwa-helper",
    name: "PWA Helper",
    version,
    description:
      "Keeps mobile and tablet screens awake while Marinara generation is running and improves iOS home-screen metadata.",
    engine: { min: "2.4.4", maxExclusive: "2.4.5" },
    kind: ["agent"],
    entrypoints: {
      client: "client.js",
    },
    contributions: { slots: ["chat-runtime"] },
    files: [
      { path: "client.js", sha256: "0".repeat(64), bytes: 0 },
    ],
    permissions: ["ui"],
    restartRequired: false,
  };
}
