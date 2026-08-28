function compare(left, right) {
  return left.order - right.order || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id);
}

export function createAgentPromptRegistry() {
  const registrations = new Map();

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const agentTypes = new Set((input.agentTypes ?? []).map((value) => String(value).trim()).filter(Boolean));
      if (!id || agentTypes.size === 0 || (typeof input.content !== "string" && typeof input.extend !== "function")) {
        throw new TypeError("Mari Bridge agent prompt registration requires id, agentTypes, and content or extend");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge agent prompt registration ${key}`);
      const registration = Object.freeze({
        ownerId,
        id,
        agentTypes,
        order: Number.isFinite(input.order) ? Number(input.order) : 0,
        content: typeof input.content === "string" ? input.content.trim() : null,
        extend: typeof input.extend === "function" ? input.extend : null,
      });
      registrations.set(key, registration);
      return () => registrations.delete(key);
    },
    async extend(agentType, template, context = {}) {
      let current = String(template ?? "");
      for (const registration of [...registrations.values()].filter((item) => item.agentTypes.has(agentType)).sort(compare)) {
        const addition = registration.extend
          ? await registration.extend(Object.freeze({ agentType, template: current, context }))
          : registration.content;
        if (typeof addition === "string" && addition.trim()) current = [current.trimEnd(), addition.trim()].filter(Boolean).join("\n\n");
      }
      return current;
    },
    snapshot() {
      return [...registrations.values()].sort(compare).map((item) => Object.freeze({
        ownerId: item.ownerId,
        id: item.id,
        agentTypes: Object.freeze([...item.agentTypes].sort()),
        order: item.order,
      }));
    },
    clear() {
      registrations.clear();
    },
  });
}
