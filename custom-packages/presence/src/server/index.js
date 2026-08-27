import { createPresenceRoutes, registerPresenceHooks } from "./routes.js";
import { activateWithMariBridge } from "../../bridge-sdk/server.js";

export { createPresenceRoutes, registerPresenceHooks } from "./routes.js";

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "presence",
      api: { major: 1, minMinor: 7 },
      require: ["chat.changed", "consumer.sessions", "host.request", "message.persist", "message.prepare", "runtime.health"],
    },
    async (bridgeSession) => {
      registerPresenceHooks({ runtime: context.api.runtime, bridgeSession });
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
  if (typeof context?.api?.runtime?.persistence?.withChatLock !== "function") {
    throw new Error("Presence chat metadata lock is unavailable.");
  }
  if (typeof context?.api?.runtime?.resources?.listCharacters !== "function") {
    throw new Error("Presence resource host is unavailable.");
  }
}
