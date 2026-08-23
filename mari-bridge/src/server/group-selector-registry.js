function activeAgentIds(metadata) {
  const value = typeof metadata === "string" ? parseJson(metadata) : metadata;
  if (!value || typeof value !== "object" || value.enableAgents !== true) return [];
  return Array.isArray(value.activeAgentIds) ? value.activeAgentIds.map(String) : [];
}

function parseJson(value) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

export function createGroupSelectorRegistry() {
  const registrations = new Map();

  function active(scope) {
    const ids = new Set(activeAgentIds(scope?.chatMetadata));
    return [...registrations.values()]
      .filter((item) => item.agentTypes.some((agentType) => ids.has(agentType)))
      .sort((left, right) => right.priority - left.priority || left.ownerId.localeCompare(right.ownerId));
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const agentTypes = [...new Set((input.agentTypes ?? []).map(String).map((value) => value.trim()).filter(Boolean))];
      if (!id || agentTypes.length === 0 || typeof input.select !== "function") {
        throw new TypeError("Group selector registration requires id, agentTypes, and select");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate group selector ${key}`);
      registrations.set(key, Object.freeze({
        ownerId,
        id,
        agentTypes: Object.freeze(agentTypes),
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        select: input.select,
      }));
      return () => registrations.delete(key);
    },
    resolvePolicy(scope, fallback) {
      return active(scope).length > 0
        ? Object.freeze({ groupChatMode: "individual", groupResponseOrder: "smart" })
        : fallback;
    },
    async select(scope, fallback) {
      for (const registration of active(scope)) {
        const selected = await registration.select(scope);
        if (Array.isArray(selected) && selected.length > 0) return selected;
      }
      return fallback();
    },
    snapshot() {
      return Object.freeze([...registrations.values()].map((item) => Object.freeze({
        ownerId: item.ownerId,
        id: item.id,
        agentTypes: item.agentTypes,
      })));
    },
    clear() { registrations.clear(); },
  });
}
