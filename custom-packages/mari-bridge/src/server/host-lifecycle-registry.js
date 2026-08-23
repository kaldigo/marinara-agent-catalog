function normalizeRegistration(ownerId, input = {}) {
  const id = String(input.id ?? "").trim();
  if (!id) throw new TypeError("Mari Bridge host lifecycle registration requires id");
  const handlers = {
    preHandler: typeof input.preHandler === "function" ? input.preHandler : null,
    onSend: typeof input.onSend === "function" ? input.onSend : null,
    onResponse: typeof input.onResponse === "function" ? input.onResponse : null,
  };
  if (!Object.values(handlers).some(Boolean)) {
    throw new TypeError("Mari Bridge host lifecycle registration requires at least one handler");
  }
  return Object.freeze({
    ownerId,
    id,
    priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
    ...handlers,
  });
}

export function createHostLifecycleRegistry() {
  const registrations = new Map();

  function ordered() {
    return [...registrations.values()].sort(
      (left, right) => right.priority - left.priority || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id),
    );
  }

  return Object.freeze({
    register(ownerId, input) {
      const registration = normalizeRegistration(ownerId, input);
      const key = `${ownerId}:${registration.id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge host lifecycle registration ${key}`);
      registrations.set(key, registration);
      return () => registrations.delete(key);
    },
    async dispatch(stage, ...args) {
      let payload = stage === "onSend" ? args[2] : undefined;
      for (const registration of ordered()) {
        const handler = registration[stage];
        if (!handler) continue;
        if (stage === "onSend") {
          const next = await handler(args[0], args[1], payload);
          if (next !== undefined) payload = next;
        } else {
          await handler(...args);
        }
      }
      return payload;
    },
    snapshot() {
      return Object.freeze(ordered().map(({ ownerId, id, priority, preHandler, onSend, onResponse }) => Object.freeze({
        ownerId,
        id,
        priority,
        stages: Object.freeze([
          ...(preHandler ? ["preHandler"] : []),
          ...(onSend ? ["onSend"] : []),
          ...(onResponse ? ["onResponse"] : []),
        ]),
      })));
    },
    clear() { registrations.clear(); },
  });
}
