import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";
import { buildImpersonateDraftRequest, extractContinuationSuffix } from "./request.js";
import { readRecall, rememberGeneratedDraft, rememberImpersonateRequest } from "./recall.js";

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
