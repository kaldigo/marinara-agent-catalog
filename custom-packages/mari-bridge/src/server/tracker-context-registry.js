function normalizeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new TypeError(`Mari Bridge ${label} must be a stable lowercase identifier`);
  }
  return normalized;
}

function activeRegistration(registration, activeAgentIds) {
  const active = new Set((activeAgentIds ?? []).map(String));
  return registration.agentTypes.some((agentType) => active.has(agentType));
}

export function createTrackerContextRegistry() {
  const registrations = new Map();

  function register(ownerId, input = {}) {
    const id = normalizeId(input.id, "tracker-context registration id");
    const agentTypes = Object.freeze(
      [...new Set((input.agentTypes ?? []).map((value) => normalizeId(value, "agent type")))].sort(),
    );
    if (agentTypes.length === 0) throw new TypeError("Mari Bridge tracker-context registrations require agentTypes");
    if (
      typeof input.formatCommitted !== "function"
      && typeof input.formatAgentState !== "function"
      && typeof input.filterCustomTrackerFields !== "function"
    ) {
      throw new TypeError("Mari Bridge tracker-context registrations require a formatter or custom-field filter");
    }
    const key = `${ownerId}:${id}`;
    if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge tracker-context registration ${key}`);
    registrations.set(key, Object.freeze({
      ownerId,
      id,
      agentTypes,
      order: Number.isFinite(input.order) ? Number(input.order) : 0,
      formatCommitted: typeof input.formatCommitted === "function" ? input.formatCommitted : null,
      formatAgentState: typeof input.formatAgentState === "function" ? input.formatAgentState : null,
      filterCustomTrackerFields:
        typeof input.filterCustomTrackerFields === "function" ? input.filterCustomTrackerFields : null,
    }));
    return () => registrations.delete(key);
  }

  function sorted(activeAgentIds) {
    return [...registrations.values()]
      .filter((registration) => activeRegistration(registration, activeAgentIds))
      .sort((left, right) => left.order - right.order || left.ownerId.localeCompare(right.ownerId));
  }

  return Object.freeze({
    register,
    hasActive(activeAgentIds) {
      return sorted(activeAgentIds).length > 0;
    },
    appendCommittedSections(scope = {}, target = []) {
      if (!Array.isArray(target)) throw new TypeError("Mari Bridge committed tracker target must be an array");
      for (const registration of sorted(scope.activeAgentIds)) {
        if (!registration.formatCommitted) continue;
        const section = registration.formatCommitted(Object.freeze({ ...scope, ownerId: registration.ownerId }));
        const label = typeof section?.label === "string" ? section.label.trim() : "";
        const content = typeof section?.content === "string" ? section.content.trim() : "";
        if (!label || !content) continue;
        target.push(scope.wrapContent(content, label, scope.wrapFormat));
      }
      return target;
    },
    appendAgentState(scope = {}, target = {}) {
      if (!target || typeof target !== "object" || Array.isArray(target)) {
        throw new TypeError("Mari Bridge agent tracker target must be an object");
      }
      for (const registration of sorted(scope.activeAgentIds)) {
        if (!registration.formatAgentState) continue;
        const value = registration.formatAgentState(Object.freeze({ ...scope, ownerId: registration.ownerId }));
        if (value === undefined || value === null) continue;
        target[registration.id] = value;
      }
      return target;
    },
    filterCustomTrackerFields(scope = {}, fields = []) {
      if (!Array.isArray(fields)) return fields;
      let filtered = fields;
      for (const registration of sorted(scope.activeAgentIds)) {
        if (!registration.filterCustomTrackerFields) continue;
        const next = registration.filterCustomTrackerFields(
          Object.freeze({ ...scope, ownerId: registration.ownerId }),
          Object.freeze([...filtered]),
        );
        if (!Array.isArray(next)) {
          throw new TypeError(
            `Mari Bridge tracker-context custom-field filter ${registration.ownerId}:${registration.id} must return an array`,
          );
        }
        filtered = next;
      }
      return filtered;
    },
    snapshot() {
      return Object.freeze(
        [...registrations.values()].map(({
          formatCommitted: _committed,
          formatAgentState: _agent,
          filterCustomTrackerFields: _filter,
          ...value
        }) => Object.freeze(value)),
      );
    },
    clear() {
      registrations.clear();
    },
  });
}
