import {
  getGmNotesBackfillStatus,
  runGmNotesBackfillBatch,
} from "./backfill.js";

function requiredChatId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw Object.assign(new Error("Chat ID is required."), { statusCode: 400 });
  }
  return value.trim();
}

export function createGmNotesRoutes({ runtime, hostRequest }) {
  return async function gmNotesRoutes(app) {
    app.get("/backfill/:chatId", async (request) => (
      getGmNotesBackfillStatus(runtime, requiredChatId(request.params?.chatId))
    ));
    app.post("/backfill/:chatId", async (request, reply) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.raw?.once?.("aborted", abort);
      reply.raw?.once?.("close", abort);
      try {
        return await runGmNotesBackfillBatch({
          runtime,
          hostRequest,
          chatId: requiredChatId(request.params?.chatId),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") {
          return reply.status(499).send({
            error: "GM Notes backfill was cancelled.",
            code: "gm_notes_backfill_cancelled",
          });
        }
        throw error;
      } finally {
        request.raw?.off?.("aborted", abort);
        reply.raw?.off?.("close", abort);
      }
    });
  };
}
