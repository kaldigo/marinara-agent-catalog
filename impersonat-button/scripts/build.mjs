import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAlDenteFactorySource } from "../../_shared/scripts/build-al-dente-factory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const packageDir = path.join(distRoot, "Marinara-Impersonate-Button");
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
  const packageVersion = normalizeVersion(readArg("version", process.env.MIB_VERSION || pkg.version));
  const sharedJs = await buildAlDenteFactorySource();
  const mainJs = await fs.readFile(path.join(projectRoot, "src", "main.js"), "utf8");
  const js = `${sharedJs}\n\n${mainJs}`;
  const css = await fs.readFile(path.join(projectRoot, "src", "styles", "impersonate-button.css"), "utf8");
  const jsBytes = Buffer.byteLength(js, "utf8");

  if (jsBytes > jsLimitBytes) {
    throw new Error(`Built JS is ${jsBytes} bytes, exceeding Marinara's ${jsLimitBytes} byte extension limit.`);
  }

  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  const manifest = {
    kind: "marinara.extension",
    version: 14,
    config: {
      name: "Impersonate Button",
      description:
        "Adds a scoped dry-run impersonate button with continue, restore, stop, settings sync, and external-generation disabled state.",
      enabled: true,
      cssPath: "impersonate-button.css",
      jsPath: "impersonate-button.js",
    },
  };

  await fs.writeFile(path.join(packageDir, "impersonate-button.js"), js);
  await fs.writeFile(path.join(packageDir, "impersonate-button.css"), css);
  await writeJson(path.join(packageDir, "manifest.json"), manifest);

  const importJson = {
    kind: "marinara.extension",
    version: manifest.version,
    config: {
      name: manifest.config.name,
      description: manifest.config.description,
      enabled: manifest.config.enabled,
      css,
      js,
    },
  };
  await writeJson(path.join(distRoot, "impersonate-button.json"), importJson);

  console.log(`Built Marinara Impersonate Button ${packageVersion}`);
  console.log(`JS: ${jsBytes} bytes / ${jsLimitBytes}`);
  console.log(`Output: ${path.relative(projectRoot, distRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
