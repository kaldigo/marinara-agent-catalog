import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedRoot = path.resolve(__dirname, "..");
const factoryEntry = path.join(sharedRoot, "src", "al-dente-factory", "index.js");

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    throw new Error(`Unsupported shared factory import "${specifier}" in ${fromFile}`);
  }
  return path.resolve(path.dirname(fromFile), specifier);
}

function stripModuleSyntax(source) {
  return source
    .replace(/^\s*import\s+\{[^}]+\}\s+from\s+["'][^"']+["'];\s*$/gm, "")
    .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, "$1 ")
    .replace(/^\s*export\s+\{[^}]+\};?\s*$/gm, "");
}

async function collectModules(filePath, seen = new Set(), output = []) {
  const normalized = path.normalize(filePath);
  if (seen.has(normalized)) return output;
  seen.add(normalized);

  const source = await fs.readFile(normalized, "utf8");
  const importPattern = /^\s*import\s+\{[^}]+\}\s+from\s+["']([^"']+)["'];\s*$/gm;
  const imports = [];
  let match;
  while ((match = importPattern.exec(source))) {
    imports.push(resolveImport(normalized, match[1]));
  }

  for (const imported of imports) {
    await collectModules(imported, seen, output);
  }

  output.push({
    filePath: normalized,
    source: stripModuleSyntax(source).trim(),
  });
  return output;
}

function indent(source) {
  return source
    .split("\n")
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n");
}

export async function buildAlDenteFactorySource() {
  const modules = await collectModules(factoryEntry);
  const body = modules
    .map((module) => {
      const relativePath = path.relative(sharedRoot, module.filePath).replaceAll(path.sep, "/");
      return `// ${relativePath}\n${module.source}`;
    })
    .join("\n\n");

  return `(() => {\n  "use strict";\n\n${indent(body)}\n})();\n`;
}
