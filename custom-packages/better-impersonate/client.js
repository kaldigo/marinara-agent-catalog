(async () => {
  "use strict";
  // bridge-sdk/contracts.js
  const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 9 });
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

  // src/client/recall.js
  const RECALL_PREFIX = "mari-better-impersonate:recall:";
  const LEGACY_GUIDANCE_PREFIX = "mari-si-guidance:";

  function emptyRecall() {
    return { lastGuidance: "", lastGeneratedDraft: "" };
  }

  function readRecall(storage, chatId) {
    const id = String(chatId ?? "").trim();
    if (!storage || !id) return emptyRecall();
    try {
      const raw = storage.getItem(`${RECALL_PREFIX}${id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          lastGuidance: typeof parsed?.lastGuidance === "string" ? parsed.lastGuidance : "",
          lastGeneratedDraft: typeof parsed?.lastGeneratedDraft === "string" ? parsed.lastGeneratedDraft : "",
        };
      }
      return {
        lastGuidance: storage.getItem(`${LEGACY_GUIDANCE_PREFIX}${id}`) || "",
        lastGeneratedDraft: "",
      };
    } catch {
      return emptyRecall();
    }
  }

  function writeRecall(storage, chatId, recall) {
    const id = String(chatId ?? "").trim();
    if (!storage || !id) return;
    try {
      storage.setItem(`${RECALL_PREFIX}${id}`, JSON.stringify({
        version: 1,
        lastGuidance: recall.lastGuidance,
        lastGeneratedDraft: recall.lastGeneratedDraft,
      }));
      storage.removeItem?.(`${LEGACY_GUIDANCE_PREFIX}${id}`);
    } catch {
      // Recall is optional and must never block draft generation.
    }
  }

  function rememberImpersonateRequest(storage, chatId, input) {
    const guidance = String(input ?? "");
    const recall = readRecall(storage, chatId);
    if (!guidance || guidance === recall.lastGeneratedDraft) return recall;
    const next = { ...recall, lastGuidance: guidance };
    writeRecall(storage, chatId, next);
    return next;
  }

  function rememberGeneratedDraft(storage, chatId, output) {
    const recall = readRecall(storage, chatId);
    const next = { ...recall, lastGeneratedDraft: String(output ?? "") };
    writeRecall(storage, chatId, next);
    return next;
  }

  const __test = Object.freeze({ RECALL_PREFIX, LEGACY_GUIDANCE_PREFIX });

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
            generationGuide: guidance,
            generationGuideSource: "guide",
          }
        : {}),
    };
  }

  function extractContinuationSuffix(original, generated) {
    const draft = String(original ?? "");
    const content = String(generated ?? "");
    if (!draft || !content) return content;
    if (content.startsWith(draft)) return content.slice(draft.length);
    if (draft.startsWith(content)) return "";
    return content;
  }

  // src/client/runtime.js
  const PACKAGE_ID = "better-impersonate";

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
        feedback: "Usage: /impersonate_continue <current persona draft>",
      };
    }
    if (!context?.chatId || typeof context.setDraft !== "function") {
      throw new Error("This command requires an active Roleplay chat.");
    }

    if (mode === "impersonate") rememberImpersonateRequest(globalThis.localStorage, context.chatId, guidance);
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
      rememberGeneratedDraft(globalThis.localStorage, context.chatId, result);
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
    const previous = readRecall(globalThis.localStorage, context.chatId).lastGuidance;
    if (!previous.trim()) return { handled: true, feedback: "No saved guidance for this chat." };
    context.setDraft(previous);
    return { handled: true, draft: previous };
  }

  function renderDraft(mode, original, generated) {
    const content = String(generated ?? "");
    if (mode !== "continue") return content;
    return original + extractContinuationSuffix(original, content);
  }

  void cleanupImpersonateCommands;

})();
