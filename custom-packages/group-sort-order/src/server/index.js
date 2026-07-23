import { createGroupSortRoutes, registerGroupSortHooks } from "./routes.js";

export async function activate(context) {
  const runtime = context.api.runtime;
  const cleanupHooks = registerGroupSortHooks({ app: context.app, runtime });
  await context.app.register((app) => createGroupSortRoutes({ app, runtime }), {
    prefix: "/api/group-sort-order",
  });
  runtime.logger.info("[Group Sort Order] activated");
  return cleanupHooks;
}

export async function selfCheck(context) {
  if (!context?.api?.runtime?.persistence) throw new Error("Group Sort Order requires runtime persistence.");
}
