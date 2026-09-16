import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function sanitizedEnvironment(extra) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).filter((entry) => typeof entry[1] === "string"),
  );
}

function withoutMariBridgeImports(value) {
  const tokens = String(value ?? "").trim().split(/\s+/u).filter(Boolean);
  const retained = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--import" && tokens[index + 1]?.toLowerCase().includes("mari-bridge")) {
      index += 1;
      continue;
    }
    if (token.startsWith("--import=") && token.toLowerCase().includes("mari-bridge")) continue;
    retained.push(token);
  }
  return retained.join(" ");
}

function withoutMariBridgeExecArgs(values) {
  return values.filter((value, index) => {
    if (value === "--import" && values[index + 1]?.includes("mari-bridge")) return false;
    if (values[index - 1] === "--import" && value.includes("mari-bridge")) return false;
    return !(value.startsWith("--import=") && value.includes("mari-bridge"));
  });
}

// Match Engine 2.4.6's runtime-config.isDockerRuntime. Its container entrypoint
// owns signals and container exits; the image does not ship run-server.mjs.
function isDockerRuntime(environment) {
  return ["1", "true", "yes", "on"].includes(String(environment.MARINARA_DOCKER ?? "").trim().toLowerCase())
    || Boolean(String(environment.MARINARA_DOCKER_USER ?? "").trim())
    || Boolean(String(environment.MARINARA_DOCKER_GROUP ?? "").trim());
}

async function prepareRestart(bootstrapPath) {
  const entry = process.argv[1];
  if (!entry) throw new Error("Mari Bridge cannot reconstruct the Marinara entrypoint");
  const engineRoot = process.env.MARI_BRIDGE_ENGINE_ROOT || resolve(dirname(entry), "..", "..", "..");
  const docker = isDockerRuntime(process.env);
  const supervised = process.env.MARINARA_RESTART_SUPERVISOR === String(process.ppid);
  const alreadyPreloaded = globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")]?.active === true;
  const nativeEntry = join(engineRoot, "packages", "server", "dist", "index.js");
  // Complete all file checks before closing the app. A failed restart preflight
  // must leave the running server available for recovery and package updates.
  await readFile(bootstrapPath);
  await readFile(nativeEntry);
  if (!docker && supervised && alreadyPreloaded) return { exitCode: 75 };
  const launchArgs = [nativeEntry, ...process.argv.slice(2)];
  if (!docker) {
    const nativeSupervisor = join(engineRoot, "scripts", "run-server.mjs");
    await readFile(nativeSupervisor);
    launchArgs.unshift(nativeSupervisor);
  }
  return {
    args: [
      ...withoutMariBridgeExecArgs(process.execArgv),
      `--import=${pathToFileURL(bootstrapPath).href}`,
      ...launchArgs,
    ],
    environment: sanitizedEnvironment({
      MARI_BRIDGE_BOOTSTRAPPED: "1",
      NODE_OPTIONS: withoutMariBridgeImports(process.env.NODE_OPTIONS),
    }),
  };
}

export async function schedulePackageBootstrapRestart(context, bootstrapPath, options = {}) {
  const attemptFile = join(context.dataDir, "mari-bridge", "bootstrap-attempt.json");
  await mkdir(dirname(attemptFile), { recursive: true });
  if (globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")] && options.force !== true) {
    await writeFile(attemptFile, `${JSON.stringify({ attempts: 0, at: Date.now(), status: "preload-active" }, null, 2)}\n`);
    return { scheduled: false, reason: "preload-active" };
  }
  if (process.env.MARI_BRIDGE_DISABLE === "1") return { scheduled: false, reason: "disabled" };
  if (process.platform !== "win32" && typeof process.execve !== "function") {
    return { scheduled: false, reason: "execve-unavailable" };
  }
  let previous = null;
  try {
    previous = JSON.parse(await readFile(attemptFile, "utf8"));
  } catch {
    // First attempt.
  }
  const now = Date.now();
  const attempts = previous && now - Number(previous.at ?? 0) < 300_000 ? Number(previous.attempts ?? 0) + 1 : 1;
  if (attempts > 2) {
    await writeFile(attemptFile, `${JSON.stringify({ attempts, at: now, status: "blocked-loop" }, null, 2)}\n`);
    return { scheduled: false, reason: "loop-guard" };
  }
  await writeFile(attemptFile, `${JSON.stringify({ attempts, at: now, status: "scheduled" }, null, 2)}\n`);
  const restart = async () => {
    const plan = await prepareRestart(bootstrapPath);
    await context.app.close();
    // A version update uses the existing native supervisor and stable preload.
    if (plan.exitCode !== undefined) {
      process.exit(plan.exitCode);
      return;
    }
    const { args, environment } = plan;
    if (process.platform === "win32") {
      const child = spawn(process.execPath, args, {
        // Keep console signal delivery; restart ownership belongs to the native
        // supervisor we are launching, never a detached orphan server.
        detached: false,
        env: environment,
        stdio: "inherit",
        windowsHide: true,
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      // Keep the first-install launcher alive until its native supervisor exits.
      // Exiting immediately can close the Windows process/console job before
      // the replacement has even executed its preload.
      const code = await new Promise((resolve) => child.once("close", (status) => resolve(status ?? 1)));
      process.exit(code);
    }
    // In Docker this replaces only the server child, keeping its PID and the
    // official entrypoint parent. Native admin restart still exits the container.
    process.execve(process.execPath, [process.execPath, ...args], environment);
  };
  context.app.addHook("onReady", async () => {
    const timer = setTimeout(() => {
      void restart().catch((error) => {
        context.api.runtime.logger.error(error, "Mari Bridge bootstrap restart failed");
      });
    }, 100);
    timer.unref?.();
  });
  return { scheduled: true, reason: options.reason ?? "first-start" };
}

export const __test = Object.freeze({ withoutMariBridgeImports, withoutMariBridgeExecArgs, isDockerRuntime, prepareRestart });
