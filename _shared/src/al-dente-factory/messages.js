import { emit } from "./events.js";

function messageIdFromSavedEvent(event) {
  return event?.data?.id || event?.data?.messageId || "";
}

function messageFromCreateResponse(json) {
  return json?.message || json?.data || json || null;
}

export function createMessageTracker(state) {
  function emitCreated(chatId, message, context = {}) {
    const messageId = message?.id || message?.messageId || "";
    if (!chatId || !messageId) return null;
    const detail = { chatId, messageId: String(messageId), message, context };
    emit("message:created", detail);
    return detail;
  }

  function emitSaved(chatId, event, context = {}) {
    const messageId = messageIdFromSavedEvent(event);
    if (!chatId || !messageId) return null;
    const detail = { chatId, messageId: String(messageId), event, message: event?.data || null, context };
    emit("message:saved", detail);
    return detail;
  }

  async function trackCreateResponse(chatId, response, context = {}) {
    if (!response?.ok) return response;
    let json = null;
    try {
      json = await response.clone().json();
    } catch {
      json = null;
    }
    const message = messageFromCreateResponse(json);
    if (message) emitCreated(chatId, message, context);
    return response;
  }

  function handleSseEvent(chatId, event, context = {}) {
    if (event?.type === "message_saved") return emitSaved(chatId, event, context);
    return null;
  }

  return Object.freeze({
    emitCreated,
    emitSaved,
    trackCreateResponse,
    handleSseEvent,
  });
}
