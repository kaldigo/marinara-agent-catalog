import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAlDenteFactorySource } from "../../_shared/scripts/build-al-dente-factory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageDir = path.join(distRoot, "Marinara-PWA-Helper");
const jsLimitBytes = 1024 * 1024;

function readArg(name, fallback = "") {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "") || "0.0.0";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const pkg = await readJson(path.join(projectRoot, "package.json"));
  const packageVersion = normalizeVersion(readArg("version", process.env.MPH_VERSION || pkg.version));
  const shared = await buildAlDenteFactorySource();
  const main = await fs.readFile(path.join(projectRoot, "src", "main.js"), "utf8");
  const js = `${shared}\n\n${main}`;
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
      name: "PWA Helper",
      description: "Keeps mobile and tablet screens awake while Marinara generation is running.",
      enabled: true,
      jsPath: "pwa-helper.js",
    },
  };

  await fs.writeFile(path.join(packageDir, "pwa-helper.js"), js);
  await writeJson(path.join(packageDir, "manifest.json"), manifest);
  await fs.copyFile(path.join(projectRoot, "README.md"), path.join(packageDir, "README.md"));

  const importJson = {
    kind: "marinara.extension",
    version: manifest.version,
    config: {
      name: manifest.config.name,
      description: manifest.config.description,
      enabled: manifest.config.enabled,
      js,
    },
  };
  await writeJson(path.join(distRoot, "pwa-helper.json"), importJson);

  console.log(`Built PWA Helper ${packageVersion}`);
  console.log(`JS: ${jsBytes} bytes / ${jsLimitBytes}`);
  console.log(`Output: ${path.relative(projectRoot, distRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
