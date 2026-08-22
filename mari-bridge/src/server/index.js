import { join } from "node:path";
import {
  MARI_BRIDGE_KERNEL_SYMBOL,
  MARI_BRIDGE_SERVER_SYMBOL,
} from "../shared/contracts.js";
import { createBridgeRuntime } from "./runtime.js";
import { createDiagnosticsRoutes } from "./routes.js";
import { createPromptRegistry } from "./prompt-registry.js";
import { createAgentResultRegistry } from "./result-registry.js";
import { createTrackerContextRegistry } from "./tracker-context-registry.js";
import { prepareClientOverlay } from "./client-overlay.js";
import { schedulePackageBootstrapRestart } from "./bootstrap-restart.js";
import { installBootstrapFile } from "./bootstrap-install.js";

let activeRuntime = null;

function createHostRequest(app) {
  return async (consumerId, input = {}) => {
    const method = String(input.method ?? "GET").toUpperCase();
    const path = String(input.path ?? input.url ?? "");
    if (!path.startsWith("/api/")) throw new TypeError("Mari Bridge host requests must target /api routes");
    const headers = {
      accept: "application/json",
      "x-mari-bridge-internal": "1",
      "x-mari-bridge-consumer": consumerId,
      ...(input.headers ?? {}),
    };
    const response = await app.inject({
      method,
      url: path,
      headers,
      ...(input.body === undefined ? {} : { payload: input.body }),
    });
    let data = null;
    if (response.payload) {
      try {
        data = JSON.parse(response.payload);
      } catch {
        data = response.payload;
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const message = data && typeof data === "object" && typeof data.error === "string"
        ? data.error
        : `Host request failed with HTTP ${response.statusCode}`;
      const error = new Error(message);
      error.statusCode = response.statusCode;
      error.data = data;
      throw error;
    }
    return data;
  };
}

async function installStableBootstrap(context) {
  const source = new URL("../../bootstrap/register.mjs", import.meta.url);
  const target = join(context.dataDir, "mari-bridge", "bootstrap", "register.mjs");
  return (await installBootstrapFile(source, target)).path;
}

export async function activate(context) {
  if (globalThis[MARI_BRIDGE_SERVER_SYMBOL]) {
    throw new Error("Another Mari Bridge server runtime already owns the global registry");
  }
  const bootstrapPath = await installStableBootstrap(context);
  const kernel = globalThis[MARI_BRIDGE_KERNEL_SYMBOL] ?? null;
  const bootstrapRestart = await schedulePackageBootstrapRestart(context, bootstrapPath);
  let clientOverlay = null;
  if (kernel?.nativeClientRoot) {
    clientOverlay = await prepareClientOverlay({ dataDir: context.dataDir, sourceRoot: kernel.nativeClientRoot });
    kernel.clientRoot = clientOverlay.root;
    kernel.patches["client.bridge-first"] = "applied";
    for (const patchId of clientOverlay.patches ?? []) kernel.patches[patchId] = "applied";
  }
  const promptRegistry = createPromptRegistry();
  const agentResultRegistry = createAgentResultRegistry();
  const trackerContextRegistry = createTrackerContextRegistry();
  const promptPatchApplied =
    kernel?.patches?.["prompt.assembler"] === "applied" &&
    kernel?.patches?.["prompt.generate-fallback"] === "applied";
  const agentResultPatchApplied =
    kernel?.patches?.["agent.result-types"] === "applied" &&
    kernel?.patches?.["agent.result-apply-main"] === "applied" &&
    kernel?.patches?.["agent.result-apply-retry"] === "applied";
  const trackerContextPatchApplied =
    kernel?.patches?.["tracker.context-committed-active"] === "applied" &&
    kernel?.patches?.["tracker.context-committed"] === "applied" &&
    kernel?.patches?.["tracker.context-agent"] === "applied";
  const runtime = createBridgeRuntime({
    capabilities: [
      "consumer.sessions",
      "diagnostics",
      "runtime.health",
      ...(promptPatchApplied
        ? ["prompt.inject", "prompt.suppress", "prompt.transform-final", "prompt.transform-history"]
        : []),
      ...(clientOverlay ? ["client.bridge-first"] : []),
      ...(agentResultPatchApplied ? ["agent.result-types"] : []),
      ...(trackerContextPatchApplied ? ["tracker.context"] : []),
      "host.request",
    ],
    promptRegistry,
    agentResultRegistry,
    trackerContextRegistry,
    hostRequest: createHostRequest(context.app),
    patches: [
      {
        id: "bridge-first.activation",
        status: kernel?.patches?.["bridge-first.activation"] === "applied" ? "applied" : "unavailable",
        detail: kernel ? null : "Mari Bridge preload is not active; configure the stable bootstrap and restart",
      },
      {
        id: "prompt.assembler",
        status: promptPatchApplied ? "applied" : "unavailable",
        detail: promptPatchApplied ? null : "Preset or fallback prompt assembly patch is not active",
      },
      {
        id: "prompt.generate-fallback",
        status: kernel?.patches?.["prompt.generate-fallback"] === "applied" ? "applied" : "unavailable",
        detail: kernel?.patches?.["prompt.generate-fallback"] === "applied"
          ? null
          : "No-preset generation prompt patch is not active",
      },
      {
        id: "client.bridge-first",
        status: clientOverlay ? "applied" : "unavailable",
        detail: clientOverlay ? clientOverlay.fingerprint : "Client overlay is unavailable until the preload is active",
      },
      {
        id: "client.tracker-panel",
        status: clientOverlay?.patches?.includes("client.tracker-panel") ? "applied" : "unavailable",
        detail: clientOverlay ? null : "Docked Tracker panel slots require the client overlay",
      },
      {
        id: "client.roleplay-hud",
        status: clientOverlay?.patches?.includes("client.roleplay-hud") ? "applied" : "unavailable",
        detail: clientOverlay ? null : "Roleplay HUD slots require the client overlay",
      },
      {
        id: "agent.result-types",
        status: agentResultPatchApplied ? "applied" : "unavailable",
        detail: agentResultPatchApplied ? null : "Custom result parsing or application hooks are unavailable",
      },
      {
        id: "tracker.context",
        status: trackerContextPatchApplied ? "applied" : "unavailable",
        detail: trackerContextPatchApplied ? null : "Committed tracker activation, committed sections, or agent tracker-context hooks are unavailable",
      },
      {
        id: "client.active-chat",
        status: clientOverlay?.patches?.includes("client.active-chat") ? "applied" : "unavailable",
        detail: clientOverlay ? null : "Native active-chat events require the client overlay",
      },
      {
        id: "client.generation-lifecycle",
        status: clientOverlay?.patches?.includes("client.generation-lifecycle") ? "applied" : "unavailable",
        detail: clientOverlay ? null : "Native generation events require the client overlay",
      },
      ...["client.command-drafts", "client.commands", "client.native-ui", "client.quick-replies"].map((id) => ({
        id,
        status: clientOverlay?.patches?.includes(id) ? "applied" : "unavailable",
        detail: clientOverlay ? null : `${id} requires the client overlay`,
      })),
    ],
  });
  activeRuntime = runtime;
  globalThis[MARI_BRIDGE_SERVER_SYMBOL] = runtime;
  try {
    const cleanupRoutes = await context.api.registerPrivilegedRoutes(
      createDiagnosticsRoutes(runtime),
      { prefix: "/api/mari-bridge" },
    );
    runtime.markReady();
    context.api.runtime.logger.info(
      "Mari Bridge activated; bootstrap=%s restart=%s clientOverlay=%s",
      bootstrapPath,
      bootstrapRestart.reason,
      clientOverlay?.fingerprint ?? "none",
    );
    return async () => {
      await runtime.dispose("Mari Bridge package deactivated");
      cleanupRoutes();
      if (globalThis[MARI_BRIDGE_SERVER_SYMBOL] === runtime) delete globalThis[MARI_BRIDGE_SERVER_SYMBOL];
      if (activeRuntime === runtime) activeRuntime = null;
    };
  } catch (error) {
    await runtime.dispose("Mari Bridge activation failed");
    if (globalThis[MARI_BRIDGE_SERVER_SYMBOL] === runtime) delete globalThis[MARI_BRIDGE_SERVER_SYMBOL];
    activeRuntime = null;
    throw error;
  }
}

export async function selfCheck() {
  const snapshot = activeRuntime?.getSnapshot();
  if (!snapshot || snapshot.status !== "ready") throw new Error("Mari Bridge runtime did not become ready");
  for (const capability of ["consumer.sessions", "diagnostics", "runtime.health"]) {
    if (!snapshot.capabilities.includes(capability)) throw new Error(`Mari Bridge is missing ${capability}`);
  }
}
