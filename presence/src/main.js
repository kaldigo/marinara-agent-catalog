(() => {
  "use strict";

  const EXTENSION_NAME = "Presence";
  const PRESENCE_KEY = "marinaraPresence";
  const BUTTON_CLASS = "mari-presence-button";
  const POPOVER_CLASS = "mari-presence-popover";
  const TOAST_CLASS = "mari-presence-toast";
  const DEFAULT_TOKEN_BUDGET = 32000;
  const SCAN_OVERAGE = 1.1;
  const PATCH_CONCURRENCY = 8;
  const DEBUG_STORAGE_KEY = "marinara-presence-debug";

  const state = {
    originalFetch: null,
    observer: null,
    scanTimer: null,
    popover: null,
    popoverMessageId: "",
    popoverOpenSeq: 0,
    chatCache: new Map(),
    characterCache: new Map(),
    cleanups: [],
    extensionRegistration: null,
    serviceRegistration: null,
    commandRegistration: null,
    fetchInterceptorRegistrations: [],
    legacyFetchInstalled: false,
    debug: localStorage.getItem(DEBUG_STORAGE_KEY) === "true",
    disposed: false,
  };

  function log(...args) {
    if (!state.debug) return;
    console.info(`[${EXTENSION_NAME}]`, ...args);
  }

  function warn(...args) {
    console.warn(`[${EXTENSION_NAME}]`, ...args);
  }

  function normalizeApiPath(path) {
    return path.startsWith("/") ? path : `/${path}`;
  }

  function alDente() {
    return window.alDenteFactory || null;
  }

  function factoryApi() {
    return alDente()?.marinara?.api || null;
  }

  function factoryFetch() {
    return alDente()?.marinara?.fetch || null;
  }

  function factoryCommands() {
    return alDente()?.marinara?.commands || null;
  }

  function factoryGeneration() {
    return alDente()?.marinara?.generation || null;
  }

  function factoryIdentity() {
    return alDente()?.marinara?.identity || null;
  }

  function factoryMessages() {
    return alDente()?.marinara?.messages || null;
  }

  function factoryOperations() {
    return alDente()?.operations || null;
  }

  function factoryParsers() {
    return alDente()?.marinara?.parsers || null;
  }

  function factoryRoutes() {
    return alDente()?.marinara?.routes || null;
  }

  function factorySse() {
    return alDente()?.marinara?.sse || null;
  }

  function baseFetch(input, init) {
    const fetchFn = typeof state.originalFetch === "function"
      ? state.originalFetch
      : factoryFetch()?.fetchOriginal || window.fetch.bind(window);
    return fetchFn(input, init);
  }

  async function api(path, options = {}) {
    const sharedApi = factoryApi();
    if (sharedApi?.request) return sharedApi.request(path, options);

    const response = await baseFetch(`/api${normalizeApiPath(path)}`, {
      ...options,
      headers: {
        ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
    if (response.status === 204) return {};
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(json?.error || `${response.status} ${response.statusText}`);
      error.status = response.status;
      error.body = json;
      throw error;
    }
    return json;
  }

  function parseMaybeJson(value, fallback) {
    const parsedByFactory = factoryParsers()?.maybeJson?.(value, fallback);
    if (parsedByFactory !== undefined) return parsedByFactory;
    if (value && typeof value === "object") return value;
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function getExtra(message) {
    const extraByFactory = factoryParsers()?.messageExtra?.(message);
    if (extraByFactory && typeof extraByFactory === "object" && !Array.isArray(extraByFactory)) return extraByFactory;
    const extra = parseMaybeJson(message?.extra, {});
    return extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
  }

  function getMetadata(chat) {
    const metadataByFactory = factoryParsers()?.chatMetadata?.(chat);
    if (metadataByFactory && typeof metadataByFactory === "object" && !Array.isArray(metadataByFactory)) return metadataByFactory;
    const metadata = parseMaybeJson(chat?.metadata, {});
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  }

  function isHiddenFromAI(message) {
    return getExtra(message).hiddenFromAI === true;
  }

  function messageContent(message) {
    const contentByFactory = factoryParsers()?.messageContent?.(message);
    if (contentByFactory !== undefined) return String(contentByFactory);
    return String(message?.content ?? message?.mes ?? message?.message ?? "");
  }

  function countRoughTokens(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return 0;
    return Math.max(1, Math.ceil(normalized.length / 4));
  }

  function resolveTokenBudget(chat, body) {
    const meta = getMetadata(chat);
    const candidates = [
      body?.contextSize,
      body?.maxContext,
      body?.contextTokenLimit,
      chat?.contextSize,
      chat?.maxContext,
      meta.contextSize,
      meta.maxContext,
      meta.contextTokenLimit,
      meta.effectiveMaxContext,
    ];
    for (const value of candidates) {
      const n = Math.floor(Number(value));
      if (Number.isFinite(n) && n > 1000) return n;
    }
    return DEFAULT_TOKEN_BUDGET;
  }

  function isGenerateUrl(url) {
    const routeHelper = factoryRoutes();
    if (routeHelper?.isGenerateUrl) return routeHelper.isGenerateUrl(url);
    try {
      const pathname = new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/, "");
      return pathname === "/api/generate";
    } catch {
      return false;
    }
  }

  function parseCreateMessageUrl(url) {
    const routeHelper = factoryRoutes();
    if (routeHelper?.parseCreateMessageUrl) return routeHelper.parseCreateMessageUrl(url);
    try {
      const pathname = new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/, "");
      const match = pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  }

  function withPresenceSkip(init = {}) {
    return { ...(init || {}), __marinaraPresenceHandled: true };
  }

  function stripPresenceInternalInit(init = {}) {
    if (!init || typeof init !== "object" || !("__marinaraPresenceHandled" in init)) return init;
    const { __marinaraPresenceHandled, ...rest } = init;
    return rest;
  }

  function readActiveChatId() {
    const factoryChatId = factoryIdentity()?.readActiveChatId?.();
    if (factoryChatId) return factoryChatId;
    const stored = localStorage.getItem("marinara-active-chat-id");
    if (stored) return stored;
    const selected = document.querySelector('[data-chat-id][aria-current="true"], [data-chat-id][class*="sidebar-accent"]');
    return selected?.getAttribute("data-chat-id") || "";
  }

  async function getChat(chatId) {
    if (!chatId) return null;
    const cached = state.chatCache.get(chatId);
    if (cached && Date.now() - cached.at < 5000) return cached.value;
    const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
    if (chat?.metadata && typeof chat.metadata === "string") chat.metadata = parseMaybeJson(chat.metadata, {});
    state.chatCache.set(chatId, { at: Date.now(), value: chat });
    return chat;
  }

  async function getMessages(chatId) {
    const res = await api(`/chats/${encodeURIComponent(chatId)}/messages`);
    return Array.isArray(res) ? res : res?.messages || res?.data || [];
  }

  function readCharacterName(character, fallback = "") {
    const nameByFactory = factoryParsers()?.readCharacterName?.(character, fallback);
    if (nameByFactory) return nameByFactory;
    const data = parseMaybeJson(character?.data, character?.data || {});
    return String(character?.name || data?.name || fallback || character?.id || "Character").trim();
  }

  function getCharacterIds(chat) {
    const idsByFactory = factoryParsers()?.getCharacterIds?.(chat);
    if (Array.isArray(idsByFactory)) return idsByFactory.filter((id) => typeof id === "string" && id.trim()).map(String);
    const ids = parseMaybeJson(chat?.characterIds, []);
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.trim()).map(String) : [];
  }

  async function getCharacter(characterId) {
    if (!characterId) return null;
    const cached = state.characterCache.get(characterId);
    if (cached) return cached;
    const identity = factoryIdentity();
    let character = null;
    if (identity?.getCharacter) character = await identity.getCharacter(characterId).catch(() => null);
    if (!character) character = await api(`/characters/${encodeURIComponent(characterId)}`).catch(() => null);
    const normalized = character ? { ...character, id: character.id || characterId, name: readCharacterName(character, characterId) } : null;
    if (normalized) state.characterCache.set(characterId, normalized);
    return normalized;
  }

  async function getRoster(chat) {
    const ids = getCharacterIds(chat);
    const characters = [];
    for (const id of ids) {
      const character = await getCharacter(id);
      characters.push(character || { id, name: id });
    }
    return characters;
  }

  function activeCharacterIdsForChat(chat, rosterIds) {
    const activeByFactory = factoryParsers()?.activeCharacterIdsForChat?.(chat, rosterIds);
    if (Array.isArray(activeByFactory)) return activeByFactory.filter((id) => typeof id === "string" && id.trim()).map(String);
    const meta = getMetadata(chat);
    const inactive = new Set(Array.isArray(meta.inactiveCharacterIds) ? meta.inactiveCharacterIds.map(String) : []);
    const active = rosterIds.filter((id) => !inactive.has(id));
    return active.length ? active : rosterIds;
  }

  function generationCharacterIdsForBody(chat, rosterIds, body, messages = []) {
    const requested = typeof body?.forCharacterId === "string" ? body.forCharacterId.trim() : "";
    if (requested && rosterIds.includes(requested)) return { ids: [requested], source: "forCharacterId" };

    const anchorId =
      typeof body?.regenerateMessageId === "string" && body.regenerateMessageId.trim()
        ? body.regenerateMessageId.trim()
        : typeof body?.continueMessageId === "string" && body.continueMessageId.trim()
          ? body.continueMessageId.trim()
          : "";
    if (anchorId) {
      const anchor = messages.find((message) => message?.id === anchorId);
      const characterId = typeof anchor?.characterId === "string" ? anchor.characterId.trim() : "";
      if (characterId && rosterIds.includes(characterId)) return { ids: [characterId], source: "anchorMessage" };
    }

    return { ids: activeCharacterIdsForChat(chat, rosterIds), source: "activeCharacters" };
  }

  function getPresenceIds(message, rosterIds) {
    const presence = getExtra(message)[PRESENCE_KEY];
    if (!presence || typeof presence !== "object" || Array.isArray(presence)) return new Set(rosterIds);
    if (presence.mode === "default") return new Set(rosterIds);
    if (Array.isArray(presence.presentCharacterIds)) {
      const roster = new Set(rosterIds);
      return new Set(presence.presentCharacterIds.map(String).filter((id) => roster.has(id)));
    }
    return new Set(rosterIds);
  }

  function buildPresencePatch(ids, rosterIds) {
    const unique = Array.from(new Set(ids.map(String))).filter((id) => rosterIds.includes(id));
    if (unique.length === rosterIds.length) return { [PRESENCE_KEY]: null };
    return {
      [PRESENCE_KEY]: {
        version: 1,
        presentCharacterIds: unique,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  async function patchMessagePresence(chatId, messageId, ids, rosterIds) {
    return api(`/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/extra`, {
      method: "PATCH",
      body: JSON.stringify(buildPresencePatch(ids, rosterIds)),
    });
  }

  async function stampMessageWithActivePresence(chatId, messageId, chat = null) {
    if (!chatId || !messageId) return;
    const resolvedChat = chat || (await getChat(chatId));
    const rosterIds = getCharacterIds(resolvedChat);
    if (!rosterIds.length) return;
    const activeIds = activeCharacterIdsForChat(resolvedChat, rosterIds);
    await patchMessagePresence(chatId, messageId, activeIds, rosterIds);
  }

  function hasStoredPresence(message) {
    return Object.prototype.hasOwnProperty.call(getExtra(message), PRESENCE_KEY);
  }

  async function bulkHidden(chatId, messageIds, hidden) {
    if (!messageIds.length) return { requested: 0, updated: 0 };
    const result = await api(`/chats/${encodeURIComponent(chatId)}/messages/bulk-hidden`, {
      method: "PATCH",
      body: JSON.stringify({ messageIds, hidden }),
    });
    const updated =
      typeof result?.updated === "number"
        ? result.updated
        : Array.isArray(result)
          ? result.length
          : Array.isArray(result?.messageIds)
            ? result.messageIds.length
            : Array.isArray(result?.updatedIds)
              ? result.updatedIds.length
              : 0;
    return { requested: messageIds.length, updated };
  }

  async function toggleSummaryEntry(chatId, entryId, enabled) {
    return api(`/chats/${encodeURIComponent(chatId)}/summary-entries`, {
      method: "PATCH",
      body: JSON.stringify({ operation: "toggle", entryId, enabled }),
    });
  }

  function getSummaryEntries(chat) {
    const entries = getMetadata(chat).summaryEntries;
    return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object") : [];
  }

  function messageVisibleByPresence(message, activeIds, rosterIds) {
    if (!activeIds.length || !rosterIds.length) return true;
    const present = getPresenceIds(message, rosterIds);
    return activeIds.some((id) => present.has(id));
  }

  function buildPresencePlan(chat, messages, body) {
    const rosterIds = getCharacterIds(chat);
    const target = generationCharacterIdsForBody(chat, rosterIds, body, messages);
    const activeIds = target.ids;
    const tokenBudget = resolveTokenBudget(chat, body);
    const scanBudget = Math.ceil(tokenBudget * SCAN_OVERAGE);
    let scannedTokens = 0;
    const hideIds = [];
    const hiddenByPresence = new Set();

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message?.id || isHiddenFromAI(message)) continue;
      scannedTokens += countRoughTokens(messageContent(message));
      const visible = messageVisibleByPresence(message, activeIds, rosterIds);
      if (!visible) {
        hideIds.push(message.id);
        hiddenByPresence.add(message.id);
      }
      if (scannedTokens > scanBudget) break;
    }

    const byId = new Map(messages.filter((message) => message?.id).map((message) => [message.id, message]));
    const disabledSummaryEntryIds = [];
    for (const entry of getSummaryEntries(chat)) {
      if (entry.enabled === false || !entry.id) continue;
      const coveredIds = Array.isArray(entry.messageIds)
        ? entry.messageIds
        : Array.isArray(entry.hiddenMessageIds)
          ? entry.hiddenMessageIds
          : [];
      const coveredMessages = coveredIds.map((id) => byId.get(id)).filter(Boolean);
      if (!coveredMessages.length) continue;
      const allHiddenForPresence = coveredMessages.every((message) => !messageVisibleByPresence(message, activeIds, rosterIds));
      if (allHiddenForPresence) disabledSummaryEntryIds.push(String(entry.id));
    }

    return {
      chatId: chat?.id || body?.chatId || "",
      hideIds: Array.from(new Set(hideIds)),
      disabledSummaryEntryIds: Array.from(new Set(disabledSummaryEntryIds)),
      targetCharacterIds: activeIds,
      targetSource: target.source,
      tokenBudget,
      scannedTokens,
    };
  }

  async function preparePresenceRun(body) {
    const chatId = body?.chatId || readActiveChatId();
    log("preparePresenceRun called", {
      chatId,
      forCharacterId: body?.forCharacterId || null,
      regenerateMessageId: body?.regenerateMessageId || null,
      continueMessageId: body?.continueMessageId || null,
      impersonate: body?.impersonate === true,
    });
    if (!chatId) {
      log("prepare skipped: no chatId");
      return null;
    }
    if (body?.impersonate) {
      log("prepare skipped: unsupported generation mode");
      return null;
    }

    const [chat, messages] = await Promise.all([getChat(chatId), getMessages(chatId)]);
    if (!chat) {
      log("prepare skipped: missing chat or messages", { hasChat: Boolean(chat), messages: messages.length });
      return null;
    }
    const rosterIds = getCharacterIds(chat);
    const stampPresenceIds = activeCharacterIdsForChat(chat, rosterIds);
    const plan = buildPresencePlan(chat, messages, body || {});
    const applied = {
      chatId,
      hiddenMessageIds: [],
      hiddenMessageUpdateCount: 0,
      disabledSummaryEntryIds: [],
      preMessageIds: new Set(messages.filter((message) => message?.id).map((message) => String(message.id))),
      rosterIds,
      stampPresenceIds,
    };

    try {
      for (const entryId of plan.disabledSummaryEntryIds) {
        await toggleSummaryEntry(chatId, entryId, false);
        applied.disabledSummaryEntryIds.push(entryId);
      }
      if (plan.hideIds.length) {
        const result = await bulkHidden(chatId, plan.hideIds, true);
        if (result.updated <= 0) {
          warn("bulk hide did not update any messages", { chatId, requested: result.requested, sample: plan.hideIds.slice(0, 5) });
        }
        applied.hiddenMessageIds = plan.hideIds;
        applied.hiddenMessageUpdateCount = result.updated;
      }
      log("generation presence plan", {
        chatId,
        targets: plan.targetCharacterIds,
        targetSource: plan.targetSource,
        plannedHideMessages: plan.hideIds.length,
        plannedDisableSummaries: plan.disabledSummaryEntryIds.length,
        hiddenMessages: applied.hiddenMessageIds.length,
        hiddenMessagesServerUpdated: applied.hiddenMessageUpdateCount,
        disabledSummaries: applied.disabledSummaryEntryIds.length,
        stampPresenceIds: applied.stampPresenceIds,
        preMessageCount: applied.preMessageIds.size,
        tokenBudget: plan.tokenBudget,
        scannedTokens: plan.scannedTokens,
      });
      return applied;
    } catch (error) {
      warn("failed to apply presence visibility; restoring partial changes", error);
      await cleanupPresenceRun(applied).catch((cleanupError) => warn("presence cleanup after failed prepare failed", cleanupError));
      throw error;
    }
  }

  async function cleanupPresenceRun(run) {
    if (!run?.chatId) return;
    const errors = [];
    if (run.disabledSummaryEntryIds?.length) {
      for (const entryId of run.disabledSummaryEntryIds) {
        await toggleSummaryEntry(run.chatId, entryId, true).catch((error) => errors.push(error));
      }
    }
    if (run.hiddenMessageIds?.length) {
      await bulkHidden(run.chatId, run.hiddenMessageIds, false).catch((error) => errors.push(error));
    }
    if (errors.length) throw errors[0];
  }

  async function stampNewGenerationMessages(run) {
    if (!run?.chatId || !run?.preMessageIds || !run?.rosterIds?.length) return;
    const stampIds = Array.isArray(run.stampPresenceIds) && run.stampPresenceIds.length ? run.stampPresenceIds : run.rosterIds;
    const messages = await getMessages(run.chatId);
    const created = messages.filter((message) => {
      if (!message?.id || run.preMessageIds.has(String(message.id))) return false;
      if (hasStoredPresence(message)) return false;
      return message.role === "user" || message.role === "assistant";
    });
    if (!created.length) return;
    await patchMessagesInBatches(
      created.map((message) => async () => {
        await patchMessagePresence(run.chatId, String(message.id), stampIds, run.rosterIds);
      }),
    );
    log("stamped generated turn messages", {
      chatId: run.chatId,
      count: created.length,
      ids: created.map((message) => message.id).slice(0, 8),
      stampPresenceIds: stampIds,
    });
  }

  async function finalizePresenceRun(run) {
    try {
      await stampNewGenerationMessages(run);
    } catch (error) {
      warn("failed to stamp generated turn messages", error);
    } finally {
      await cleanupPresenceRun(run);
    }
  }

  function startSharedGeneration(chatId, body) {
    if (!chatId) return null;
    const id = `presence:generate:${chatId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let generation = null;
    let operation = null;
    try {
      generation = factoryGeneration()?.start?.({
        id,
        chatId,
        route: "generate",
        source: EXTENSION_NAME,
        body,
      }) || null;
    } catch {}
    try {
      operation = factoryOperations()?.start?.({
        id,
        source: EXTENSION_NAME,
        kind: "generation",
        label: "Presence generation",
        reason: "presence:generate",
        detail: {
          chatId,
          forCharacterId: body?.forCharacterId || "",
          regenerateMessageId: body?.regenerateMessageId || "",
          continueMessageId: body?.continueMessageId || "",
        },
        wakeLock: {
          id,
          source: EXTENSION_NAME,
          reason: "presence:generate",
        },
      }) || null;
    } catch {}
    if (!generation && !operation) return null;
    return { id, generation, operation, closed: false };
  }

  function finishSharedGeneration(shared, status = "finished", error = null, options = {}) {
    if (!shared || shared.closed) return;
    shared.closed = true;
    try {
      if (options.finishGeneration !== false && shared.generation) {
        if (status === "failed") shared.generation.fail?.(error);
        else if (status === "cancelled") shared.generation.abort?.();
        else shared.generation.finish?.();
      }
    } catch {}
    try {
      if (shared.operation) {
        if (status === "failed") shared.operation.fail?.(error);
        else if (status === "cancelled") shared.operation.cancel?.();
        else shared.operation.finish?.();
      }
    } catch {}
  }

  function parseSsePayloads(text, final = false) {
    const parsedByFactory = factorySse()?.parsePayloads?.(text, final);
    if (parsedByFactory) return parsedByFactory;
    const parts = text.split(/\n\n/);
    const rest = final ? "" : parts.pop() || "";
    return {
      rest,
      payloads: parts
        .map((frame) =>
          frame
            .split(/\r?\n/)
            .map((line) => (line.startsWith("data:") ? line.slice(5).trimStart() : ""))
            .filter(Boolean)
            .join("\n"),
        )
        .filter(Boolean),
    };
  }

  function handleSsePayloadForPresence(chatId, payload, sharedGeneration = null) {
    const event = factorySse()?.parseEventPayload?.(payload) || (() => {
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    })();
    if (!event) return;
    if (sharedGeneration?.generation?.event) {
      sharedGeneration.generation.event(event);
    } else {
      factoryMessages()?.handleSseEvent?.(chatId, event, { source: EXTENSION_NAME });
    }
    if (event?.type === "done") {
      finishSharedGeneration(sharedGeneration, "finished", null, { finishGeneration: false });
    } else if (event?.type === "aborted") {
      finishSharedGeneration(sharedGeneration, "cancelled", null, { finishGeneration: false });
    } else if (event?.type === "error") {
      finishSharedGeneration(sharedGeneration, "failed", event?.data || event, { finishGeneration: false });
    }
    if (event?.type !== "message_saved") return;
    const messageId = event.data?.id || event.data?.messageId;
    if (!messageId) return;
    stampMessageWithActivePresence(chatId, String(messageId)).catch((error) => warn("failed to stamp generated message presence", error));
  }

  function wrapStreamingResponse(response, chatId, onDone, sharedGeneration = null) {
    const isSse = factorySse()?.isSseResponse?.(response)
      || Boolean(response?.body && String(response.headers?.get?.("content-type") || "").includes("text/event-stream"));
    if (!isSse) {
      finishSharedGeneration(sharedGeneration, response?.ok === false ? "failed" : "finished");
      return response;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let cleaned = false;
    const cleanupOnce = () => {
      if (cleaned) return;
      cleaned = true;
      Promise.resolve(onDone()).catch((error) => warn("presence cleanup failed", error));
    };
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            const parsed = parseSsePayloads(buffer, true);
            for (const payload of parsed.payloads) handleSsePayloadForPresence(chatId, payload, sharedGeneration);
            cleanupOnce();
            finishSharedGeneration(sharedGeneration, "finished", null, { finishGeneration: false });
            controller.close();
            return;
          }
          const text = decoder.decode(value, { stream: true });
          buffer += text;
          const parsed = parseSsePayloads(buffer);
          buffer = parsed.rest;
          for (const payload of parsed.payloads) handleSsePayloadForPresence(chatId, payload, sharedGeneration);
          controller.enqueue(value);
        } catch (error) {
          cleanupOnce();
          finishSharedGeneration(sharedGeneration, "failed", error);
          controller.error(error);
        }
      },
      cancel(reason) {
        cleanupOnce();
        finishSharedGeneration(sharedGeneration, "cancelled", reason);
        return reader.cancel(reason);
      },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  async function handleGenerate(input, init, body, nextFetch = baseFetch, options = {}) {
    const fetchNext = typeof nextFetch === "function" ? nextFetch : baseFetch;
    const chatIdForTracking = body?.chatId || readActiveChatId() || "";
    const sharedGeneration = options.trackSharedGeneration === true ? startSharedGeneration(chatIdForTracking, body || {}) : null;
    log("handleGenerate called", {
      chatId: chatIdForTracking || null,
      forCharacterId: body?.forCharacterId || null,
      hasNextFetch: typeof nextFetch === "function",
    });
    let run = null;
    try {
      run = await preparePresenceRun(body);
    } catch (error) {
      warn("continuing generation without presence filtering", error);
    }

    let response;
    try {
      response = await fetchNext(input, withPresenceSkip(init));
    } catch (error) {
      if (run) await cleanupPresenceRun(run).catch((cleanupError) => warn("presence cleanup failed", cleanupError));
      finishSharedGeneration(sharedGeneration, "failed", error);
      throw error;
    }

    const chatId = run?.chatId || body?.chatId || readActiveChatId();
    if (!run) {
      if (chatId) return wrapStreamingResponse(response, chatId, async () => {}, sharedGeneration);
      finishSharedGeneration(sharedGeneration, response?.ok === false ? "failed" : "finished");
      return response;
    }
    const isSse = factorySse()?.isSseResponse?.(response)
      || Boolean(response?.body && String(response.headers?.get?.("content-type") || "").includes("text/event-stream"));
    if (!isSse) {
      await finalizePresenceRun(run).catch((error) => warn("presence cleanup failed", error));
      finishSharedGeneration(sharedGeneration, response?.ok === false ? "failed" : "finished");
      return response;
    }
    return wrapStreamingResponse(response, run.chatId, () => finalizePresenceRun(run), sharedGeneration);
  }

  async function handleCreateMessage(input, init, chatId, nextFetch = baseFetch) {
    const fetchNext = typeof nextFetch === "function" ? nextFetch : baseFetch;
    const response = await fetchNext(input, init);
    await factoryMessages()?.trackCreateResponse?.(chatId, response, { source: EXTENSION_NAME });
    if (!response.ok) return response;
    let message = null;
    try {
      message = await response.clone().json();
    } catch {
      message = null;
    }
    const messageId = message?.id || message?.message?.id || message?.data?.id;
    if (messageId) {
      stampMessageWithActivePresence(chatId, String(messageId)).catch((error) => warn("failed to stamp saved message presence", error));
    }
    return response;
  }

  function installGenerateInterceptor() {
    if (state.fetchInterceptorRegistrations.length || state.legacyFetchInstalled) return;
    state.originalFetch = factoryFetch()?.fetchOriginal || window.fetch.bind(window);
    const fetchHub = factoryFetch();
    if (fetchHub?.intercepts?.register) {
      state.fetchInterceptorRegistrations.push(
        fetchHub.intercepts.register({
          id: "presence:fetch-message-create",
          route: "message:create",
          priority: 40,
          handler: async (context, next) => {
            const chatId = context.route?.chatId || "";
            if (context.method !== "POST" || !chatId) return next();
            return handleCreateMessage(context.input, context.init, chatId, next);
          },
        }),
      );
      state.fetchInterceptorRegistrations.push(
        fetchHub.intercepts.register({
          id: "presence:fetch-generate",
          route: "generate",
          priority: 40,
          handler: async (context, next) => {
            if (context.init?.__marinaraPresenceHandled === true) {
              return next(context.input, stripPresenceInternalInit(context.init));
            }
            if (context.method !== "POST" || context.route?.route !== "generate") return next();
            return handleGenerate(context.input, context.init, context.body || {}, next, { trackSharedGeneration: true });
          },
        }),
      );
      return;
    }

    state.legacyFetchInstalled = true;
    window.fetch = async (input, init = {}) => {
      if (init?.__marinaraPresenceHandled === true) {
        return baseFetch(input, stripPresenceInternalInit(init));
      }
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(init?.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
      const createMessageChatId = method === "POST" ? parseCreateMessageUrl(url) : "";
      if (createMessageChatId) return handleCreateMessage(input, init, createMessageChatId, baseFetch);
      if (method !== "POST" || !isGenerateUrl(url)) return baseFetch(input, init);
      const groupSmartOrder = alDente()?.services?.get?.("group-smart-order") || window.__marinaraGroupSmartOrder;
      if (groupSmartOrder?.presenceCompatibility === true) {
        log("generate intercepted but deferred to compatible GSO");
        return baseFetch(input, init);
      }
      let body = null;
      try {
        body = typeof init.body === "string" ? JSON.parse(init.body) : null;
      } catch {
        body = null;
      }
      return handleGenerate(input, init, body || {}, baseFetch, { trackSharedGeneration: true });
    };
  }

  function showToast(message, tone = "info") {
    let toast = document.querySelector(`.${TOAST_CLASS}`);
    if (!toast) {
      toast = document.createElement("div");
      toast.className = TOAST_CLASS;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function positionPopover(anchor, popover) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(320, window.innerWidth - 16);
    const viewportHeight = window.innerHeight;
    const availableBelow = viewportHeight - rect.bottom - margin;
    const availableAbove = rect.top - margin;
    const preferAbove = availableBelow < 180 && availableAbove > availableBelow;
    const maxHeight = Math.max(140, Math.floor((preferAbove ? availableAbove : availableBelow) - margin));
    const measuredHeight = popover.offsetHeight || 240;
    const top = preferAbove
      ? Math.max(margin, rect.top - Math.min(measuredHeight, maxHeight) - margin)
      : Math.min(rect.bottom + margin, viewportHeight - margin - Math.min(measuredHeight, maxHeight));
    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${maxHeight}px`;
    popover.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    popover.style.top = `${top}px`;
  }

  async function openPresencePopover(anchor, messageId) {
    closePopover();
    const openSeq = ++state.popoverOpenSeq;
    const chatId = readActiveChatId();
    if (!chatId) return showToast("No active chat.", "error");
    const popover = document.createElement("div");
    popover.className = POPOVER_CLASS;
    popover.innerHTML = `<div class="mp-loading">Loading presence...</div>`;
    document.body.appendChild(popover);
    state.popover = popover;
    state.popoverMessageId = messageId;
    positionPopover(anchor, popover);

    try {
      const [chat, messages] = await Promise.all([getChat(chatId), getMessages(chatId)]);
      const roster = await getRoster(chat);
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      const rosterIds = roster.map((character) => character.id);
      const message = messages.find((item) => item.id === messageId);
      if (!message) throw new Error("Message not found.");
      const present = getPresenceIds(message, rosterIds);
      renderPopover(popover, { chatId, messageId, roster, present, rosterIds, openSeq });
      positionPopover(anchor, popover);
    } catch (error) {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      popover.innerHTML = `<div class="mp-error">${escapeHtml(error?.message || "Could not load presence.")}</div>`;
    }
  }

  function isCurrentPopover(popover, chatId, messageId, openSeq) {
    return (
      state.popover === popover &&
      popover?.isConnected &&
      state.popoverMessageId === messageId &&
      state.popoverOpenSeq === openSeq &&
      readActiveChatId() === chatId
    );
  }

  function renderPopover(popover, context) {
    const { chatId, messageId, roster, present, rosterIds, openSeq } = context;
    popover.innerHTML = `
      <div class="mp-head">
        <strong>Presence</strong>
        <button type="button" class="mp-close" title="Close presence">x</button>
      </div>
      <div class="mp-list">
        ${roster
          .map(
            (character) => `
              <label class="mp-row">
                <input type="checkbox" value="${escapeHtml(character.id)}" ${present.has(character.id) ? "checked" : ""}>
                <span>${escapeHtml(character.name || character.id)}</span>
              </label>
            `,
          )
          .join("") || `<div class="mp-empty">No chat characters found.</div>`}
      </div>
      <div class="mp-actions">
        <button type="button" data-action="all">Everyone</button>
        <button type="button" data-action="none">Nobody</button>
      </div>
    `;
    popover.querySelector(".mp-close")?.addEventListener("click", closePopover);
    const patchCurrentPopoverPresence = async (ids, successMessage) => {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      await patchMessagePresence(chatId, messageId, ids, rosterIds);
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      showToast(successMessage);
    };
    popover.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.addEventListener("change", async () => {
        if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
        const ids = Array.from(popover.querySelectorAll("input[type='checkbox']:checked")).map((item) => item.value);
        await patchCurrentPopoverPresence(ids, "Presence updated.");
      });
    });
    popover.querySelector("[data-action='all']")?.addEventListener("click", async () => {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      popover.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = true;
      });
      await patchCurrentPopoverPresence(rosterIds, "Everyone marked present.");
    });
    popover.querySelector("[data-action='none']")?.addEventListener("click", async () => {
      if (!isCurrentPopover(popover, chatId, messageId, openSeq)) return;
      popover.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = false;
      });
      await patchCurrentPopoverPresence([], "Nobody marked present.");
    });
  }

  function closePopover() {
    state.popoverOpenSeq += 1;
    if (state.popover?.isConnected) state.popover.remove();
    state.popover = null;
    state.popoverMessageId = "";
  }

  function ensureMessageButtons() {
    if (state.disposed) return;
    const rows = Array.from(document.querySelectorAll(".mari-message[data-message-id]"));
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      if (row.querySelector(`.${BUTTON_CLASS}`)) continue;
      const actions = row.querySelector(".mari-message-actions");
      if (!actions) continue;
      const messageId = row.getAttribute("data-message-id");
      if (!messageId) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = BUTTON_CLASS;
      button.title = "Edit presence";
      button.setAttribute("aria-label", "Edit presence");
      button.textContent = "P";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const currentMessageId = button.closest(".mari-message[data-message-id]")?.getAttribute("data-message-id") || messageId;
        openPresencePopover(button, currentMessageId);
      });
      actions.appendChild(button);
    }
  }

  function scheduleButtonScan() {
    if (state.scanTimer) return;
    state.scanTimer = window.setTimeout(() => {
      state.scanTimer = null;
      ensureMessageButtons();
    }, 80);
  }

  function parseCommandTokens(text) {
    const parsedByFactory = factoryCommands()?.parseTokens?.(text);
    if (Array.isArray(parsedByFactory)) return parsedByFactory;
    const tokens = [];
    const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
    let match;
    while ((match = re.exec(text))) {
      tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1"));
    }
    return tokens;
  }

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function resolveCharacterToken(token, roster) {
    const normalized = normalizeName(token);
    if (["all", "everyone", "*"].includes(normalized)) return roster;
    const exact = roster.filter((character) => normalizeName(character.name) === normalized || normalizeName(character.id) === normalized);
    if (exact.length === 1) return exact;
    const fuzzy = roster.filter((character) => normalizeName(character.name).includes(normalized));
    if (fuzzy.length === 1) return fuzzy;
    if (exact.length || fuzzy.length) throw new Error(`Character name is ambiguous: ${token}`);
    throw new Error(`Character not found: ${token}`);
  }

  function selectRange(messages, tokens) {
    const joined = tokens.join(" ").trim().toLowerCase();
    if (!joined) throw new Error("Range is required.");
    if (joined === "all") return messages;
    if (tokens[0]?.toLowerCase() === "last") {
      const n = Math.max(0, Math.floor(Number(tokens[1])));
      if (!n) throw new Error("Use /presence ... last <number>.");
      return messages.slice(-n);
    }
    if (tokens[0]?.toLowerCase() === "from" && tokens[2]?.toLowerCase() === "to") {
      return selectIndexRange(messages, Number(tokens[1]), Number(tokens[3]));
    }
    const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dash) return selectIndexRange(messages, Number(dash[1]), Number(dash[2]));
    const single = Number(joined);
    if (Number.isInteger(single) && single > 0) return selectIndexRange(messages, single, single);
    throw new Error(`Unsupported range: ${tokens.join(" ")}`);
  }

  function selectIndexRange(messages, start, end) {
    const a = Math.max(1, Math.min(start, end));
    const b = Math.min(messages.length, Math.max(start, end));
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > messages.length) throw new Error("Range is outside the loaded chat.");
    return messages.slice(a - 1, b);
  }

  async function patchMessagesInBatches(tasks) {
    let index = 0;
    const workers = Array.from({ length: Math.min(PATCH_CONCURRENCY, tasks.length) }, async () => {
      while (index < tasks.length) {
        const task = tasks[index++];
        await task();
      }
    });
    await Promise.all(workers);
  }

  async function runPresenceCommand(raw) {
    const tokens = parseCommandTokens(raw.replace(/^\/presence\b/i, "").trim());
    const action = tokens.shift()?.toLowerCase();
    if (!["set", "unset", "remove"].includes(action)) {
      throw new Error("Usage: /presence <set|unset> <character> <range>");
    }
    const charToken = tokens.shift();
    if (!charToken) throw new Error("Character name is required.");
    const chatId = readActiveChatId();
    if (!chatId) throw new Error("No active chat.");

    const [chat, messages] = await Promise.all([getChat(chatId), getMessages(chatId)]);
    const roster = await getRoster(chat);
    const rosterIds = roster.map((character) => character.id);
    if (!rosterIds.length) throw new Error("This chat has no character roster.");
    const targets = resolveCharacterToken(charToken, roster);
    const targetIds = new Set(targets.map((character) => character.id));
    const selected = selectRange(messages, tokens).filter((message) => message?.id);
    if (!selected.length) throw new Error("No messages matched that range.");

    await patchMessagesInBatches(
      selected.map((message) => async () => {
        const present = getPresenceIds(message, rosterIds);
        if (action === "set") {
          for (const id of targetIds) present.add(id);
        } else {
          for (const id of targetIds) present.delete(id);
        }
        await patchMessagePresence(chatId, message.id, Array.from(present), rosterIds);
      }),
    );
    showToast(`Presence ${action}: ${targets.map((c) => c.name).join(", ")} across ${selected.length} message(s).`);
  }

  function findInputRoot() {
    return Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input"))
      .filter((el) => el instanceof HTMLElement && el.querySelector("textarea.mari-chat-input-textarea, textarea"))
      .find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
  }

  function clearTextarea(textarea) {
    textarea.value = "";
    textarea.style.height = "auto";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
  }

  function consumePresenceCommandFromTextarea(textarea, event) {
    const value = textarea?.value || "";
    if (!/^\/presence(?:\s|$)/i.test(value.trim())) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    const raw = value.trim();
    clearTextarea(textarea);
    runPresenceCommand(raw).catch((error) => {
      showToast(error?.message || "Presence command failed.", "error");
      warn("presence command failed", error);
    });
    return true;
  }

  function installCommandInterceptors() {
    addListener(
      document,
      "keydown",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement)) return;
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
        consumePresenceCommandFromTextarea(target, event);
      },
      true,
    );
    addListener(
      document,
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest("button.mari-chat-send-btn, button[title='Send'], button[aria-label='Send']");
        if (!button) return;
        const root = findInputRoot();
        const textarea = root?.querySelector("textarea.mari-chat-input-textarea, textarea");
        if (textarea) consumePresenceCommandFromTextarea(textarea, event);
      },
      true,
    );
  }

  function addListener(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    state.cleanups.push(() => target.removeEventListener(event, handler, options));
  }

  function installStyles() {
    const css = `
      .${BUTTON_CLASS} {
        width: 1.45em;
        height: 1.45em;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid color-mix(in srgb, var(--marinara-chat-chrome-button-border-active, var(--border)) 45%, transparent);
        border-radius: 0.35rem;
        background: transparent;
        color: var(--marinara-chat-chrome-button-text, var(--muted-foreground));
        font-size: 0.72rem;
        font-weight: 800;
        line-height: 1;
        padding: 0;
      }
      .${BUTTON_CLASS}:hover {
        background: var(--marinara-chat-chrome-highlight-bg-hover, var(--accent));
        color: var(--marinara-chat-chrome-button-text-hover, var(--foreground));
      }
      .${POPOVER_CLASS} {
        position: fixed;
        z-index: 10000;
        max-height: min(28rem, calc(100vh - 2rem));
        overflow: auto;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--popover, var(--background));
        color: var(--popover-foreground, var(--foreground));
        box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 0.32);
        padding: 0.55rem;
        font-size: 0.78rem;
      }
      .${POPOVER_CLASS} .mp-head,
      .${POPOVER_CLASS} .mp-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.4rem;
      }
      .${POPOVER_CLASS} .mp-head {
        margin-bottom: 0.45rem;
      }
      .${POPOVER_CLASS} button {
        border: 1px solid var(--border);
        border-radius: 0.35rem;
        background: var(--secondary);
        color: var(--foreground);
        padding: 0.25rem 0.45rem;
        font-size: 0.72rem;
      }
      .${POPOVER_CLASS} .mp-close {
        width: 1.45rem;
        height: 1.45rem;
        padding: 0;
      }
      .${POPOVER_CLASS} .mp-list {
        display: grid;
        gap: 0.25rem;
        margin-bottom: 0.5rem;
      }
      .${POPOVER_CLASS} .mp-row {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        min-width: 0;
        border-radius: 0.35rem;
        padding: 0.25rem 0.2rem;
      }
      .${POPOVER_CLASS} .mp-row:hover {
        background: var(--accent);
      }
      .${POPOVER_CLASS} .mp-row span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${POPOVER_CLASS} .mp-loading,
      .${POPOVER_CLASS} .mp-error,
      .${POPOVER_CLASS} .mp-empty {
        color: var(--muted-foreground);
        padding: 0.25rem;
      }
      .${POPOVER_CLASS} .mp-error {
        color: var(--destructive);
      }
      .${TOAST_CLASS} {
        position: fixed;
        right: 1rem;
        bottom: 1rem;
        z-index: 10001;
        max-width: min(24rem, calc(100vw - 2rem));
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--popover, var(--background));
        color: var(--popover-foreground, var(--foreground));
        box-shadow: 0 0.8rem 2rem rgb(0 0 0 / 0.25);
        padding: 0.55rem 0.7rem;
        font-size: 0.78rem;
      }
      .${TOAST_CLASS}[hidden] {
        display: none;
      }
      .${TOAST_CLASS}[data-tone="error"] {
        border-color: color-mix(in srgb, var(--destructive) 55%, var(--border));
        color: var(--destructive);
      }
    `;
    if (typeof marinara !== "undefined" && marinara?.addStyle) marinara.addStyle(css);
    else {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function install() {
    state.disposed = false;
    installStyles();
    installGenerateInterceptor();
    try {
      state.extensionRegistration = alDente()?.registerExtension?.({
        id: "presence",
        name: EXTENSION_NAME,
        version: "0.1.0",
        capabilities: [
          "fetch-interceptor",
          "generation-monitor",
          "message-tracking",
          "presence-filtering",
          "presence-command",
          "shared-command",
          "character-parser",
        ],
      }) || null;
    } catch {}
    try {
      state.serviceRegistration = alDente()?.services?.register?.("presence", {
        version: "0.1.0",
        generateWithPresence: (input, init, body, nextFetch) => handleGenerate(input, init || {}, body || {}, nextFetch || baseFetch),
        getDebug: () => state.debug,
        setDebug: (enabled) => {
          state.debug = enabled === true;
          localStorage.setItem(DEBUG_STORAGE_KEY, state.debug ? "true" : "false");
          console.info(`[${EXTENSION_NAME}] debug ${state.debug ? "enabled" : "disabled"}`);
          return state.debug;
        },
        runPresenceCommand,
      }, {
        owner: EXTENSION_NAME,
        version: "0.1.0",
        capabilities: ["generation-presence", "message-presence", "commands"],
      }) || null;
    } catch {}
    try {
      state.commandRegistration = factoryCommands()?.register?.({
        id: "presence:command",
        name: "presence",
        source: EXTENSION_NAME,
        description: "Set or unset per-message character presence.",
        handler: async ({ raw }) => {
          try {
            await runPresenceCommand(raw);
          } catch (error) {
            showToast(error?.message || "Presence command failed.", "error");
            warn("presence command failed", error);
            throw error;
          }
        },
      }) || null;
    } catch {}
    if (!state.commandRegistration) installCommandInterceptors();
    ensureMessageButtons();
    state.observer = new MutationObserver(scheduleButtonScan);
    if (document.body) state.observer.observe(document.body, { childList: true, subtree: true });
    addListener(document, "mousedown", (event) => {
      if (!state.popover) return;
      if (event.target instanceof Node && state.popover.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(`.${BUTTON_CLASS}`)) return;
      closePopover();
    });
    log("installed");
  }

  function uninstall() {
    state.disposed = true;
    for (const registration of state.fetchInterceptorRegistrations.splice(0)) {
      try {
        registration?.unregister?.();
      } catch {}
    }
    try { state.serviceRegistration?.unregister?.(); } catch {}
    state.serviceRegistration = null;
    try { state.commandRegistration?.unregister?.(); } catch {}
    state.commandRegistration = null;
    try { state.extensionRegistration?.unregister?.(); } catch {}
    state.extensionRegistration = null;
    if (state.legacyFetchInstalled && state.originalFetch) {
      window.fetch = state.originalFetch;
    }
    state.legacyFetchInstalled = false;
    state.originalFetch = null;
    if (state.observer) state.observer.disconnect();
    state.observer = null;
    if (state.scanTimer) window.clearTimeout(state.scanTimer);
    state.scanTimer = null;
    for (const cleanup of state.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {}
    }
    closePopover();
    document.querySelectorAll(`.${BUTTON_CLASS}, .${TOAST_CLASS}`).forEach((el) => el.remove());
    state.chatCache.clear();
    state.characterCache.clear();
    if (window.__marinaraPresence?.uninstall === uninstall) {
      delete window.__marinaraPresence;
    }
  }

  install();
  if (typeof marinara !== "undefined" && marinara?.onCleanup) marinara.onCleanup(uninstall);
  window.__marinaraPresence = {
    version: "0.1.0",
    generateWithPresence: (input, init, body, nextFetch) => handleGenerate(input, init || {}, body || {}, nextFetch || baseFetch),
    getDebug: () => state.debug,
    setDebug: (enabled) => {
      state.debug = enabled === true;
      localStorage.setItem(DEBUG_STORAGE_KEY, state.debug ? "true" : "false");
      console.info(`[${EXTENSION_NAME}] debug ${state.debug ? "enabled" : "disabled"}`);
      return state.debug;
    },
    uninstall,
    runPresenceCommand,
  };
  window.dispatchEvent(new CustomEvent("marinara-extension-ready", { detail: { name: EXTENSION_NAME } }));
})();
