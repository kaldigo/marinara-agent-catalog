import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { schedulePackageBootstrapRestart, __test } from "../src/server/bootstrap-restart.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mari-bridge-preflight-"));
const entry = path.join(root, "packages/server/dist/index.js");
const preload = path.join(root, "data/mari-bridge/bootstrap/register.mjs");
const supervisor = path.join(root, "scripts/run-server.mjs");
const savedEnv = { ...process.env };
const kernelSymbol = Symbol.for("marinara.mari-bridge.kernel.v1");
const savedKernel = globalThis[kernelSymbol];
try {
  for (const file of [entry, preload, supervisor]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "// preflight fixture\n");
  }
  process.env.MARI_BRIDGE_ENGINE_ROOT = root;
  delete process.env.MARI_BRIDGE_DISABLE;
  delete process.env.MARINARA_RESTART_SUPERVISOR;
  delete process.env.MARINARA_DOCKER_USER;
  delete process.env.MARINARA_DOCKER_GROUP;
  delete globalThis[kernelSymbol];
  for (const flags of [{ MARINARA_DOCKER: "true" }, { MARINARA_DOCKER: "1" }, { MARINARA_DOCKER_USER: "node" }, { MARINARA_DOCKER_GROUP: "node" }]) {
    assert.equal(__test.isDockerRuntime(flags), true);
  }
  assert.equal(__test.isDockerRuntime({ MARINARA_DOCKER: "false" }), false);

  process.env.MARINARA_DOCKER = "true";
  await fs.rename(supervisor, supervisor + ".saved");
  const docker = await __test.prepareRestart(preload);
  assert.ok(docker.args.includes(entry));
  assert.ok(!docker.args.includes(supervisor), "Docker must not require or launch the local supervisor");
  assert.equal(docker.args.filter(arg => arg.startsWith("--import=")).length, 1);
  await fs.rename(supervisor + ".saved", supervisor);

  for (const missing of [supervisor, entry, preload]) {
    delete process.env.MARINARA_DOCKER;
    await fs.rename(missing, missing + ".saved");
    let closed = false;
    let onReady;
    let resolveError;
    const failure = new Promise(resolve => { resolveError = resolve; });
    const scheduled = await schedulePackageBootstrapRestart({
      dataDir: path.join(root, "attempts", path.basename(missing)),
      app: { addHook: (_name, hook) => { onReady = hook; }, close: async () => { closed = true; } },
      api: { runtime: { logger: { error: resolveError } } },
    }, preload);
    assert.equal(scheduled.scheduled, true);
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Missing-file preflight did not finish")), 2000); });
    try {
      await onReady();
      const error = await Promise.race([failure, deadline]);
      assert.equal(error.code, "ENOENT");
      assert.equal(closed, false, "A missing restart file must leave the running app open");
    } finally {
      clearTimeout(timer);
      await fs.rename(missing + ".saved", missing);
    }
  }
  console.log("Bootstrap preflight: Docker launch selection and all three missing-file recovery cases passed.");
} finally {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  if (savedKernel === undefined) delete globalThis[kernelSymbol];
  else globalThis[kernelSymbol] = savedKernel;
  await fs.rm(root, { recursive: true, force: true });
}
