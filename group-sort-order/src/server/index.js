import { createGroupSortRoutes, registerGroupSortHooks } from "./routes.js";
import { activateWithMariBridge } from "../../../_mari-bridge/sdk/server.js";

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "group-sort-order",
      api: { major: 1, minMinor: 0 },
      require: ["consumer.sessions", "host.request", "prompt.inject", "runtime.health"],
    },
    async (bridgeSession) => {
      const runtime = context.api.runtime;
      const cleanupHooks = registerGroupSortHooks({ app: context.app, runtime, bridgeSession });
      await context.app.register((app) => createGroupSortRoutes({ app, runtime, bridgeSession }), {
        prefix: "/api/group-sort-order",
      });
      runtime.logger.info("[Group Sort Order] activated through Mari Bridge");
      return cleanupHooks;
    },
  );
}

export async function selfCheck(context) {
  if (!context?.api?.runtime?.persistence) throw new Error("Group Sort Order requires runtime persistence.");
}
