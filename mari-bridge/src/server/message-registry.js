function compare(left, right) {
  return right.priority - left.priority || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id);
}

export function createMessageRegistry() {
  const registrations = new Map();

  function ordered() {
    return [...registrations.values()].sort(compare);
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const prepare = typeof input.prepare === "function" ? input.prepare : null;
      const afterPersist = typeof input.afterPersist === "function" ? input.afterPersist : null;
      if (!id || (!prepare && !afterPersist)) {
        throw new TypeError("Mari Bridge message registration requires id and at least one message callback");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge message registration ${key}`);
      registrations.set(key, Object.freeze({
        ownerId,
        id,
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        prepare,
        afterPersist,
      }));
      return () => registrations.delete(key);
    },
    async prepareCreate(input) {
      let prepared = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : input;
      for (const registration of ordered().filter((entry) => entry.prepare)) {
        const patch = await registration.prepare(Object.freeze({
          ownerId: registration.ownerId,
          input: Object.freeze({ ...prepared }),
        }));
        if (patch == null) continue;
        if (typeof patch !== "object" || Array.isArray(patch)) {
          throw new TypeError(`Mari Bridge message prepare ${registration.ownerId}:${registration.id} must return an object patch`);
        }
        prepared = { ...prepared, ...patch };
      }
      return prepared;
    },
    async notifyPersisted(input) {
      const event = Object.freeze({
        ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
      });
      const failures = [];
      for (const registration of ordered().filter((entry) => entry.afterPersist)) {
        try {
          await registration.afterPersist(event);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "Mari Bridge message persisted contributions failed");
    },
    snapshot() {
      return Object.freeze(ordered().map(({ ownerId, id, priority, prepare, afterPersist }) => Object.freeze({
        ownerId,
        id,
        priority,
        callbacks: Object.freeze([
          ...(prepare ? ["prepare"] : []),
          ...(afterPersist ? ["afterPersist"] : []),
        ]),
      })));
    },
    clear() { registrations.clear(); },
  });
}
