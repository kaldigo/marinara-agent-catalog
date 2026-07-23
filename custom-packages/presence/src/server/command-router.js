import { createHideHijackOwner, createSlashCommandRouter } from "../../bridge/commands.js";

export function createPresenceCommandRouter({ runPresenceCommand, runScopedHideCommand }) {
  const router = createSlashCommandRouter();
  router.register({
    id: "presence.command",
    commands: ["/presence"],
    handler: ({ raw, tokens, context }) => runPresenceCommand({ raw, tokens, context }),
  });
  router.register({
    id: "hide-from-ai.augment",
    hijacks: ["/hide", "/unhide"],
    owns: createHideHijackOwner(),
    handler: ({ command, raw, tokens, context }) =>
      runScopedHideCommand({
        raw,
        tokens,
        hidden: command.toLowerCase() === "/hide",
        context,
      }),
  });
  return router;
}
