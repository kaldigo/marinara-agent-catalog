import { parseSseEventPayload, parseSsePayloads } from "../../../_mari-bridge/src/generation-stream.js";
import { EXTRA_KEY, PACKAGE_ID, PACKAGE_VERSION } from "./constants.js";

const TEXT_DECODER = new TextDecoder("utf-8");

export async function handleGenerateRequest(_runtime, context, next) {
  const body = context.body || {};
  const chatId = cleanId(body.chatId);
  const regenerateMessageId = cleanId(body.regenerateMessageId);
  const continueMessageId = cleanId(body.continueMessageId);
  const targetMessageId = regenerateMessageId || continueMessageId;
  if (!chatId || !targetMessageId || body.impersonate === true) return next();

  const fetchOriginal = context.fetchOriginal;
  const generationContext = await loadGenerationContext(fetchOriginal, chatId, targetMessageId);
  if (!generationContext || generationContext.chatMode === "game") return next();

  const response = await next();
  if (!response?.ok || !response.body || typeof response.clone !== "function") return response;

  const monitorInput = {
    fetchOriginal,
    chatId,
    targetMessageId,
    kind: regenerateMessageId ? "regenerate" : "continue",
    signal: context.init?.signal || null,
    response: response.clone(),
    baseContent: generationContext.message?.content || "",
    continueAddsNewline: body.continueAddsNewline !== false,
  };
  void monitorStoppedGeneration(monitorInput);
  return response;
}

export async function handleMessageEditRequest(_runtime, context, next) {
  const content = typeof context.body?.content === "string" ? context.body.content : null;
  if (content === null) return next();

  const match = context.route.pathname.match(/^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/u);
  const chatId = decodePathPart(match?.[1]);
  const messageId = decodePathPart(match?.[2]);
  if (!chatId || !messageId) return next();

  const fetchOriginal = context.fetchOriginal;
  const chat = await getJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}`).catch(() => null);
  if (chat?.mode === "game") return next();

  const message = await getMessage(fetchOriginal, chatId, messageId);
  if (!message || message.chatId !== chatId) return next();
  if (message.content === content) return next();

  const swipes = await getSwipes(fetchOriginal, chatId, messageId);
  const activeSwipeIndex = normalizeSwipeIndex(message.activeSwipeIndex);
  const activeSwipe = swipes.find((swipe) => normalizeSwipeIndex(swipe.index) === activeSwipeIndex);
  if (isManualEditSwipe(activeSwipe)) return next();

  await postJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/swipes`, {
    content,
  });
  await patchMessageExtra(fetchOriginal, chatId, messageId, {
    [EXTRA_KEY]: {
      manualEdit: true,
      sourceSwipeIndex: activeSwipeIndex,
      sourceMessageContent: message.content,
      createdAt: new Date().toISOString(),
      packageId: PACKAGE_ID,
      packageVersion: PACKAGE_VERSION,
    },
  });

  const updated = await getMessage(fetchOriginal, chatId, messageId);
  return jsonResponse(updated || { ...message, content, activeSwipeIndex: swipes.length });
}

async function monitorStoppedGeneration(input) {
  const reader = input.response.body?.getReader?.();
  if (!reader) return;

  let carry = "";
  let content = "";
  let completed = false;
  let preserved = false;
  let preservePromise = null;
  const preserveOnce = () => {
    if (completed || preserved || !content.trim()) return null;
    preserved = true;
    preservePromise = preservePartialSwipe(input, content).catch((error) => {
      console.warn("[Response Keeper] Failed to preserve stopped generation.", error);
    });
    return preservePromise;
  };
  const onAbort = () => {
    preserveOnce();
  };
  input.signal?.addEventListener?.("abort", onAbort, { once: true });

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        processSsePayloads(parseSsePayloads(carry, true).payloads);
        break;
      }
      const decoded = TEXT_DECODER.decode(next.value, { stream: true });
      const parsed = parseSsePayloads(`${carry}${decoded}`, false);
      carry = parsed.rest;
      processSsePayloads(parsed.payloads);
    }
  } catch {
    // Abort tears down the cloned reader too. The signal check below decides
    // whether the partial should be preserved.
  } finally {
    input.signal?.removeEventListener?.("abort", onAbort);
    try {
      reader.releaseLock?.();
    } catch {}
    if (input.signal?.aborted === true) {
      await (preserveOnce() || preservePromise);
    }
  }

  function processSsePayloads(payloads) {
    for (const payload of payloads) {
      const event = parseSseEventPayload(payload);
      if (!event || typeof event.type !== "string") continue;
      if (event.type === "token" && typeof event.data === "string") content += event.data;
      else if (event.type === "content_replace" && typeof event.data === "string") content = event.data;
      else if (event.type === "text_rewrite" && typeof event.data?.editedText === "string") content = event.data.editedText;
      else if (event.type === "message_saved" || event.type === "done") completed = true;
      else if (event.type === "generation_discarded") completed = true;
    }
  }
}

async function preservePartialSwipe(input, partialContent) {
  const trimmedPartial = normalizeGeneratedText(partialContent);
  if (!trimmedPartial) return;
  if (input.kind === "continue") {
    const content = appendContinuationMessageContent(input.baseContent, trimmedPartial, input.continueAddsNewline);
    if (!content.trim() || content === input.baseContent) return;
    await patchMessageContent(input.fetchOriginal, input.chatId, input.targetMessageId, content);
    await patchMessageExtra(input.fetchOriginal, input.chatId, input.targetMessageId, {
      [EXTRA_KEY]: {
        manualEdit: false,
        stoppedPartial: true,
        source: "continue",
        createdAt: new Date().toISOString(),
        packageId: PACKAGE_ID,
        packageVersion: PACKAGE_VERSION,
      },
    });
    return;
  }

  await postJson(
    input.fetchOriginal,
    `/api/chats/${encodeURIComponent(input.chatId)}/messages/${encodeURIComponent(input.targetMessageId)}/swipes`,
    { content: trimmedPartial },
  );
  await patchMessageExtra(input.fetchOriginal, input.chatId, input.targetMessageId, {
    [EXTRA_KEY]: {
      stoppedPartial: true,
      source: "regenerate",
      createdAt: new Date().toISOString(),
      packageId: PACKAGE_ID,
      packageVersion: PACKAGE_VERSION,
    },
  });
}

async function loadGenerationContext(fetchOriginal, chatId, messageId) {
  const [chat, message] = await Promise.all([
    getJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}`).catch(() => null),
    getMessage(fetchOriginal, chatId, messageId).catch(() => null),
  ]);
  if (!chat || !message) return null;
  return { chatMode: typeof chat.mode === "string" ? chat.mode : "", message };
}

async function getMessage(fetchOriginal, chatId, messageId) {
  const messages = await getJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}/messages`);
  const list = Array.isArray(messages) ? messages : Array.isArray(messages?.messages) ? messages.messages : [];
  return list.find((message) => message?.id === messageId) || null;
}

async function getSwipes(fetchOriginal, chatId, messageId) {
  const swipes = await getJson(
    fetchOriginal,
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/swipes`,
  ).catch(() => []);
  return Array.isArray(swipes) ? swipes : [];
}

async function patchMessageExtra(fetchOriginal, chatId, messageId, extra) {
  return patchJson(
    fetchOriginal,
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`,
    extra,
  );
}

async function patchMessageContent(fetchOriginal, chatId, messageId, content) {
  return patchJson(fetchOriginal, `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`, {
    content,
  });
}

async function getJson(fetchOriginal, path) {
  const response = await fetchOriginal(path, { headers: { Accept: "application/json" } });
  return readJsonResponse(response);
}

async function postJson(fetchOriginal, path, body) {
  const response = await fetchOriginal(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body || {}),
  });
  return readJsonResponse(response);
}

async function patchJson(fetchOriginal, path, body) {
  const response = await fetchOriginal(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body || {}),
  });
  return readJsonResponse(response);
}

async function readJsonResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && data.error ? data.error : text || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data;
}

function normalizeGeneratedText(value) {
  return String(value || "").replace(/[ \t]+(\r?\n)/gu, "$1").trim();
}

function appendContinuationMessageContent(existingContent, continuation, addNewline = true) {
  const existing = typeof existingContent === "string" ? existingContent : "";
  if (!existing) return continuation;
  if (!continuation) return existing;
  if (!addNewline) return `${existing}${continuation.replace(/^(?:\r?\n)+/u, "")}`;
  return `${existing.replace(/\s+$/u, "")}\n\n${continuation.replace(/^\s+/u, "")}`;
}

function isManualEditSwipe(swipe) {
  const extra = normalizeObject(swipe?.extra);
  const marker = normalizeObject(extra[EXTRA_KEY]);
  return marker.manualEdit === true;
}

function normalizeObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSwipeIndex(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function cleanId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function decodePathPart(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function jsonResponse(data) {
  return new Response(`${JSON.stringify(data ?? null)}\n`, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
