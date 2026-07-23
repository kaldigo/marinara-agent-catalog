const BRIDGE_KEY = Symbol.for("marinara.mariBridge.promptContribution");

export function registerPromptContributionBridge({ app, runtime, internalHeader = "x-mari-bridge-internal" }) {
  if (!app || typeof app.addHook !== "function") throw new Error("Fastify app with addHook is required.");
  const state = getPromptContributionState();
  state.internalHeaders.add(internalHeader);
  if (state.hookedApps.has(app)) return () => {};
  state.hookedApps.add(app);

  app.addHook("preHandler", async (request) => {
    if (isInternalRequest(request, state.internalHeaders)) return;
    if (String(request.method || "").toUpperCase() !== "POST") return;
    if (!/^\/api\/generate(?:[?#].*)?$/u.test(String(request.url || ""))) return;
    const body = normalizeObject(request.body);
    const chatId = typeof body.chatId === "string" ? body.chatId : "";
    if (!chatId) return;

    const resolvedAgentTypes = new Set();
    for (const contributor of state.contributors.values()) {
      let resolved;
      try {
        resolved = await contributor.resolve({ request, body, chatId, runtime });
      } catch (error) {
        runtime?.logger?.warn?.(error, "[mari-bridge] Prompt contributor %s failed", contributor.agentType);
        continue;
      }
      resolvedAgentTypes.add(contributor.agentType);
      const contribution = resolveContribution(state, chatId, contributor, resolved);
      if (!contribution) continue;
      appendAgentInjectionOverride(body, contribution);
    }
    for (const contribution of listPromptContributions(chatId)) {
      if (resolvedAgentTypes.has(contribution.agentType)) continue;
      appendAgentInjectionOverride(body, contribution);
    }
    request.body = body;
  });

  return () => {};
}

export function registerPromptContributor(contributor) {
  const agentType = typeof contributor?.agentType === "string" ? contributor.agentType.trim() : "";
  if (!agentType) throw new Error("Prompt contributor requires agentType.");
  if (typeof contributor.resolve !== "function") throw new Error("Prompt contributor requires resolve().");
  const state = getPromptContributionState();
  const entry = {
    agentType,
    agentName: typeof contributor.agentName === "string" ? contributor.agentName : agentType,
    resolve: contributor.resolve,
  };
  state.contributors.set(agentType, entry);
  return () => {
    if (state.contributors.get(agentType) === entry) state.contributors.delete(agentType);
  };
}

export function setPromptContribution(chatId, contribution) {
  const state = getPromptContributionState();
  const agentType = typeof contribution?.agentType === "string" ? contribution.agentType.trim() : "";
  if (!chatId || !agentType) return null;
  const key = contributionKey(chatId, agentType);
  if (contribution?.text === null) {
    state.lastByChatAgent.delete(key);
    return null;
  }
  const text = typeof contribution?.text === "string" ? contribution.text : "";
  if (!text.trim()) return state.lastByChatAgent.get(key) ?? null;
  const stored = {
    agentType,
    agentName: typeof contribution.agentName === "string" && contribution.agentName.trim() ? contribution.agentName : agentType,
    text,
  };
  state.lastByChatAgent.set(key, stored);
  return stored;
}

export function getPromptContribution(chatId, agentType) {
  const normalizedAgentType = typeof agentType === "string" ? agentType.trim() : "";
  if (!chatId || !normalizedAgentType) return null;
  return getPromptContributionState().lastByChatAgent.get(contributionKey(chatId, normalizedAgentType)) ?? null;
}

export function listPromptContributions(chatId) {
  const prefix = chatId ? `${chatId}:` : "";
  return Array.from(getPromptContributionState().lastByChatAgent.entries())
    .filter(([key]) => !prefix || key.startsWith(prefix))
    .map(([key, contribution]) => ({
      chatId: prefix ? chatId : key.slice(0, key.indexOf(":")),
      ...contribution,
    }));
}

export function clearPromptContribution(chatId, agentType) {
  const normalizedAgentType = typeof agentType === "string" ? agentType.trim() : "";
  if (!chatId || !normalizedAgentType) return false;
  return getPromptContributionState().lastByChatAgent.delete(contributionKey(chatId, normalizedAgentType));
}

export function appendAgentInjectionOverride(body, contribution) {
  const target = normalizeObject(body);
  const agentType = typeof contribution?.agentType === "string" ? contribution.agentType.trim() : "";
  const text = typeof contribution?.text === "string" ? contribution.text : "";
  if (!agentType || !text.trim()) return target;
  const entry = {
    agentType,
    ...(typeof contribution.agentName === "string" && contribution.agentName.trim()
      ? { agentName: contribution.agentName.trim() }
      : {}),
    text,
  };
  const current = Array.isArray(target.agentInjectionOverrides) ? target.agentInjectionOverrides : [];
  target.agentInjectionOverrides = [...current.filter((item) => normalizeObject(item).agentType !== agentType), entry];
  return target;
}

function getPromptContributionState() {
  if (!globalThis[BRIDGE_KEY]) {
    globalThis[BRIDGE_KEY] = {
      hookedApps: new WeakSet(),
      contributors: new Map(),
      internalHeaders: new Set(),
      lastByChatAgent: new Map(),
    };
  }
  return globalThis[BRIDGE_KEY];
}

function resolveContribution(state, chatId, contributor, resolved) {
  const key = contributionKey(chatId, contributor.agentType);
  if (resolved === null) {
    state.lastByChatAgent.delete(key);
    return null;
  }
  if (resolved === undefined) return state.lastByChatAgent.get(key) ?? null;
  if (typeof resolved === "object" && resolved?.text === null) {
    state.lastByChatAgent.delete(key);
    return null;
  }
  const value =
    typeof resolved === "string"
      ? { agentType: contributor.agentType, agentName: contributor.agentName, text: resolved }
      : {
          agentType: contributor.agentType,
          agentName:
            typeof resolved.agentName === "string" && resolved.agentName.trim()
              ? resolved.agentName
              : contributor.agentName,
          text: typeof resolved.text === "string" ? resolved.text : "",
        };
  if (!value.text.trim()) return state.lastByChatAgent.get(key) ?? null;
  state.lastByChatAgent.set(key, value);
  return value;
}

function contributionKey(chatId, agentType) {
  return `${chatId}:${agentType}`;
}

function isInternalRequest(request, internalHeaders) {
  for (const header of internalHeaders) {
    const value = request.headers?.[header];
    if (value === "1" || value === "true" || (Array.isArray(value) && value.includes("1"))) return true;
  }
  return false;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
