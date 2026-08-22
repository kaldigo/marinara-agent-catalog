function normalizeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new TypeError(`Mari Bridge ${label} must be a stable lowercase identifier`);
  }
  return normalized;
}

export function createAgentResultRegistry() {
  const registrations = new Map();

  function register(ownerId, input = {}) {
    const id = normalizeId(input.id, "agent-result registration id");
    const resultType = normalizeId(input.resultType, "agent result type");
    const agentTypes = Object.freeze(
      [...new Set((input.agentTypes ?? []).map((value) => normalizeId(value, "agent type")))].sort(),
    );
    if (agentTypes.length === 0) throw new TypeError("Mari Bridge agent-result registrations require agentTypes");
    if (typeof input.apply !== "function") throw new TypeError("Mari Bridge agent-result registrations require apply");
    const key = `${ownerId}:${id}`;
    if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge agent-result registration ${key}`);
    const collision = [...registrations.values()].find((registration) => registration.resultType === resultType);
    if (collision) {
      throw new Error(
        `Mari Bridge result type ${resultType} is already owned by ${collision.ownerId}:${collision.id}`,
      );
    }
    registrations.set(key, Object.freeze({ ownerId, id, resultType, agentTypes, apply: input.apply }));
    return () => registrations.delete(key);
  }

  function find(resultType, agentType) {
    return [...registrations.values()].find(
      (registration) => registration.resultType === resultType && registration.agentTypes.includes(agentType),
    );
  }

  return Object.freeze({
    register,
    hasResultType(value) {
      const resultType = String(value ?? "").trim();
      return [...registrations.values()].some((registration) => registration.resultType === resultType);
    },
    async apply(scope = {}) {
      const result = scope.result;
      if (!result?.success) return Object.freeze({ handled: false });
      const registration = find(String(result.type ?? ""), String(result.agentType ?? ""));
      if (!registration) return Object.freeze({ handled: false });
      try {
        const value = await registration.apply(Object.freeze({ ...scope, ownerId: registration.ownerId }));
        return Object.freeze({ handled: true, value: value ?? null });
      } catch (error) {
        scope.logger?.error?.(
          error,
          `[mari-bridge] ${registration.ownerId}:${registration.id} failed to apply ${registration.resultType}`,
        );
        return Object.freeze({
          handled: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    snapshot() {
      return Object.freeze(
        [...registrations.values()].map(({ apply: _apply, ...registration }) => Object.freeze(registration)),
      );
    },
    clear() {
      registrations.clear();
    },
  });
}
