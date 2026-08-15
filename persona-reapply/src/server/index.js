import { createPersonaReapplyRoutes } from "./routes.js";

export async function activate(context) {
  await context.app.register(
    async (app) => {
      createPersonaReapplyRoutes({ app, runtime: context.api.runtime });
    },
    { prefix: "/api/persona-reapply" },
  );
  context.api.runtime.logger.info("Persona Reapply package activated.");
}

export async function selfCheck(context) {
  if (!context?.app || typeof context.app.inject !== "function") {
    throw new Error("Persona Reapply host route injection is unavailable.");
  }
  if (typeof context?.api?.runtime?.persistence?.getChat !== "function") {
    throw new Error("Persona Reapply chat persistence host is unavailable.");
  }
  if (typeof context?.api?.runtime?.resources?.listPersonas !== "function") {
    throw new Error("Persona Reapply persona resource host is unavailable.");
  }
}
