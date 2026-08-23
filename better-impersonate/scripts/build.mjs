import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageRoot = path.join(distRoot, "package");
const sdkRoot = path.resolve(projectRoot, "..", "_mari-bridge", "sdk");
const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));

const sdkSources = ["contracts.js", "client.js"];
const clientSources = ["request.js", "runtime.js"];

if (!existsSync(sdkRoot)) {
  throw new Error("Missing shared root: _mari-bridge");
}

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(packageRoot, { recursive: true });

await fs.writeFile(path.join(packageRoot, "client.js"), await buildClientSource());
await fs.writeFile(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);
await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageRoot, "README.md"));

console.log(`Built Better Impersonate prepared package: ${path.relative(projectRoot, packageRoot)}`);

async function buildClientSource() {
  const chunks = [];
  for (const file of sdkSources) {
    const source = await fs.readFile(path.join(sdkRoot, file), "utf8");
    chunks.push(`// bridge-sdk/${file}\n${stripExports(source).trim()}\n`);
  }
  for (const file of clientSources) {
    const source = await fs.readFile(path.join(projectRoot, "src", "client", file), "utf8");
    chunks.push(`// src/client/${file}\n${stripExports(source).trim()}\n`);
  }

  return [
    "(async () => {",
    "  \"use strict\";",
    indent(chunks.join("\n")),
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
    id: "better-impersonate",
    name: "Better Impersonate",
    version: pkg.version,
    description: "Adds bridge-registered persona draft commands for use from system Quick Replies.",
    engine: { min: "2.4.3", maxExclusive: "2.4.4" },
    kind: ["agent"],
    entrypoints: {
      client: "client.js",
    },
    contributions: { slots: ["chat-runtime"] },
    files: [
      { path: "client.js", sha256: "0".repeat(64), bytes: 0 },
    ],
    permissions: ["storage", "ui"],
    restartRequired: false,
  };
}

function indent(content) {
  return content
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}
