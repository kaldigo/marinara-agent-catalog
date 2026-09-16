// A disposable official-image harness, separate from the leased local instance.
// No package archives or published artifacts are created here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf("=");
  return [value.slice(0, index), value.slice(index + 1)];
}));
assert.ok(args["--previous"], "--previous must point to the released 1.0.42 package source");
const packagesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.resolve(args["--output"] || "bootstrap-evidence");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-docker-"));
const image = "ghcr.io/pasta-devs/marinara-engine:2.4.6";
const version = JSON.parse(await fs.readFile(path.join(packagesRoot, "mari-bridge/package.json"))).version;
const ids = ["mari-bridge", "mari-bridge-smoke", "better-impersonate", "gm-notes", "group-sort-order", "presence", "pwa-helper", "tracker-profile-details", "unified-tracker", "world-map-background"];
const checks = [];
const active = new Set();
const docker = (...values) => execFileSync("docker", values, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600_000 }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await fs.mkdir(output, { recursive: true });

async function install(data) {
  const registry = { schemaVersion: 1, packages: [] };
  for (const id of ids) {
    const source = path.join(packagesRoot, id, "dist/package");
    const manifest = JSON.parse(await fs.readFile(path.join(source, "manifest.json")));
    const target = path.join(data, "capability-packages/versions", id, manifest.version);
    await fs.cp(source, target, { recursive: true });
    manifest.files = [];
    async function walk(relative = "") {
      for (const entry of await fs.readdir(path.join(target, relative), { withFileTypes: true })) {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (child !== "manifest.json") {
          const bytes = await fs.readFile(path.join(target, child));
          manifest.files.push({ path: child.split(path.sep).join("/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
        }
      }
    }
    await walk();
    await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify(manifest));
    // Match the native installer: only server entrypoints await runtime selfCheck.
    registry.packages.push({ id, version: manifest.version, manifest, installedAt: new Date().toISOString(), status: "active", readiness: manifest.entrypoints.server ? "pending" : "ready", error: null, readinessError: null, legacy: false });
  }
  await fs.writeFile(path.join(data, "capability-packages/installed.json"), JSON.stringify(registry));
}

async function start(name, data, command = [], environment = []) {
  docker("run", "--detach", "--name", name, "--init", "--restart", "unless-stopped",
    "--publish", "127.0.0.1::7860", "--mount", `type=bind,src=${data},dst=/app/data`,
    "--env", "ADMIN_SECRET=bridge-bootstrap-fixture", "--env", "MARINARA_ENV_WATCH=0", "--env", "LOG_LEVEL=info",
    "--env", "AUTO_CREATE_DEFAULT_CONNECTION=false", ...environment, image, ...command);
  active.add(name);
  const port = JSON.parse(docker("inspect", name))[0].NetworkSettings.Ports["7860/tcp"][0].HostPort;
  return `http://127.0.0.1:${port}`;
}

async function api(base, route, body) {
  const response = await fetch(base + route, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(5000),
    headers: { "content-type": "application/json", "x-admin-secret": "bridge-bootstrap-fixture", "x-marinara-csrf": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${route}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}

async function ready(base) {
  const deadline = Date.now() + 120_000;
  let last;
  while (Date.now() < deadline) {
    try {
      const health = await api(base, "/api/mari-bridge/health");
      assert.equal(health.status, "ready");
      assert.equal(health.implementationVersion, version);
      assert.equal(health.patches.find(patch => patch.id === "engine.version")?.status, "applied");
      assert.deepEqual(health.patches.filter(patch => patch.status === "failed"), []);
      return health;
    } catch (error) { last = error; }
    await delay(1000);
  }
  throw new Error("Docker Bridge did not become ready", { cause: last });
}

async function stop(name) {
  await fs.writeFile(path.join(output, name + ".log"), docker("logs", name));
  docker("rm", "--force", name);
  active.delete(name);
}

try {
  docker("pull", image);
  const layout = JSON.parse(docker("run", "--rm", "--entrypoint", "node", image, "-e",
    "const fs=require('fs'); console.log(JSON.stringify({version:require('/app/package.json').version,supervisor:fs.existsSync('/app/scripts/run-server.mjs'),entrypoint:fs.existsSync('/usr/local/bin/marinara-docker-entrypoint.mjs')}))"));
  assert.deepEqual(layout, { version: "2.4.6", supervisor: false, entrypoint: true });
  checks.push("Official image has the Docker entrypoint and no run-server.mjs");

  const firstData = path.join(root, "first");
  await install(firstData);
  let name = `bridge-first-${process.pid}`;
  let base = await start(name, firstData);
  await ready(base);
  const installed = JSON.parse(docker("exec", name, "node", "-e", "console.log(require('fs').readFileSync('/app/data/capability-packages/installed.json','utf8'))"));
  for (const id of ids) assert.equal(installed.packages.find(item => item.id === id)?.readiness, "ready", id);
  checks.push("Unconfigured first startup activates Bridge and its server consumers; all installed package records become ready");
  const chat = await api(base, "/api/chats", { name: "Docker restart persistence", mode: "roleplay", characterIds: [] });
  await delay(11_000);
  const restartCount = JSON.parse(docker("inspect", name))[0].RestartCount;
  await api(base, "/api/admin/restart", { confirm: true });
  const restartDeadline = Date.now() + 60_000;
  while (JSON.parse(docker("inspect", name))[0].RestartCount <= restartCount) {
    assert.ok(Date.now() < restartDeadline, "Native restart did not restart the container");
    await delay(1000);
  }
  await ready(base);
  assert.equal((await api(base, `/api/chats/${chat.id}`)).name, "Docker restart persistence");
  checks.push("Native admin restart restarts the container, restores Bridge and preserves persisted chat data");
  await stop(name);

  name = `bridge-preloaded-${process.pid}`;
  base = await start(name, firstData, [], ["--env", "NODE_OPTIONS=--import=/app/data/mari-bridge/bootstrap/register.mjs"]);
  await ready(base);
  checks.push("Cold startup with NODE_OPTIONS skips the Docker entrypoint and loads the server preload");
  await stop(name);

  const upgradeData = path.join(root, "upgrade");
  await install(upgradeData);
  for (const folder of ["bootstrap", "src"]) {
    await fs.cp(path.resolve(args["--previous"], folder), path.join(upgradeData, "mari-bridge", folder), { recursive: true });
  }
  name = `bridge-upgrade-${process.pid}`;
  base = await start(name, upgradeData, ["node", "--import=/app/data/mari-bridge/bootstrap/register.mjs", "packages/server/dist/index.js"]);
  await ready(base);
  assert.match(docker("logs", name), /restart=version-handoff/);
  checks.push("A running 1.0.42 preload upgrades to the patched version through direct Docker process replacement");
  await stop(name);
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ image, version, checks, status: "passed" }, null, 2) + "\n");
  console.log(JSON.stringify({ image, version, checks }, null, 2));
} finally {
  for (const name of active) {
    try { await stop(name); } catch (error) { console.error(error); }
  }
  // The container owns these disposable files as its runtime user. Remove them
  // through that image rather than touching unrelated host data with privileges.
  docker("run", "--rm", "--user", "root", "--entrypoint", "node", "--mount", `type=bind,src=${root},dst=/fixture`, image, "-e",
    "for(const p of require('fs').readdirSync('/fixture'))require('fs').rmSync('/fixture/'+p,{recursive:true,force:true})");
  await fs.rm(root, { recursive: true, force: true });
}
