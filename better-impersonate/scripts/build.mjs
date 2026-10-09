import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist/package");
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const source = JSON.parse(await fs.readFile(path.join(root, "marinara-source.json"), "utf8"));
await fs.mkdir(out, { recursive: true });
const names = ["thinking-tags.js", "recall.js", "request.js", "transport.js", "controller.js", "runtime.js"];
const chunks = await Promise.all(names.map(async name => "// " + name + "\n" +
  (await fs.readFile(path.join(root, "src/client", name), "utf8"))
    .replace(/^import .*?;\r?\n/gm, "").replace(/^export /gm, "")));
await fs.writeFile(path.join(out, "client.js"), '(() => {\n"use strict";\n' + chunks.join("\n") + "\n})();\n");
await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify({
  schemaVersion: 1, id: "better-impersonate", name: "Better Impersonate", version: pkg.version,
  description: pkg.description, engine: source.package.engine, kind: ["agent"],
  entrypoints: { client: "client.js" }, permissions: ["ui", "storage"], restartRequired: false,
  files: [{ path: "client.js", sha256: "0".repeat(64), bytes: 0 }],
}, null, 2) + "\n");
for (const file of ["README.md", "THIRD-PARTY.md", "LICENSE"]) await fs.copyFile(path.join(root, file), path.join(out, file));
console.log("Prepared Better Impersonate " + pkg.version + "; catalog workflow owns hashes and ZIPs.");
