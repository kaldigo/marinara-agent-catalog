import { injectHostJson } from "../../../_mari-bridge/src/host-routes.js";
import {
  buildRefreshedPersonaSnapshot,
  parseMessageExtra,
  personaData,
  selectMessagePersonaId,
} from "./reapply.js";

export function createPersonaReapplyRoutes({ app, runtime }) {
  app.post("/chat/:chatId/messages/:messageId", async (req, reply) => {
    try {
      const chat = await requireChat(runtime, req.params.chatId);
      const messages = await runtime.persistence.listMessages(chat.id);
      const message = messages.find((candidate) => candidate.id === req.params.messageId);
      if (!message || message.chatId !== chat.id) return reply.status(404).send({ error: "Message not found" });
      if (message.role !== "user") return reply.status(409).send({ error: "Only persona messages can be refreshed" });

      const personas = await loadPersonas(runtime, [selectMessagePersonaId(message, chat)]);
      const update = await refreshMessage({ app, chat, message, personas });
      return { updated: 1, skipped: 0, update };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/chat/:chatId/all", async (req, reply) => {
    try {
      const chat = await requireChat(runtime, req.params.chatId);
      const messages = await runtime.persistence.listMessages(chat.id);
      const userMessages = messages.filter((message) => message.role === "user");
      const personaIds = userMessages.map((message) => selectMessagePersonaId(message, chat));
      const personas = await loadPersonas(runtime, personaIds);
      const updates = [];
      const skipped = [];

      for (const message of userMessages) {
        try {
          updates.push(await refreshMessage({ app, chat, message, personas }));
        } catch (error) {
          skipped.push({
            messageId: message.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { updated: updates.length, skipped: skipped.length, updates, skippedMessages: skipped };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

async function requireChat(runtime, chatId) {
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat) throw httpError(404, "Chat not found");
  return chat;
}

async function loadPersonas(runtime, personaIds) {
  const ids = Array.from(new Set(personaIds.map((id) => String(id || "").trim()).filter(Boolean)));
  const records = ids.length > 0 ? await runtime.resources.listPersonas(ids) : [];
  return new Map(records.map((record) => [record.id, personaData(record)]).filter((entry) => entry[1]));
}

async function refreshMessage({ app, chat, message, personas }) {
  const extra = parseMessageExtra(message.extra);
  const previousSnapshot =
    extra.personaSnapshot && typeof extra.personaSnapshot === "object" && !Array.isArray(extra.personaSnapshot)
      ? extra.personaSnapshot
      : null;
  const personaId = selectMessagePersonaId(message, chat);
  if (!personaId) throw httpError(409, "No persona is associated with this message or chat");
  const persona = personas.get(personaId);
  if (!persona) throw httpError(404, `Persona ${personaId} was not found`);
  const personaSnapshot = buildRefreshedPersonaSnapshot(previousSnapshot, persona, personaId);

  await injectHostJson(
    app,
    "PATCH",
    `/api/chats/${encodeURIComponent(chat.id)}/messages/${encodeURIComponent(message.id)}/extra`,
    { personaSnapshot },
  );

  return {
    messageId: message.id,
    personaId,
    seededSnapshot: !previousSnapshot,
    previousSnapshot: previousSnapshot
      ? {
          nameColor: previousSnapshot.nameColor || null,
          dialogueColor: previousSnapshot.dialogueColor || null,
          boxColor: previousSnapshot.boxColor || null,
        }
      : null,
    personaSnapshot,
  };
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function sendError(reply, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return reply.status(status).send({ error: error instanceof Error ? error.message : String(error) });
}
