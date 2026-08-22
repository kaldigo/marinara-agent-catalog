import {
  MARI_BRIDGE_CLIENT_SYMBOL,
  missingBridgeError,
  normalizeBridgeRequirements,
} from "./contracts.js";

function readyClientRuntime() {
  const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
  return runtime?.status === "ready" && typeof runtime.registerConsumer === "function" ? runtime : null;
}

async function waitForClientRuntime(timeoutMs) {
  const timeout = Math.max(0, Math.min(30_000, Number(timeoutMs) || 0));
  const deadline = Date.now() + timeout;
  let runtime = readyClientRuntime();
  while (!runtime && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
    runtime = readyClientRuntime();
  }
  return runtime;
}

export async function activateClientWithMariBridge(input, activateConsumer) {
  if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
  const requirements = normalizeBridgeRequirements(input);
  const runtime = readyClientRuntime() ?? await waitForClientRuntime(input?.waitForBridgeMs ?? 5_000);
  if (!runtime) {
    throw missingBridgeError(requirements.consumerId, "client");
  }
  const session = runtime.registerConsumer(requirements);
  try {
    const cleanup = await activateConsumer(session);
    if (typeof cleanup === "function") session.addCleanup(cleanup);
    const marker = `data-mari-bridge-consumer-${requirements.consumerId}`;
    globalThis.document?.documentElement?.setAttribute(marker, "ready");
    return async () => {
      globalThis.document?.documentElement?.removeAttribute(marker);
      await session.close(`${requirements.consumerId} client deactivated`);
    };
  } catch (error) {
    await session.close(`${requirements.consumerId} client activation failed`);
    throw error;
  }
}
