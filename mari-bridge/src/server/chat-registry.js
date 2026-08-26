function compare(left, right) {
  return right.priority - left.priority || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id);
}

export function createChatRegistry() {
  const registrations = new Map();

  function ordered() {
    return [...registrations.values()].sort(compare);
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      if (!id || typeof input.onChanged !== "function") {
        throw new TypeError("Mari Bridge chat registration requires id and onChanged");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge chat registration ${key}`);
      registrations.set(key, Object.freeze({
        ownerId,
        id,
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        onChanged: input.onChanged,
      }));
      return () => registrations.delete(key);
    },
    async notifyChanged(input) {
      const event = Object.freeze({
        ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
        changedKeys: Object.freeze([...(Array.isArray(input?.changedKeys) ? input.changedKeys : [])]),
      });
      const failures = [];
      for (const registration of ordered()) {
        try {
          await registration.onChanged(event);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "Mari Bridge chat changed contributions failed");
    },
    snapshot() {
      return Object.freeze(ordered().map(({ ownerId, id, priority }) => Object.freeze({ ownerId, id, priority })));
    },
    clear() { registrations.clear(); },
  });
}
