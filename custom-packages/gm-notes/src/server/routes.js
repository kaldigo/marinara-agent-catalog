import {
  GM_NOTES_AGENT_ID,
  applyGmNoteUpdates,
  mergeGmNotesIntoPlayerStats,
  readGmNotesFromPlayerStats,
} from "../shared/state.js";

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function parseMetadata(value) {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

async function loadView(bridgeSession, chatId) {
  const [gameState, chat] = await Promise.all([
    bridgeSession.host.request({ path: `/api/chats/${encodeURIComponent(chatId)}/game-state` }),
    bridgeSession.host.request({ path: `/api/chats/${encodeURIComponent(chatId)}` }),
  ]);
  const metadata = parseMetadata(chat?.metadata);
  const activeAgentIds = Array.isArray(metadata.activeAgentIds) ? metadata.activeAgentIds : [];
  return {
    chatId,
    enabled: metadata.enableAgents === true && activeAgentIds.includes(GM_NOTES_AGENT_ID),
    messageId: typeof gameState?.messageId === "string" ? gameState.messageId : "",
    swipeIndex: Number.isInteger(Number(gameState?.swipeIndex)) ? Number(gameState.swipeIndex) : 0,
    state: readGmNotesFromPlayerStats(gameState?.playerStats),
    playerStats: gameState?.playerStats ?? null,
  };
}

export function createGmNotesRoutes(bridgeSession) {
  return async function gmNotesRoutes(app) {
    app.get("/chat/:chatId/state", async (request) => {
      const view = await loadView(bridgeSession, request.params.chatId);
      return { chatId: view.chatId, enabled: view.enabled, messageId: view.messageId, swipeIndex: view.swipeIndex, ...view.state };
    });

    app.patch("/chat/:chatId/state", async (request, reply) => {
      const view = await loadView(bridgeSession, request.params.chatId);
      if (!view.enabled) return reply.code(409).send({ error: "GM Notes is not active for this chat" });
      const body = record(request.body);
      const applied = applyGmNoteUpdates(view.state, body.updates, {
        messageId: view.messageId || "manual",
        swipeIndex: view.swipeIndex,
      });
      if (applied.changed) {
        const playerStats = mergeGmNotesIntoPlayerStats(view.playerStats, applied.state);
        await bridgeSession.host.request({
          method: "PATCH",
          path: `/api/chats/${encodeURIComponent(view.chatId)}/game-state`,
          body: {
            playerStats,
            ...(view.messageId ? { messageId: view.messageId, swipeIndex: view.swipeIndex } : {}),
          },
        });
      }
      return { chatId: view.chatId, enabled: true, messageId: view.messageId, swipeIndex: view.swipeIndex, ...applied.state };
    });
  };
}
