import { createPresenceRoutes, registerPresenceMessageCreateHook } from "./routes.js";
import { activateWithMariBridge } from "../../../_mari-bridge/sdk/server.js";

export { createPresenceRoutes, registerPresenceMessageCreateHook } from "./routes.js";

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "presence",
      api: { major: 1, minMinor: 2 },
      require: ["consumer.sessions", "host.lifecycle", "host.request", "runtime.health"],
    },
    async (bridgeSession) => {
      registerPresenceMessageCreateHook({ app: context.app, runtime: context.api.runtime, bridgeSession });
      await context.app.register(
        async (app) => {
          createPresenceRoutes({ app, runtime: context.api.runtime, bridgeSession });
        },
        { prefix: "/api/presence" },
      );
      context?.api?.runtime?.logger?.info?.("Presence source package activated through Mari Bridge.");
    },
  );
}

export async function selfCheck(context) {
  if (typeof context?.api?.runtime?.persistence?.getChat !== "function") {
    throw new Error("Presence persistence host is unavailable.");
  }
  if (typeof context?.api?.runtime?.resources?.listCharacters !== "function") {
    throw new Error("Presence resource host is unavailable.");
  }
}
