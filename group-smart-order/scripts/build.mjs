import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAlDenteFactorySource } from "../../_shared/scripts/build-al-dente-factory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageDir = path.join(distRoot, "Group-Smart-Order");
const jsLimitBytes = 1024 * 1024;

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const sharedJs = await buildAlDenteFactorySource();
  const mainJs = await fs.readFile(path.join(projectRoot, "src", "main.js"), "utf8");
  const js = `${sharedJs}\n\n${mainJs}`;
  const jsBytes = Buffer.byteLength(js, "utf8");

  if (jsBytes > jsLimitBytes) {
    throw new Error(`Built JS is ${jsBytes} bytes, exceeding Marinara's ${jsLimitBytes} byte extension limit.`);
  }

  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  const manifest = {
    kind: "marinara.extension",
    version: 1,
    config: {
      name: "Group Smart Order",
      description: "Shows and directs a group Smart response queue with selectable main or agent selector connection.",
      enabled: true,
      jsPath: "group-smart-order.js",
    },
  };

  await fs.writeFile(path.join(packageDir, "group-smart-order.js"), js);
  await writeJson(path.join(packageDir, "manifest.json"), manifest);
  await writeJson(path.join(distRoot, "group-smart-order.json"), {
    kind: "marinara.extension",
    version: manifest.version,
    config: {
      name: manifest.config.name,
      description: manifest.config.description,
      enabled: manifest.config.enabled,
      js,
    },
  });

  console.log("Built Marinara Group Smart Order");
  console.log(`JS: ${jsBytes} bytes / ${jsLimitBytes}`);
  console.log(`Output: ${path.relative(projectRoot, distRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
