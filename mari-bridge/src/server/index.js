import { join } from "node:path";
import { MARI_BRIDGE_IMPLEMENTATION_VERSION, MARI_BRIDGE_KERNEL_SYMBOL } from "../shared/contracts.js";
import { schedulePackageBootstrapRestart } from "./bootstrap-restart.js";
import { installBootstrapFile, requiresBootstrapHandoff } from "./bootstrap-install.js";

const STABLE_RUNTIME_FILES = Object.freeze([
  "src/shared/contracts.js",
  "src/server/runtime.js",
  "src/server/prompt-registry.js",
  "src/server/result-registry.js",
  "src/server/tracker-context-registry.js",
  "src/server/group-selector-registry.js",
  "src/server/turn-handoff-registry.js",
  "src/server/message-registry.js",
  "src/server/chat-registry.js",
  "src/server/spatial-directive-compat.js",
  "src/server/client-overlay.js",
  "src/server/server-overlay.js",
  "src/client/runtime.js",
  "bootstrap/runtime.mjs",
  // Commit the preload entry last, after every module it imports exists.
  "bootstrap/register.mjs",
]);

let lastInstall = null;

async function installStableRuntime(context) {
  const targetRoot = join(context.dataDir, "mari-bridge");
  let changed = false;
  let bootstrapPath = null;
  for (const relativePath of STABLE_RUNTIME_FILES) {
    const result = await installBootstrapFile(
      new URL(`../../${relativePath}`, import.meta.url),
      join(targetRoot, relativePath),
    );
    changed ||= result.changed;
    if (relativePath === "bootstrap/register.mjs") bootstrapPath = result.path;
  }
  if (!bootstrapPath) throw new Error("Mari Bridge stable preload entry was not installed");
  return Object.freeze({ targetRoot, bootstrapPath, changed });
}

export async function activate(context) {
  const install = await installStableRuntime(context);
  const kernel = globalThis[MARI_BRIDGE_KERNEL_SYMBOL] ?? null;
  if (kernel && kernel.active !== true) {
    throw new Error(
      `Mari Bridge injected runtime failed: ${kernel.failures?.join("; ") || "unknown preload failure"}`,
    );
  }
  const force = requiresBootstrapHandoff(
    kernel,
    install.changed,
    MARI_BRIDGE_IMPLEMENTATION_VERSION,
  );
  const restart = await schedulePackageBootstrapRestart(context, install.bootstrapPath, {
    force,
    reason: force ? "version-handoff" : undefined,
  });
  lastInstall = Object.freeze({ ...install, restart, kernelVersion: kernel?.version ?? null });
  context.api.runtime.logger.info(
    "Mari Bridge installer ready; bootstrap=%s changed=%s restart=%s injected=%s",
    install.bootstrapPath,
    install.changed,
    restart.reason,
    kernel?.active === true,
  );
  return () => {};
}

export async function selfCheck() {
  if (!lastInstall?.bootstrapPath) throw new Error("Mari Bridge stable runtime was not installed");
}
