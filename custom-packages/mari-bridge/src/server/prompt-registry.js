const VALID_ROLES = new Set(["system", "user", "assistant"]);
const VALID_POSITIONS = new Set(["system-start", "before-history", "after-history", "depth", "end"]);
const VALID_TRANSFORM_STAGES = new Set(["history", "final"]);

function compareRegistration(left, right) {
  return left.order - right.order || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id);
}

function registrationId(ownerId, input) {
  const id = String(input?.id ?? "").trim();
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(id)) throw new TypeError("Prompt registration requires a stable id");
  return `${ownerId}:${id}`;
}

function promptScope(input, overrides = {}) {
  return Object.freeze({
    requestId: String(overrides.requestId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
    workflow: overrides.workflow ?? (input?.gameState ? "game" : "chat"),
    lane: overrides.lane ?? (input?.previewOnly ? "dry-run" : "main"),
    chatId: typeof input?.chatId === "string" ? input.chatId : null,
    characterIds: Object.freeze([...(input?.characterIds ?? [])]),
    groupCharacterIds: Object.freeze([...(input?.groupCharacterIds ?? [])]),
    personaId: input?.personaId ?? null,
    impersonate: input?.impersonate === true,
  });
}

function cloneMessages(messages) {
  return (messages ?? []).map((message) => ({ ...message }));
}

function sectionMatches(registration, section, scope) {
  if (registration.when && registration.when(scope) !== true) return false;
  if (registration.sectionIds.has(section.id)) return true;
  if (registration.identifiers.has(section.identifier)) return true;
  if (registration.names.has(section.name)) return true;
  if (registration.markerTypes.size > 0 && section.markerConfig) {
    try {
      return registration.markerTypes.has(JSON.parse(section.markerConfig).type);
    } catch {
      return false;
    }
  }
  return false;
}

function insertContribution(messages, contribution) {
  const message = {
    role: contribution.role,
    content: contribution.content,
    contextKind: "prompt",
  };
  if (contribution.position === "system-start") {
    messages.unshift(message);
    return;
  }
  const historyIndices = messages
    .map((candidate, index) => candidate.contextKind === "history" ? index : -1)
    .filter((index) => index >= 0);
  if (contribution.position === "before-history") {
    messages.splice(historyIndices[0] ?? messages.length, 0, message);
    return;
  }
  if (contribution.position === "after-history") {
    messages.splice(historyIndices.length > 0 ? historyIndices.at(-1) + 1 : messages.length, 0, message);
    return;
  }
  if (contribution.position === "depth") {
    const anchor = historyIndices.length > 0 ? historyIndices.at(-1) + 1 : messages.length;
    messages.splice(Math.max(0, anchor - contribution.depth), 0, message);
    return;
  }
  messages.push(message);
}

export function createPromptRegistry() {
  const suppressions = new Map();
  const injections = new Map();
  const transforms = new Map();

  function addCleanup(map, key, value) {
    if (map.has(key)) throw new Error(`Duplicate Mari Bridge prompt registration ${key}`);
    map.set(key, value);
    return () => {
      if (map.get(key) === value) map.delete(key);
    };
  }

  function registerSuppression(ownerId, input) {
    const key = registrationId(ownerId, input);
    const registration = Object.freeze({
      id: String(input.id),
      ownerId,
      order: Number.isFinite(input.order) ? Number(input.order) : 0,
      sectionIds: new Set(input.sectionIds ?? []),
      identifiers: new Set(input.identifiers ?? []),
      names: new Set(input.names ?? []),
      markerTypes: new Set(input.markerTypes ?? []),
      when: typeof input.when === "function" ? input.when : null,
    });
    if (
      registration.sectionIds.size + registration.identifiers.size + registration.names.size + registration.markerTypes.size ===
      0
    ) {
      throw new TypeError("Prompt suppression must select a section id, identifier, name, or marker type");
    }
    return addCleanup(suppressions, key, registration);
  }

  function registerInjection(ownerId, input) {
    const key = registrationId(ownerId, input);
    const position = String(input.position ?? "end");
    const role = String(input.role ?? "system");
    if (!VALID_POSITIONS.has(position)) throw new TypeError(`Unsupported prompt injection position ${position}`);
    if (!VALID_ROLES.has(role)) throw new TypeError(`Unsupported prompt injection role ${role}`);
    if (typeof input.content !== "string" && typeof input.build !== "function") {
      throw new TypeError("Prompt injection requires content or build(scope)");
    }
    const registration = Object.freeze({
      id: String(input.id),
      ownerId,
      order: Number.isFinite(input.order) ? Number(input.order) : 0,
      position,
      role,
      depth: Math.max(0, Number.isInteger(input.depth) ? input.depth : 0),
      content: typeof input.content === "string" ? input.content : null,
      build: typeof input.build === "function" ? input.build : null,
      when: typeof input.when === "function" ? input.when : null,
    });
    return addCleanup(injections, key, registration);
  }

  function registerTransform(ownerId, input) {
    const key = registrationId(ownerId, input);
    const stage = String(input.stage ?? "final");
    if (!VALID_TRANSFORM_STAGES.has(stage)) throw new TypeError(`Unsupported message transform stage ${stage}`);
    if (typeof input.transform !== "function") throw new TypeError("Message transform requires transform(messages, scope)");
    const registration = Object.freeze({
      id: String(input.id),
      ownerId,
      order: Number.isFinite(input.order) ? Number(input.order) : 0,
      stage,
      transform: input.transform,
      when: typeof input.when === "function" ? input.when : null,
    });
    return addCleanup(transforms, key, registration);
  }

  async function runTransforms(stage, messages, scope) {
    let current = cloneMessages(messages);
    const selected = [...transforms.values()].filter((item) => item.stage === stage).sort(compareRegistration);
    for (const registration of selected) {
      if (registration.when && await registration.when(scope) !== true) continue;
      const result = await registration.transform(Object.freeze(cloneMessages(current)), scope);
      if (!Array.isArray(result)) throw new TypeError(`${registration.ownerId}:${registration.id} returned invalid messages`);
      current = cloneMessages(result);
    }
    return current;
  }

  async function prepareAssemblerInput(input) {
    const scope = promptScope(input);
    const sections = input.sections.map((section) => {
      const suppressed = [...suppressions.values()].sort(compareRegistration).some((item) => sectionMatches(item, section, scope));
      return suppressed ? { ...section, enabled: "false" } : { ...section };
    });
    const chatMessages = await runTransforms("history", input.chatMessages, scope);
    return { ...input, sections, chatMessages, __mariBridgePromptScope: scope };
  }

  async function finalizeAssemblerMessages(input, messages) {
    const scope = input.__mariBridgePromptScope ?? promptScope(input);
    return finalizeMessages(scope, messages);
  }

  async function finalizeMessages(scopeInput, messages) {
    const scope = Object.freeze({ ...scopeInput });
    const output = cloneMessages(messages);
    for (const registration of [...injections.values()].sort(compareRegistration)) {
      if (registration.when && await registration.when(scope) !== true) continue;
      const content = registration.build ? await registration.build(scope) : registration.content;
      if (typeof content !== "string" || !content.trim()) continue;
      insertContribution(output, { ...registration, content: content.trim() });
    }
    return runTransforms("final", output, scope);
  }

  return Object.freeze({
    registerSuppression,
    registerInjection,
    registerTransform,
    prepareAssemblerInput,
    finalizeAssemblerMessages,
    finalizeMessages,
    snapshot() {
      return Object.freeze({
        suppressions: suppressions.size,
        injections: injections.size,
        transforms: transforms.size,
      });
    },
    clear() {
      suppressions.clear();
      injections.clear();
      transforms.clear();
    },
  });
}
