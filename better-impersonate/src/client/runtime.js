import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";
import { buildImpersonateDraftRequest } from "./request.js";

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
