import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist/package");
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
if (manifest.version !== pkg.version) throw new Error("Package and manifest versions must match");
const names = (await fs.readdir(path.join(root, "src"))).filter(name => name.endsWith(".js")).sort();
const chunks = await Promise.all(names.map(async name => `// ${name}\n${await fs.readFile(path.join(root, "src", name), "utf8")}`));
const client = `// Quartermaster (Kaldigo) ${pkg.version}; see THIRD-PARTY.md\n(() => {\n"use strict";\n${chunks.join("\n")}\n})();\n`;
new vm.Script(client);
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, "client.js"), client);
await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const name of ["server.mjs", "agents.json", "icons", "locales", "LICENSE", "README.md", "THIRD-PARTY.md", "CHANGELOG.md", "UPSTREAM-README.md"]) {
  await fs.cp(path.join(root, name), path.join(out, name), { recursive: true });
}
console.log(`Prepared ${manifest.name} ${pkg.version}; catalog workflow owns hashes and ZIPs.`);
