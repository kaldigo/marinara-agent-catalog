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
const upstreamBranch = process.env.UPSTREAM_BRANCH || "origin/upstream-marinara";
const agentsBranch = process.env.AGENTS_BRANCH || "origin/agents";
const repository = process.env.CATALOG_REPOSITORY || process.env.GITHUB_REPOSITORY || "OWNER/REPO";
const workDir = path.join(root, ".catalog-merge-work");
const upstreamDir = path.join(workDir, "upstream");
const agentsDir = path.join(workDir, "agents");
const nextDir = path.join(workDir, "next");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    input: options.input,
    maxBuffer: 512 * 1024 * 1024,
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

  run("zip", ["-X", "-q", artifactPath, "manifest.json", ...packageFiles], {
    cwd: packageDir,
  });

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

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

extractRef(resolveRef(upstreamBranch), upstreamDir);
extractRef(resolveRef(agentsBranch), agentsDir);
cpSync(upstreamDir, nextDir, { recursive: true });

copyIfExists(path.join(root, ".github"), path.join(nextDir, ".github"));
copyIfExists(path.join(root, "CUSTOM-CATALOG.md"), path.join(nextDir, "CUSTOM-CATALOG.md"));
copyIfExists(path.join(agentsDir, "custom-packages"), path.join(nextDir, "custom-packages"));
copyIfExists(path.join(agentsDir, "custom-artifacts"), path.join(nextDir, "custom-artifacts"));
copyIfExists(path.join(agentsDir, "custom-artwork"), path.join(nextDir, "custom-artwork"));
copyIfExists(path.join(agentsDir, "catalog-overrides"), path.join(nextDir, "catalog-overrides"));

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
