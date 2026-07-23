#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const upstreamRepository =
  process.env.UPSTREAM_REPOSITORY || "https://github.com/Pasta-Devs/Marinara-Agents.git";
const upstreamRef = process.env.UPSTREAM_REF || "";
const agentsBranch = process.env.AGENTS_BRANCH || "origin/agents";
const packagesBranch = process.env.PACKAGES_BRANCH || "origin/packages";
const repository = process.env.CATALOG_REPOSITORY || process.env.GITHUB_REPOSITORY || "OWNER/REPO";
const workDir = path.join(root, ".catalog-merge-work");
const upstreamDir = path.join(workDir, "upstream");
const agentsDir = path.join(workDir, "agents");
const packagesDir = path.join(workDir, "packages");
const nextDir = path.join(workDir, "next");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    input: options.input,
    maxBuffer: 512 * 1024 * 1024,
    shell: options.shell || false,
    stdio: options.input ? ["pipe", "pipe", "pipe"] : "pipe",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    const stdout = result.stdout?.toString().trim();
    throw new Error(
      `${command} ${args.join(" ")} failed` +
        (result.error ? `\nerror: ${result.error.message}` : "") +
        (stdout ? `\nstdout:\n${stdout}` : "") +
        (stderr ? `\nstderr:\n${stderr}` : ""),
    );
  }

  return result.stdout;
}

function extractRef(ref, destination) {
  mkdirSync(destination, { recursive: true });
  const archivePath = path.join(
    workDir,
    `${ref.replace(/[^a-z0-9_-]+/gi, "-") || "branch"}.tar`,
  );
  rmSync(archivePath, { force: true });
  run("git", ["archive", "--format=tar", "--output", archivePath, ref]);
  run("tar", ["-xf", archivePath, "-C", destination]);
  rmSync(archivePath, { force: true });
}

function ensureRemote(name, url) {
  const existing = spawnSync("git", ["remote", "get-url", name], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (existing.status !== 0) {
    run("git", ["remote", "add", name, url]);
    return;
  }

  const existingUrl = existing.stdout.toString().trim();
  if (existingUrl !== url) {
    run("git", ["remote", "set-url", name, url]);
  }
}

function fetchOfficialUpstream() {
  const ref = "refs/remotes/marinara/main";
  ensureRemote("marinara", upstreamRepository);
  run("git", ["fetch", "--depth=1", "marinara", `main:${ref}`]);
  return ref;
}

function refExists(ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

function resolveRef(ref) {
  if (refExists(ref)) {
    return ref;
  }

  if (ref.startsWith("origin/")) {
    const localBranch = ref.slice("origin/".length);
    if (refExists(localBranch)) {
      return localBranch;
    }
  }

  return ref;
}

function copyIfExists(from, to) {
  if (!existsSync(from)) {
    return;
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function bytes(file) {
  return statSync(file).size;
}

function platformBuildCommand(command, args) {
  if (process.platform === "win32" && command === "npm") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "npm", ...args] };
  }

  return { command, args };
}

function powershellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function legacyBridgeSource() {
  return String.raw`
function defineCapabilityElement(tagName) {
  if (customElements.get(tagName)) return;
  customElements.define(tagName, class extends HTMLElement {
    connectedCallback() {
      this.hidden = true;
      this.setAttribute("aria-hidden", "true");
    }
  });
}

function ensureLegacyMarinaraBridge() {
  const existing = window.__marinaraLegacyCapabilityBridge;
  if (existing?.api) {
    if (!window.marinara) window.marinara = existing.api;
    return existing;
  }

  const runtime = {
    cleanupStack: [],
    globalCleanups: [],
    styles: new Map(),
  };

  function activeCleanups() {
    return runtime.cleanupStack[runtime.cleanupStack.length - 1] || runtime.globalCleanups;
  }

  function track(cleanup) {
    activeCleanups().push(cleanup);
    return cleanup;
  }

  function normalizeApiPath(path) {
    const value = String(path || "");
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/api/") || value === "/api") return value;
    return "/api" + (value.startsWith("/") ? value : "/" + value);
  }

  const api = {
    on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      track(() => target.removeEventListener(type, handler, options));
    },
    onCleanup(cleanup) {
      if (typeof cleanup === "function") track(cleanup);
    },
    observe(target, callback, options) {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      track(() => observer.disconnect());
      return observer;
    },
    setTimeout(handler, timeout, ...args) {
      const id = window.setTimeout(handler, timeout, ...args);
      track(() => window.clearTimeout(id));
      return id;
    },
    setInterval(handler, timeout, ...args) {
      const id = window.setInterval(handler, timeout, ...args);
      track(() => window.clearInterval(id));
      return id;
    },
    addStyle(css) {
      const key = createStyleKey(css);
      let record = runtime.styles.get(key);
      if (!record) {
        const style = document.createElement("style");
        style.textContent = css;
        style.dataset.marinaraLegacyCapabilityStyle = key;
        document.head.appendChild(style);
        record = { style, refs: 0 };
        runtime.styles.set(key, record);
      }
      record.refs += 1;
      track(() => {
        record.refs -= 1;
        if (record.refs <= 0) {
          record.style.remove();
          runtime.styles.delete(key);
        }
      });
      return record.style;
    },
    async apiFetch(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (typeof options.body === "string" && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const response = await fetch(normalizeApiPath(path), {
        cache: "no-store",
        ...options,
        headers,
      });
      if (response.status === 204) return {};
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const error = new Error(data?.error || response.status + " " + response.statusText);
        error.status = response.status;
        error.body = data;
        throw error;
      }
      return data;
    },
  };

  function createStyleKey(css) {
    let hash = 0;
    for (let index = 0; index < css.length; index += 1) {
      hash = (hash * 31 + css.charCodeAt(index)) >>> 0;
    }
    return css.length + "-" + hash.toString(36);
  }

  runtime.api = api;
  runtime.withCleanups = (cleanups, callback) => {
    runtime.cleanupStack.push(cleanups);
    try {
      return callback();
    } finally {
      runtime.cleanupStack.pop();
    }
  };
  window.__marinaraLegacyCapabilityBridge = runtime;
  if (!window.marinara) window.marinara = api;
  return runtime;
}
`;
}

function wrapLegacyExtensionClient({ id, legacyJs, css }) {
  const tagName = `marinara-capability-${id}`;
  return `// Generated from packages branch source by the catalog rebuild workflow.
const PACKAGE_ID = ${JSON.stringify(id)};
const TAG_NAME = ${JSON.stringify(tagName)};
const LEGACY_CSS = ${JSON.stringify(css || "")};

${legacyBridgeSource()}

defineCapabilityElement(TAG_NAME);

const installedPorts = window.__marinaraLegacyCapabilityPorts || {};
window.__marinaraLegacyCapabilityPorts = installedPorts;

if (!installedPorts[PACKAGE_ID]) {
  const bridge = ensureLegacyMarinaraBridge();
  const cleanups = [];
  const port = {
    cleanups,
    uninstall() {
      while (cleanups.length) {
        const cleanup = cleanups.pop();
        try {
          cleanup?.();
        } catch (error) {
          console.warn("[Marinara legacy capability]", PACKAGE_ID, "cleanup failed", error);
        }
      }
      if (installedPorts[PACKAGE_ID] === port) delete installedPorts[PACKAGE_ID];
    },
  };
  installedPorts[PACKAGE_ID] = port;
  bridge.withCleanups(cleanups, () => {
    if (LEGACY_CSS) bridge.api.addStyle(LEGACY_CSS);

${legacyJs}
  });
}
`;
}

function walkFiles(directory, callback) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, callback);
      continue;
    }
    callback(absolutePath);
  }
}

function findLegacyManifest(extensionDir) {
  const distDir = path.join(extensionDir, "dist");
  let match = null;
  if (!existsSync(distDir)) {
    throw new Error(`Extension build did not create dist/: ${extensionDir}`);
  }

  walkFiles(distDir, (file) => {
    if (match || path.basename(file) !== "manifest.json") {
      return;
    }
    const manifest = readJson(file);
    if (manifest.kind === "marinara.extension" && manifest.config?.jsPath) {
      match = { file, manifest };
    }
  });

  if (!match) {
    throw new Error(`No legacy Marinara extension manifest found in ${distDir}`);
  }

  return match;
}

function isSourceFolder(entry) {
  return entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_");
}

function sourceMetadata(sourceDir) {
  const metadataPath = path.join(sourceDir, "marinara-source.json");
  return existsSync(metadataPath) ? readJson(metadataPath) : null;
}

function validateSharedRoots(sourceName, metadata) {
  const sharedRoots = metadata.processing?.sharedRoots || [];
  if (!Array.isArray(sharedRoots)) {
    throw new Error(`${sourceName} processing.sharedRoots must be an array when provided`);
  }

  for (const sharedRoot of sharedRoots) {
    const name = String(sharedRoot || "");
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      throw new Error(`${sourceName} has invalid shared root name: ${JSON.stringify(sharedRoot)}`);
    }
    if (!name.startsWith("_")) {
      throw new Error(`${sourceName} shared root ${name} must be an underscore-prefixed root folder`);
    }
    if (!existsSync(path.join(packagesDir, name))) {
      throw new Error(`${sourceName} requires missing shared root ${name}`);
    }
  }
}

function buildPackageSourceFolders() {
  if (!existsSync(packagesDir)) {
    return;
  }

  const customPackagesDir = path.join(nextDir, "custom-packages");
  mkdirSync(customPackagesDir, { recursive: true });

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!isSourceFolder(entry)) {
      continue;
    }

    const extensionDir = path.join(packagesDir, entry.name);
    const metadata = sourceMetadata(extensionDir);
    if (!metadata || metadata.includeInMain === false || metadata.type !== "capability-package") {
      continue;
    }
    validateSharedRoots(entry.name, metadata);

    if (metadata.processing?.kind !== "legacy-extension") {
      throw new Error(`${entry.name} has unsupported package processing kind: ${metadata.processing?.kind}`);
    }

    const packageJsonPath = path.join(extensionDir, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error(`${entry.name} package source is missing package.json`);
    }

    const buildCommand = metadata.processing.buildCommand || ["npm", "run", "build"];
    if (!Array.isArray(buildCommand) || buildCommand.length === 0) {
      throw new Error(`${entry.name} buildCommand must be a non-empty array`);
    }

    const build = platformBuildCommand(String(buildCommand[0]), buildCommand.slice(1).map(String));
    run(build.command, build.args, { cwd: extensionDir });

    const packageJson = readJson(packageJsonPath);
    const capability = metadata.package || {};
    if (!capability.id) {
      throw new Error(`${entry.name} package metadata is missing package.id`);
    }
    const legacy = findLegacyManifest(extensionDir);
    const legacyDir = path.dirname(legacy.file);
    const legacyConfig = legacy.manifest.config || {};
    const legacyJsPath = path.join(legacyDir, legacyConfig.jsPath);
    const legacyCssPath = legacyConfig.cssPath ? path.join(legacyDir, legacyConfig.cssPath) : null;
    const legacyJs = readFileSync(legacyJsPath, "utf8");
    const css = legacyCssPath && existsSync(legacyCssPath) ? readFileSync(legacyCssPath, "utf8") : "";

    const packageDir = path.join(customPackagesDir, capability.id);
    rmSync(packageDir, { recursive: true, force: true });
    mkdirSync(packageDir, { recursive: true });

    const clientPath = path.join(packageDir, "client.js");
    writeFileSync(
      clientPath,
      wrapLegacyExtensionClient({ id: capability.id, legacyJs, css }),
    );

    const readmePath = path.join(extensionDir, "README.md");
    if (existsSync(readmePath)) {
      cpSync(readmePath, path.join(packageDir, "README.md"));
    } else {
      writeFileSync(
        path.join(packageDir, "README.md"),
        `# ${legacyConfig.name || capability.id}\n\n${legacyConfig.description || ""}\n`,
      );
    }

    const manifest = {
      schemaVersion: 1,
      id: capability.id,
      name: capability.name || legacyConfig.name || capability.id,
      version: String(capability.version || packageJson.version || "0.0.0"),
      description: capability.description || legacyConfig.description || "",
      engine: capability.engine || { min: "2.3.0", maxExclusive: "3.0.0" },
      kind: capability.kind || ["agent"],
      entrypoints: capability.entrypoints || { client: "client.js" },
      files: [
        {
          path: "client.js",
          sha256: sha256(clientPath),
          bytes: bytes(clientPath),
        },
      ],
      permissions: Array.from(new Set(capability.permissions || ["ui"])).sort(),
      restartRequired: Boolean(capability.restartRequired),
    };

    writeJson(path.join(packageDir, "manifest.json"), manifest);
    console.log(`Built package ${entry.name} -> custom-packages/${capability.id}`);
  }
}

function buildCustomAgentsFile() {
  if (!existsSync(agentsDir)) {
    return 0;
  }

  const definitions = [];
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!isSourceFolder(entry)) {
      continue;
    }

    const sourceDir = path.join(agentsDir, entry.name);
    const metadata = sourceMetadata(sourceDir);
    if (!metadata || metadata.includeInMain === false || metadata.type !== "custom-agents") {
      continue;
    }

    const agentsFile = metadata.processing?.agentsFile || "agents.json";
    const definitionsPath = path.join(sourceDir, agentsFile);
    if (!existsSync(definitionsPath)) {
      throw new Error(`${entry.name} custom agent source is missing ${agentsFile}`);
    }

    const sourceDefinitions = readJson(definitionsPath);
    if (!Array.isArray(sourceDefinitions)) {
      throw new Error(`${entry.name}/${agentsFile} must contain an array`);
    }

    for (const definition of sourceDefinitions) {
      if (definition?.execution === "feature") {
        throw new Error(`Custom agent ${definition.id || "<unknown>"} requires a package runtime; move it to packages`);
      }
      definitions.push(definition);
    }
  }

  const seen = new Set();
  for (const definition of definitions) {
    if (!definition?.id) {
      throw new Error("Custom agent definition is missing id");
    }
    if (seen.has(definition.id)) {
      throw new Error(`Duplicate custom agent id ${definition.id}`);
    }
    seen.add(definition.id);
  }

  if (definitions.length > 0) {
    writeJson(path.join(nextDir, "agents.json"), definitions);
  }

  return definitions.length;
}

function listPackageFiles(packageDir) {
  const files = [];

  function walk(relativeDir) {
    const absoluteDir = path.join(packageDir, relativeDir);
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const relativePath = path.posix.join(
        relativeDir.split(path.sep).join(path.posix.sep),
        entry.name,
      );
      const absolutePath = path.join(packageDir, relativePath);

      if (entry.isDirectory()) {
        walk(relativePath);
        continue;
      }

      if (entry.name === "manifest.json" || entry.name.toLowerCase() === "readme.md") {
        continue;
      }

      files.push(relativePath);
    }
  }

  walk("");
  return files.sort();
}

function zipPackage(packageDir, manifest, packageFiles) {
  const artifactName = `${manifest.id}-${manifest.version}.zip`;
  const artifactPath = path.join(nextDir, "artifacts", artifactName);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  rmSync(artifactPath, { force: true });

  const files = ["manifest.json", ...packageFiles];
  if (process.platform === "win32") {
    const fileArray = files.map(powershellString).join(", ");
    const script = `
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artifact = ${powershellString(artifactPath)}
$files = @(${fileArray})
$zip = [System.IO.Compression.ZipFile]::Open($artifact, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $source = Join-Path (Get-Location) $file
    $entry = $file -replace '\\\\', '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
`;
    run("powershell", ["-NoProfile", "-Command", script], { cwd: packageDir });
  } else {
    run("zip", ["-X", "-q", artifactPath, ...files], {
      cwd: packageDir,
    });
  }

  return {
    url: `https://raw.githubusercontent.com/${repository}/main/artifacts/${artifactName}`,
    sha256: sha256(artifactPath),
    bytes: bytes(artifactPath),
  };
}

function parseVersion(version) {
  return String(version || "0.0.0")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

function supportsLane(manifest, major) {
  if (!major) {
    return true;
  }

  const min = manifest.engine?.min || "0.0.0";
  const maxExclusive = manifest.engine?.maxExclusive || "999.0.0";
  return compareVersions(min, `${major + 1}.0.0`) < 0 && compareVersions(maxExclusive, `${major}.0.0`) > 0;
}

function catalogOverride(id) {
  const overridePath = path.join(nextDir, "catalog-overrides", `${id}.json`);
  return existsSync(overridePath) ? readJson(overridePath) : {};
}

function customIconUrl(id, override) {
  if (override.iconUrl) {
    return override.iconUrl;
  }

  const png = path.join(nextDir, "artwork", "agent-covers", `${id}.png`);
  if (existsSync(png)) {
    return `https://raw.githubusercontent.com/${repository}/main/artwork/agent-covers/${id}.png`;
  }

  return undefined;
}

function buildCustomEntries() {
  const packagesDir = path.join(nextDir, "custom-packages");
  if (!existsSync(packagesDir)) {
    return [];
  }

  const entries = [];
  for (const directory of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!directory.isDirectory()) {
      continue;
    }

    const packageDir = path.join(packagesDir, directory.name);
    const manifestPath = path.join(packageDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = readJson(manifestPath);
    const packageFiles = listPackageFiles(packageDir);
    manifest.files = packageFiles.map((file) => ({
      path: file,
      sha256: sha256(path.join(packageDir, file)),
      bytes: bytes(path.join(packageDir, file)),
    }));
    writeJson(manifestPath, manifest);

    const agentsPath = manifest.entrypoints?.agents
      ? path.join(packageDir, manifest.entrypoints.agents)
      : null;
    const agents = agentsPath && existsSync(agentsPath) ? readJson(agentsPath) : [];
    const firstAgent = Array.isArray(agents) ? agents[0] : undefined;
    const override = catalogOverride(manifest.id);
    const iconUrl = customIconUrl(manifest.id, override);

    entries.push({
      manifest,
      category: override.category || firstAgent?.category || "misc",
      ...(iconUrl ? { iconUrl } : {}),
      artifact: zipPackage(packageDir, manifest, packageFiles),
      documentationUrl:
        override.documentationUrl ||
        `https://github.com/${repository}#${manifest.id}`,
    });
  }

  return entries.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

function mergeCatalog(file, customEntries, major) {
  if (!existsSync(file)) {
    return;
  }

  const catalog = readJson(file);
  const compatibleEntries = customEntries.filter((entry) => supportsLane(entry.manifest, major));
  if (compatibleEntries.length === 0) {
    return;
  }

  const byId = new Map();
  for (const entry of catalog.packages || []) {
    byId.set(entry.manifest.id, entry);
  }
  for (const entry of compatibleEntries) {
    byId.set(entry.manifest.id, entry);
  }

  const officialOrder = (catalog.packages || []).map((entry) => entry.manifest.id);
  const customOnly = compatibleEntries
    .map((entry) => entry.manifest.id)
    .filter((id) => !officialOrder.includes(id));

  catalog.generatedAt = new Date().toISOString();
  catalog.packages = [...officialOrder, ...customOnly].map((id) => byId.get(id));
  writeJson(file, catalog);
}

function replaceWorkingTree() {
  for (const entry of readdirSync(root)) {
    if (entry === ".git" || entry === path.basename(workDir)) {
      continue;
    }
    rmSync(path.join(root, entry), { recursive: true, force: true });
  }

  for (const entry of readdirSync(nextDir)) {
    cpSync(path.join(nextDir, entry), path.join(root, entry), { recursive: true });
  }
}

function writeUpstreamMetadata(ref) {
  const commit = run("git", ["rev-parse", `${ref}^{commit}`]).toString().trim();
  writeJson(path.join(nextDir, "UPSTREAM-MARINARA-AGENTS.json"), {
    repository: "Pasta-Devs/Marinara-Agents",
    url: upstreamRepository,
    branch: "main",
    ref,
    commit,
    syncedAt: new Date().toISOString(),
  });
}

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const resolvedUpstreamRef = upstreamRef ? resolveRef(upstreamRef) : fetchOfficialUpstream();
extractRef(resolvedUpstreamRef, upstreamDir);
extractRef(resolveRef(agentsBranch), agentsDir);
extractRef(resolveRef(packagesBranch), packagesDir);
cpSync(upstreamDir, nextDir, { recursive: true });
writeUpstreamMetadata(resolvedUpstreamRef);

copyIfExists(path.join(root, ".github"), path.join(nextDir, ".github"));
copyIfExists(path.join(root, "CUSTOM-CATALOG.md"), path.join(nextDir, "CUSTOM-CATALOG.md"));
copyIfExists(path.join(root, "PACKAGE-AGENT-SETUP.md"), path.join(nextDir, "PACKAGE-AGENT-SETUP.md"));
copyIfExists(path.join(packagesDir, "custom-packages"), path.join(nextDir, "custom-packages"));
copyIfExists(path.join(packagesDir, "custom-artifacts"), path.join(nextDir, "custom-artifacts"));
copyIfExists(path.join(packagesDir, "custom-artwork"), path.join(nextDir, "custom-artwork"));
copyIfExists(path.join(packagesDir, "catalog-overrides"), path.join(nextDir, "catalog-overrides"));
copyIfExists(path.join(agentsDir, "catalog-overrides"), path.join(nextDir, "catalog-overrides"));

buildPackageSourceFolders();
const customAgentCount = buildCustomAgentsFile();

copyIfExists(
  path.join(nextDir, "custom-artwork", "agent-covers"),
  path.join(nextDir, "artwork", "agent-covers"),
);

const customEntries = buildCustomEntries();
mergeCatalog(path.join(nextDir, "catalog", "catalog.json"), customEntries, undefined);
mergeCatalog(path.join(nextDir, "catalog", "v2", "catalog.json"), customEntries, 2);
mergeCatalog(path.join(nextDir, "catalog", "v3", "catalog.json"), customEntries, 3);

replaceWorkingTree();
rmSync(workDir, { recursive: true, force: true });

console.log(`Merged ${customEntries.length} custom package(s) into main catalog output.`);
console.log(`Generated ${customAgentCount} custom agent definition(s).`);
