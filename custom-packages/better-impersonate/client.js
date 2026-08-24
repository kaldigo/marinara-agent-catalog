(async () => {
  "use strict";
  // bridge-sdk/contracts.js
  const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 3 });
  const MARI_BRIDGE_SERVER_SYMBOL = Symbol.for("marinara.mari-bridge.v1");
  const MARI_BRIDGE_CLIENT_SYMBOL = Symbol.for("marinara.mari-bridge.client.v1");

  class MariBridgeUnavailableError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = "MariBridgeUnavailableError";
      this.code = "MARI_BRIDGE_UNAVAILABLE";
      this.reason = details.reason ?? "unhealthy";
      this.consumerId = details.consumerId ?? null;
      this.missingCapabilities = Object.freeze([...(details.missingCapabilities ?? [])]);
      this.failedPatches = Object.freeze([...(details.failedPatches ?? [])]);
    }
  }

  function normalizeBridgeRequirements(input = {}) {
    const consumerId = String(input.consumerId ?? "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(consumerId)) {
      throw new TypeError("Mari Bridge consumerId must be a lowercase package ID");
    }
    const major = Number(input.api?.major);
    const minMinor = Number(input.api?.minMinor ?? 0);
    if (!Number.isInteger(major) || major < 1 || !Number.isInteger(minMinor) || minMinor < 0) {
      throw new TypeError("Mari Bridge API requirement must contain a positive major and non-negative minMinor");
    }
    return Object.freeze({
      consumerId,
      api: Object.freeze({ major, minMinor }),
      require: Object.freeze([...new Set((input.require ?? []).map(String).map((value) => value.trim()).filter(Boolean))].sort()),
    });
  }

  function missingBridgeError(consumerId, surface) {
    return new MariBridgeUnavailableError(
      `Mari Bridge ${surface} runtime is not installed or did not start before ${consumerId}`,
      { reason: "missing", consumerId },
    );
  }

  // bridge-sdk/client.js
  function readyClientRuntime() {
    const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
    return runtime?.status === "ready" && typeof runtime.registerConsumer === "function" ? runtime : null;
  }

  async function activateClientWithMariBridge(input, activateConsumer) {
    if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
    const requirements = normalizeBridgeRequirements(input);
    const runtime = readyClientRuntime();
    if (!runtime) {
      throw missingBridgeError(requirements.consumerId, "client");
    }
    const session = runtime.registerConsumer(requirements);
    try {
      const cleanup = await activateConsumer(session);
      if (typeof cleanup === "function") session.addCleanup(cleanup);
      const marker = `data-mari-bridge-consumer-${requirements.consumerId}`;
      globalThis.document?.documentElement?.setAttribute(marker, "ready");
      return async () => {
        globalThis.document?.documentElement?.removeAttribute(marker);
        await session.close(`${requirements.consumerId} client deactivated`);
      };
    } catch (error) {
      await session.close(`${requirements.consumerId} client activation failed`);
      throw error;
    }
  }

  // src/client/request.js
  function buildImpersonateDraftRequest(mode, guidance) {
    if (mode === "continue") {
      return {
        impersonate: true,
        impersonateContinuation: guidance,
      };
    }
    return {
      impersonate: true,
      ...(guidance
        ? {
            generationGuide: mode === "inner_state"
              ? `Private inner state for {{user}}: ${guidance}\nUse this as quiet emotional context, not dialogue or a required outcome.`
              : guidance,
            generationGuideSource: "guide",
          }
        : {}),
    };
  }

  // src/client/runtime.js
  const PACKAGE_ID = "better-impersonate";
  const LAST_GUIDANCE_PREFIX = "mari-si-guidance:";

  if (!customElements.get("marinara-capability-better-impersonate")) {
    customElements.define("marinara-capability-better-impersonate", class BetterImpersonateCapability extends HTMLElement {
      connectedCallback() {
        this.hidden = true;
        this.setAttribute("aria-hidden", "true");
      }
    });
  }

  const cleanupImpersonateCommands = await activateClientWithMariBridge(
    {
      consumerId: PACKAGE_ID,
      api: { major: 1, minMinor: 3 },
      require: [
        "chat.active",
        "client.bridge-first",
        "commands",
        "commands.draft-write",
        "consumer.sessions",
        "generation.draft",
        "quick-replies.input-macro",
        "runtime.health",
      ],
    },
    async (bridgeSession) => {
      const registrations = [
        registerDraftCommand(bridgeSession, {
          id: "impersonate-draft",
          command: "/impersonate_draft",
          description: "Generate a persona response draft using optional guidance",
          usage: "/impersonate_draft [guidance]",
          mode: "impersonate",
        }),
        registerDraftCommand(bridgeSession, {
          id: "impersonate-continue",
          command: "/impersonate_continue",
          description: "Continue the current persona draft",
          usage: "/impersonate_continue <current draft>",
          mode: "continue",
        }),
        registerDraftCommand(bridgeSession, {
          id: "impersonate-thinking",
          command: "/impersonate_thinking",
          description: "Generate a persona draft guided by private thoughts or feelings",
          usage: "/impersonate_thinking <private guidance>",
          mode: "inner_state",
        }),
        bridgeSession.commands.register({
          id: "impersonate-last",
          commands: ["/impersonate_last"],
          description: "Restore the last persona guidance to the input",
          usage: "/impersonate_last",
          modes: ["roleplay"],
          handler: ({ context }) => restoreLastGuidance(context),
        }),
      ];
      return () => registrations.splice(0).reverse().forEach((dispose) => dispose());
    },
  );

  function registerDraftCommand(bridgeSession, definition) {
    return bridgeSession.commands.register({
      id: definition.id,
      commands: [definition.command],
      description: definition.description,
      usage: definition.usage,
      modes: ["roleplay"],
      handler: ({ raw, context }) => generateDraft(bridgeSession, definition.mode, commandArgument(raw), context),
    });
  }

  function commandArgument(raw) {
    return String(raw ?? "").replace(/^\s*\/\S+\s*/u, "");
  }

  async function generateDraft(bridgeSession, mode, input, context) {
    const guidance = String(input ?? "").trim();
    if (!guidance && mode !== "impersonate") {
      return {
        handled: true,
        feedback: mode === "continue"
          ? "Usage: /impersonate_continue <current persona draft>"
          : "Usage: /impersonate_thinking <private thoughts or feelings>",
      };
    }
    if (!context?.chatId || typeof context.setDraft !== "function") {
      throw new Error("This command requires an active Roleplay chat.");
    }

    rememberGuidance(context.chatId, mode, guidance);
    let received = false;
    try {
      const generation = bridgeSession.drafts.generate({
        chatId: context.chatId,
        output: mode === "continue" ? "continuation" : "content",
        body: buildImpersonateDraftRequest(mode, guidance),
        onUpdate: (next) => {
          if (!next) return;
          received = true;
          context.setDraft(renderDraft(mode, guidance, next));
        },
      });
      context.setDraftGenerating?.(true);
      const content = await generation;
      const result = renderDraft(mode, guidance, content).trimEnd();
      context.setDraft(result);
      return { handled: true, draft: result };
    } catch (error) {
      if (!received && guidance) context.setDraft(guidance);
      if (error instanceof DOMException && error.name === "AbortError") {
        return { handled: true, feedback: "Persona draft generation stopped." };
      }
      return {
        handled: true,
        feedback: `Persona draft generation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      context.setDraftGenerating?.(false);
    }
  }

  function restoreLastGuidance(context) {
    if (!context?.chatId || typeof context.setDraft !== "function") {
      throw new Error("This command requires an active Roleplay chat.");
    }
    const previous = readLastGuidance(context.chatId);
    if (!previous.trim()) return { handled: true, feedback: "No saved guidance for this chat." };
    context.setDraft(previous);
    return { handled: true, draft: previous };
  }

  function rememberGuidance(chatId, mode, input) {
    if (!chatId || !input || (mode !== "impersonate" && mode !== "inner_state")) return;
    try {
      globalThis.localStorage?.setItem(`${LAST_GUIDANCE_PREFIX}${chatId}`, input);
    } catch {
      // Guidance restoration is optional.
    }
  }

  function readLastGuidance(chatId) {
    try {
      return globalThis.localStorage?.getItem(`${LAST_GUIDANCE_PREFIX}${chatId}`) || "";
    } catch {
      return "";
    }
  }

  function renderDraft(mode, original, generated) {
    const content = String(generated ?? "");
    if (mode !== "continue") return content;
    return original + draftJoiner(original, content) + content;
  }

  function draftJoiner(left, right) {
    if (!left || !right || /[\s"'([{]$/u.test(left) || /^[\s.,!?;:)"'\]}]/u.test(right)) return "";
    return " ";
  }

  void cleanupImpersonateCommands;

})();
