import { createPresenceRoutes, registerPresenceMessageCreateHook } from "./routes.js";

export { buildSummaryAudience, buildSummaryLorebookEntries, buildSummaryLorebookName } from "./summary-mirror.js";
export { createPresenceRoutes, registerPresenceMessageCreateHook } from "./routes.js";

export async function activate(context) {
  registerPresenceMessageCreateHook({ app: context.app, runtime: context.api.runtime });
  await context.app.register(
    async (app) => {
      createPresenceRoutes({ app, runtime: context.api.runtime });
    },
    { prefix: "/api/presence" },
  );
  context?.api?.runtime?.logger?.info?.("Presence source package activated.");
}

export async function selfCheck(context) {
  if (typeof context?.api?.runtime?.persistence?.getChat !== "function") {
    throw new Error("Presence persistence host is unavailable.");
  }
  if (typeof context?.api?.runtime?.resources?.listCharacters !== "function") {
    throw new Error("Presence resource host is unavailable.");
  }
}
