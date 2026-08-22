import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

function sanitizedEnvironment(extra) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).filter((entry) => typeof entry[1] === "string"),
  );
}

export async function schedulePackageBootstrapRestart(context, bootstrapPath) {
  const attemptFile = join(context.dataDir, "mari-bridge", "bootstrap-attempt.json");
  await mkdir(dirname(attemptFile), { recursive: true });
  if (globalThis[Symbol.for("marinara.mari-bridge.kernel.v1")]) {
    await writeFile(attemptFile, `${JSON.stringify({ attempts: 0, at: Date.now(), status: "preload-active" }, null, 2)}\n`);
    return { scheduled: false, reason: "preload-active" };
  }
  if (process.env.MARI_BRIDGE_DISABLE === "1") return { scheduled: false, reason: "disabled" };
  if (typeof process.execve !== "function") return { scheduled: false, reason: "execve-unavailable" };
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
    const inheritedExecArgs = process.execArgv.filter(
      (argument) => !(argument.startsWith("--import=") && argument.includes("mari-bridge")),
    );
    const entry = process.argv[1];
    if (!entry) throw new Error("Mari Bridge cannot reconstruct the Marinara entrypoint");
    await context.app.close();
    process.execve(
      process.execPath,
      [process.execPath, ...inheritedExecArgs, `--import=${bootstrapPath}`, entry, ...process.argv.slice(2)],
      sanitizedEnvironment({ MARI_BRIDGE_BOOTSTRAPPED: "1" }),
    );
  };
  context.app.addHook("onReady", async () => {
    const timer = setTimeout(() => {
      void restart().catch((error) => {
        context.api.runtime.logger.error(error, "Mari Bridge bootstrap restart failed");
      });
    }, 100);
    timer.unref?.();
  });
  return { scheduled: true, reason: "first-start" };
}
