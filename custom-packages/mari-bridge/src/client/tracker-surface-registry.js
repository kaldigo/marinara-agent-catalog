function normalizeId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(normalized)) throw new TypeError(`Mari Bridge ${label} must be a stable id`);
  return normalized;
}

export function createTrackerSurfaceRegistry() {
  const registrations = new Map();
  const subscribers = new Set();
  let version = 0;

  function publish() {
    version += 1;
    for (const subscriber of [...subscribers]) subscriber();
  }

  function selected(input) {
    for (const registration of registrations.values()) {
      try {
        const result = registration.resolve(Object.freeze({ ...input, ownerId: registration.ownerId }));
        if (result && typeof result === "object") return { registration, result };
      } catch {
        // Visibility and presentation overrides fail closed.
      }
    }
    return null;
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = normalizeId(input.id, "tracker surface registration id");
      if (typeof input.resolve !== "function") throw new TypeError("Mari Bridge tracker surface registrations require resolve");
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge tracker surface registration ${key}`);
      registrations.set(key, Object.freeze({ ownerId, id, resolve: input.resolve, prepareRerun: typeof input.prepareRerun === "function" ? input.prepareRerun : null }));
      publish();
      return () => {
        const removed = registrations.delete(key);
        if (removed) publish();
        return removed;
      };
    },
    refresh: publish,
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    getVersion() { return version; },
    shouldShow(agentType, input = {}) {
      return selected({ ...input, agentType: String(agentType ?? ""), content: null })?.result?.visible === true;
    },
    shouldShowContent(content, input = {}) {
      const selection = selected({ ...input, agentType: null, content: String(content ?? "") });
      return selection ? selection.result.visible === true : true;
    },
    visibleAgentTypes(input = {}) {
      return ["world-state", "character-tracker", "persona-stats", "quest", "gm-notes"]
        .filter((agentType) => selected({ ...input, agentType, content: null })?.result?.visible === true);
    },
    async prepareRerun(agentType, input = {}) {
      const selection = selected({ ...input, agentType: String(agentType ?? ""), content: null });
      if (!selection?.result?.rerunAgentId) return null;
      if (selection.registration.prepareRerun) await selection.registration.prepareRerun(Object.freeze({ ...input, agentType, ...selection.result }));
      return Object.freeze({ agentType: selection.result.rerunAgentId, section: selection.result.rerunSection ?? null });
    },
  });
}
