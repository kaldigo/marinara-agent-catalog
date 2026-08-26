import {
  MARI_BRIDGE_API_VERSION,
  MARI_BRIDGE_IMPLEMENTATION_VERSION,
  MariBridgeUnavailableError,
  normalizeRequirements,
} from "../shared/contracts.js";

function freezePatch(patch) {
  return Object.freeze({
    id: String(patch.id),
    status: patch.status,
    detail: patch.detail ? String(patch.detail) : null,
  });
}

export function createBridgeRuntime(options = {}) {
  const consumers = new Map();
  const capabilities = new Set(options.capabilities ?? []);
  const patches = new Map((options.patches ?? []).map((patch) => [String(patch.id), freezePatch(patch)]));
  let status = "starting";
  let statusDetail = null;
  let disposed = false;
  const promptRegistry = options.promptRegistry ?? null;
  const agentResultRegistry = options.agentResultRegistry ?? null;
  const trackerContextRegistry = options.trackerContextRegistry ?? null;
  const groupSelectorRegistry = options.groupSelectorRegistry ?? null;
  const turnHandoffRegistry = options.turnHandoffRegistry ?? null;
  const messageRegistry = options.messageRegistry ?? null;
  const chatRegistry = options.chatRegistry ?? null;
  const hostRequest = typeof options.hostRequest === "function" ? options.hostRequest : null;

  function snapshot() {
    return Object.freeze({
      apiVersion: MARI_BRIDGE_API_VERSION,
      implementationVersion: MARI_BRIDGE_IMPLEMENTATION_VERSION,
      status,
      statusDetail,
      capabilities: Object.freeze([...capabilities].sort()),
      patches: Object.freeze([...patches.values()]),
      consumers: Object.freeze(
        [...consumers.values()].map((record) => Object.freeze({
          consumerId: record.requirements.consumerId,
          capabilities: record.requirements.require,
          active: !record.controller.signal.aborted,
        })),
      ),
      promptRegistrations: promptRegistry?.snapshot?.() ?? null,
      agentResultRegistrations: agentResultRegistry?.snapshot?.() ?? null,
      trackerContextRegistrations: trackerContextRegistry?.snapshot?.() ?? null,
      groupSelectorRegistrations: groupSelectorRegistry?.snapshot?.() ?? null,
      turnHandoffRegistrations: turnHandoffRegistry?.snapshot?.() ?? null,
      messageRegistrations: messageRegistry?.snapshot?.() ?? null,
      chatRegistrations: chatRegistry?.snapshot?.() ?? null,
    });
  }

  function unavailable(requirements, reason, message, extra = {}) {
    return new MariBridgeUnavailableError(message, {
      reason,
      consumerId: requirements.consumerId,
      ...extra,
    });
  }

  function assertAvailable(requirements) {
    if (disposed || status === "disabled") {
      throw unavailable(requirements, "disabled", `Mari Bridge is disabled for ${requirements.consumerId}`);
    }
    if (status === "starting") {
      throw unavailable(requirements, "starting", `Mari Bridge is still starting for ${requirements.consumerId}`);
    }
    if (status !== "ready") {
      throw unavailable(requirements, "unhealthy", `Mari Bridge is ${status} for ${requirements.consumerId}`);
    }
    if (
      requirements.api.major !== MARI_BRIDGE_API_VERSION.major ||
      requirements.api.minMinor > MARI_BRIDGE_API_VERSION.minor
    ) {
      throw unavailable(
        requirements,
        "incompatible-api",
        `${requirements.consumerId} requires Mari Bridge API ${requirements.api.major}.${requirements.api.minMinor}; ` +
          `runtime provides ${MARI_BRIDGE_API_VERSION.major}.${MARI_BRIDGE_API_VERSION.minor}`,
      );
    }
    const missingCapabilities = requirements.require.filter((capability) => !capabilities.has(capability));
    if (missingCapabilities.length > 0) {
      throw unavailable(
        requirements,
        "capability-missing",
        `Mari Bridge is missing required capabilities for ${requirements.consumerId}: ${missingCapabilities.join(", ")}`,
        { missingCapabilities },
      );
    }
    const failedPatches = requirements.require.filter((capability) => patches.get(capability)?.status === "failed");
    if (failedPatches.length > 0) {
      throw unavailable(
        requirements,
        "patch-failed",
        `Mari Bridge patches failed for ${requirements.consumerId}: ${failedPatches.join(", ")}`,
        { failedPatches },
      );
    }
  }

  function registerConsumer(input) {
    const requirements = normalizeRequirements(input);
    assertAvailable(requirements);
    if (consumers.has(requirements.consumerId)) {
      throw new Error(`Mari Bridge consumer ${requirements.consumerId} is already active`);
    }
    const controller = new AbortController();
    const cleanups = [];
    let closed = false;
    const close = async (reason = "Mari Bridge consumer closed") => {
      if (closed) return;
      closed = true;
      consumers.delete(requirements.consumerId);
      controller.abort(reason);
      let firstError;
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          await cleanup();
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    };
    const ownsCapability = (capability) => requirements.require.includes(capability);
    const registerOwnedCleanup = (registration) => {
      cleanups.push(registration);
      return registration;
    };
    const prompts = promptRegistry
      ? Object.freeze({
          suppress(input) {
            if (!ownsCapability("prompt.suppress")) throw new Error(`${requirements.consumerId} did not require prompt.suppress`);
            return registerOwnedCleanup(promptRegistry.registerSuppression(requirements.consumerId, input));
          },
          inject(input) {
            if (!ownsCapability("prompt.inject")) throw new Error(`${requirements.consumerId} did not require prompt.inject`);
            return registerOwnedCleanup(promptRegistry.registerInjection(requirements.consumerId, input));
          },
          transform(input) {
            const capability = input?.stage === "history" ? "prompt.transform-history" : "prompt.transform-final";
            if (!ownsCapability(capability)) throw new Error(`${requirements.consumerId} did not require ${capability}`);
            return registerOwnedCleanup(promptRegistry.registerTransform(requirements.consumerId, input));
          },
        })
      : null;
    const agentResults = agentResultRegistry
      ? Object.freeze({
          register(input) {
            if (!ownsCapability("agent.result-types")) {
              throw new Error(`${requirements.consumerId} did not require agent.result-types`);
            }
            return registerOwnedCleanup(agentResultRegistry.register(requirements.consumerId, input));
          },
        })
      : null;
    const trackerContext = trackerContextRegistry
      ? Object.freeze({
          register(input) {
            if (!ownsCapability("tracker.context")) {
              throw new Error(`${requirements.consumerId} did not require tracker.context`);
            }
            return registerOwnedCleanup(trackerContextRegistry.register(requirements.consumerId, input));
          },
        })
      : null;
    const host = hostRequest
      ? Object.freeze({
          request(input) {
            if (!ownsCapability("host.request")) {
              throw new Error(`${requirements.consumerId} did not require host.request`);
            }
            return hostRequest(requirements.consumerId, input);
          },
        })
      : null;
    const groupSelectors = groupSelectorRegistry
      ? Object.freeze({
          register(input) {
            if (!ownsCapability("group.selector")) {
              throw new Error(`${requirements.consumerId} did not require group.selector`);
            }
            return registerOwnedCleanup(groupSelectorRegistry.register(requirements.consumerId, input));
          },
        })
      : null;
    const turnHandoffs = turnHandoffRegistry
      ? Object.freeze({
          register(input) {
            if (!ownsCapability("turn.handoff")) {
              throw new Error(`${requirements.consumerId} did not require turn.handoff`);
            }
            return registerOwnedCleanup(turnHandoffRegistry.register(requirements.consumerId, input));
          },
        })
      : null;
    const messages = messageRegistry
      ? Object.freeze({
          register(input) {
            if (typeof input?.prepare === "function" && !ownsCapability("message.prepare")) {
              throw new Error(`${requirements.consumerId} did not require message.prepare`);
            }
            if (typeof input?.afterPersist === "function" && !ownsCapability("message.persist")) {
              throw new Error(`${requirements.consumerId} did not require message.persist`);
            }
            return registerOwnedCleanup(messageRegistry.register(requirements.consumerId, input));
          },
        })
      : null;
    const chats = chatRegistry
      ? Object.freeze({
          register(input) {
            if (!ownsCapability("chat.changed")) {
              throw new Error(`${requirements.consumerId} did not require chat.changed`);
            }
            return registerOwnedCleanup(chatRegistry.register(requirements.consumerId, input));
          },
        })
      : null;
    const session = Object.freeze({
      consumerId: requirements.consumerId,
      apiVersion: MARI_BRIDGE_API_VERSION,
      capabilities: requirements.require,
      signal: controller.signal,
      getHealth: snapshot,
      prompts,
      agentResults,
      trackerContext,
      groupSelectors,
      turnHandoffs,
      messages,
      chats,
      host,
      addCleanup(cleanup) {
        if (typeof cleanup !== "function") throw new TypeError("Mari Bridge cleanup must be a function");
        if (closed) {
          void cleanup();
          return () => {};
        }
        cleanups.push(cleanup);
        return () => {
          const index = cleanups.indexOf(cleanup);
          if (index >= 0) cleanups.splice(index, 1);
        };
      },
      close,
    });
    consumers.set(requirements.consumerId, { requirements, controller, close, session });
    return session;
  }

  async function revokeUnavailableConsumers(reason = "Mari Bridge health changed") {
    const records = [...consumers.values()];
    for (const record of records) {
      try {
        assertAvailable(record.requirements);
      } catch {
        await record.close(reason);
      }
    }
  }

  return Object.freeze({
    apiVersion: MARI_BRIDGE_API_VERSION,
    implementationVersion: MARI_BRIDGE_IMPLEMENTATION_VERSION,
    registerConsumer,
    promptHooks: promptRegistry
      ? Object.freeze({
          prepareAssemblerInput: promptRegistry.prepareAssemblerInput,
          finalizeAssemblerMessages: promptRegistry.finalizeAssemblerMessages,
          finalizeMessages: promptRegistry.finalizeMessages,
        })
      : null,
    agentResultHooks: agentResultRegistry
      ? Object.freeze({
          hasResultType: agentResultRegistry.hasResultType,
          apply: agentResultRegistry.apply,
        })
      : null,
    trackerContextHooks: trackerContextRegistry
      ? Object.freeze({
          hasActive: trackerContextRegistry.hasActive,
          appendCommittedSections: trackerContextRegistry.appendCommittedSections,
          appendAgentState: trackerContextRegistry.appendAgentState,
        })
      : null,
    groupSelectorHooks: groupSelectorRegistry
      ? Object.freeze({
          resolvePolicy: groupSelectorRegistry.resolvePolicy,
          select: groupSelectorRegistry.select,
        })
      : null,
    turnHandoffHooks: turnHandoffRegistry
      ? Object.freeze({
          resolvePolicy: turnHandoffRegistry.resolvePolicy,
          select: turnHandoffRegistry.select,
          createStreamFilter: turnHandoffRegistry.createStreamFilter,
          processResponse: turnHandoffRegistry.processResponse,
          commit: turnHandoffRegistry.commit,
        })
      : null,
    messageHooks: messageRegistry
      ? Object.freeze({
          prepareCreate: messageRegistry.prepareCreate,
          notifyPersisted: messageRegistry.notifyPersisted,
        })
      : null,
    chatHooks: chatRegistry
      ? Object.freeze({ notifyChanged: chatRegistry.notifyChanged })
      : null,
    getSnapshot: snapshot,
    markReady() {
      if (disposed) throw new Error("Cannot ready a disposed Mari Bridge runtime");
      status = "ready";
      statusDetail = null;
    },
    async markUnhealthy(detail) {
      status = "unhealthy";
      statusDetail = String(detail ?? "Mari Bridge health check failed");
      await revokeUnavailableConsumers(statusDetail);
    },
    async dispose(reason = "Mari Bridge runtime stopped") {
      if (disposed) return;
      disposed = true;
      status = "disabled";
      statusDetail = reason;
      const records = [...consumers.values()];
      for (const record of records.reverse()) await record.close(reason);
      promptRegistry?.clear?.();
      agentResultRegistry?.clear?.();
      trackerContextRegistry?.clear?.();
      groupSelectorRegistry?.clear?.();
      turnHandoffRegistry?.clear?.();
      messageRegistry?.clear?.();
      chatRegistry?.clear?.();
    },
  });
}
