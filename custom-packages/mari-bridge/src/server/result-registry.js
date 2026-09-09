function normalizeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new TypeError(`Mari Bridge ${label} must be a stable lowercase identifier`);
  }
  return normalized;
}

export function createAgentResultRegistry() {
  const registrations = new Map();
  const sharedByResult = new WeakMap();

  function register(ownerId, input = {}) {
    const id = normalizeId(input.id, "agent-result registration id");
    const resultType = normalizeId(input.resultType, "agent result type");
    const agentTypes = Object.freeze(
      [...new Set((input.agentTypes ?? []).map((value) => normalizeId(value, "agent type")))].sort(),
    );
    if (agentTypes.length === 0) throw new TypeError("Mari Bridge agent-result registrations require agentTypes");
    if (typeof input.apply !== "function" && typeof input.expand !== "function") {
      throw new TypeError("Mari Bridge agent-result registrations require apply or expand");
    }
    const key = `${ownerId}:${id}`;
    if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge agent-result registration ${key}`);
    const collision = [...registrations.values()].find((registration) => registration.resultType === resultType);
    if (collision) {
      throw new Error(
        `Mari Bridge result type ${resultType} is already owned by ${collision.ownerId}:${collision.id}`,
      );
    }
    registrations.set(key, Object.freeze({
      ownerId,
      id,
      resultType,
      agentTypes,
      validate: typeof input.validate === "function" ? input.validate : null,
      expand: typeof input.expand === "function" ? input.expand : null,
      apply: typeof input.apply === "function" ? input.apply : null,
      needsCharacterHistory: input.needsCharacterHistory === true,
    }));
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
      if (!registration || !registration.apply) return Object.freeze({ handled: false });
      try {
        const shared = sharedByResult.get(result) ?? new Map();
        sharedByResult.set(result, shared);
        const value = await registration.apply(Object.freeze({ ...scope, shared, ownerId: registration.ownerId }));
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
    needsCharacterHistory(agentTypes) {
      const active = new Set((agentTypes ?? []).map(String));
      return [...registrations.values()].some((registration) =>
        registration.needsCharacterHistory && registration.agentTypes.some((agentType) => active.has(agentType)),
      );
    },
    async expandAll(results = [], scope = {}) {
      const output = [];
      for (const result of results) {
        const registration = result?.success ? find(String(result.type ?? ""), String(result.agentType ?? "")) : null;
        if (!registration) {
          output.push(result);
          continue;
        }
        const shared = new Map();
        sharedByResult.set(result, shared);
        try {
          const registrationScope = Object.freeze({ ...scope, result, shared, ownerId: registration.ownerId });
          if (registration.validate) await registration.validate(registrationScope);
          const derived = registration.expand ? await registration.expand(registrationScope) : [];
          if (derived !== undefined && !Array.isArray(derived)) {
            throw new TypeError(`${registration.ownerId}:${registration.id} returned invalid derived results`);
          }
          for (const child of derived ?? []) {
            if (!child || typeof child !== "object" || child === result) {
              throw new TypeError(`${registration.ownerId}:${registration.id} returned an invalid derived result`);
            }
            output.push(child);
          }
          // Native tracker applicators must commit their child patches before
          // the package parent performs its final merge against the resulting
          // GameState. Otherwise later native persona/quest writes can replace
          // packageState and other package namespaces with their stale base.
          output.push(result);
        } catch (error) {
          result.success = false;
          result.error = error instanceof Error ? error.message : String(error);
          output.push(result);
          scope.logger?.error?.(error, `[mari-bridge] ${registration.ownerId}:${registration.id} rejected ${registration.resultType}`);
        }
      }
      return output;
    },
    snapshot() {
      return Object.freeze(
        [...registrations.values()].map(({ apply: _apply, expand: _expand, validate: _validate, ...registration }) => Object.freeze(registration)),
      );
    },
    clear() {
      registrations.clear();
    },
  });
}
