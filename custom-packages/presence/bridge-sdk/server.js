import {
  MARI_BRIDGE_SERVER_SYMBOL,
  missingBridgeError,
  normalizeBridgeRequirements,
} from "./contracts.js";

export async function activateWithMariBridge(context, input, activateConsumer) {
  if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
  const requirements = normalizeBridgeRequirements(input);
  const packageId = context?.package?.id;
  if (packageId && packageId !== requirements.consumerId) {
    throw new Error(`Mari Bridge consumer identity ${requirements.consumerId} does not match package ${packageId}`);
  }
  const runtime = globalThis[MARI_BRIDGE_SERVER_SYMBOL];
  if (!runtime || typeof runtime.registerConsumer !== "function") {
    throw missingBridgeError(requirements.consumerId, "server");
  }
  const session = runtime.registerConsumer(requirements);
  try {
    const cleanup = await activateConsumer(session);
    if (typeof cleanup === "function") session.addCleanup(cleanup);
    return () => session.close(`${requirements.consumerId} package deactivated`);
  } catch (error) {
    await session.close(`${requirements.consumerId} activation failed`);
    throw error;
  }
}
