import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";
import {
  escapeMariBridgeSettingsHtml,
  prepareMariBridgeSettingsRoot,
  setMariBridgeSettingsHtml,
} from "../../../_mari-bridge/sdk/settings.js";

const PACKAGE_ID = "better-impersonate";
const TAG_NAME = "marinara-capability-better-impersonate";
const LAST_GUIDANCE_PREFIX = "mari-si-guidance:";
const PACKAGE_SETTINGS_KEY = "mari-better-impersonate-settings:v1";

const cleanupImpersonateCommands = await activateClientWithMariBridge(
  {
    consumerId: PACKAGE_ID,
    api: { major: 1, minMinor: 0 },
    require: [
      "chat.active",
      "client.bridge-first",
      "commands",
      "commands.draft-write",
      "consumer.sessions",
      "generation.draft",
      "quick-replies.input-macro",
      "runtime.health",
      "ui.chat-settings",
    ],
  },
  async (bridgeSession) => {
    defineCapabilityElement();
    const disposers = [
      bridgeSession.commands.register({
        id: "impersonate-draft",
        commands: ["/impersonate_draft"],
        aliases: ["/impersonate-draft"],
        description: "Generate a persona response draft using optional guidance",
        usage: "/impersonate_draft [guidance]",
        modes: ["roleplay"],
        handler: ({ raw, context }) => generateDraft(bridgeSession, "impersonate", commandArgument(raw), context),
      }),
      bridgeSession.commands.register({
        id: "impersonate-continue",
        commands: ["/impersonate_continue"],
        aliases: ["/impersonate-continue"],
        description: "Continue the current persona draft",
        usage: "/impersonate_continue <current draft>",
        modes: ["roleplay"],
        handler: ({ raw, context }) => generateDraft(bridgeSession, "continue", commandArgument(raw), context),
      }),
      bridgeSession.commands.register({
        id: "impersonate-thinking",
        commands: ["/impersonate_thinking"],
        aliases: ["/impersonate-thinking"],
        description: "Generate a persona draft guided by private thoughts or feelings",
        usage: "/impersonate_thinking <private guidance>",
        modes: ["roleplay"],
        handler: ({ raw, context }) => generateDraft(bridgeSession, "inner_state", commandArgument(raw), context),
      }),
      bridgeSession.commands.register({
        id: "impersonate-last",
        commands: ["/impersonate_last"],
        aliases: ["/impersonate-last"],
        description: "Restore the last persona guidance to the input",
        usage: "/impersonate_last",
        modes: ["roleplay"],
        handler: ({ context }) => restoreLastGuidance(context),
      }),
      bridgeSession.ui.register({ id: "settings", slot: "chat.settings", view: "settings", priority: 30 }),
    ];
    return () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    };
  },
);

function defineCapabilityElement() {
  if (customElements.get(TAG_NAME)) return;
  customElements.define(
    TAG_NAME,
    class ImpersonateCommandsCapabilityElement extends HTMLElement {
      connectedCallback() {
        this.addEventListener("marinara-capability-props", this);
        this.render();
      }
      disconnectedCallback() {
        this.removeEventListener("marinara-capability-props", this);
      }
      handleEvent() {
        this.render();
      }
      render() {
        if (!["settings", "detail"].includes(this.getAttribute("view"))) {
          this.hidden = true;
          this.setAttribute("aria-hidden", "true");
          this.replaceChildren();
          return;
        }
        this.hidden = false;
        this.removeAttribute("aria-hidden");
        renderBetterImpersonateSettings(this);
      }
    },
  );
}

function commandArgument(raw) {
  return String(raw ?? "").replace(/^\s*\/\S+\s*/u, "");
}

async function generateDraft(bridgeSession, mode, input, context) {
  const draft = String(input ?? "").trim();
  if (!draft && mode !== "impersonate") {
    return {
      handled: true,
      feedback:
        mode === "continue"
          ? "Usage: /impersonate_continue <current persona draft>"
          : "Usage: /impersonate_thinking <private thoughts or feelings>",
    };
  }
  if (!context?.chatId || typeof context.setDraft !== "function") {
    throw new Error("This command requires an active Roleplay chat.");
  }

  const settings = readImpersonateSettings();
  const packageSettings = readBetterImpersonateSettings();
  rememberGuidance(context.chatId, mode, draft);
  const baseTemplate = settings.impersonatePromptTemplate || (await readChatImpersonatePrompt(context.chatId));
  const impersonatePromptTemplate = resolvePromptTemplate(mode, baseTemplate, packageSettings);
  const body = {
    userMessage: draft || null,
    impersonate: true,
    impersonatePromptTemplate,
    ...(settings.impersonatePresetId ? { impersonatePresetId: settings.impersonatePresetId } : {}),
    ...(settings.impersonateConnectionId ? { impersonateConnectionId: settings.impersonateConnectionId } : {}),
    impersonateBlockAgents: settings.impersonateBlockAgents,
  };
  let received = false;
  try {
    context.setDraftGenerating?.(true);
    const content = await bridgeSession.drafts.generate({
      chatId: context.chatId,
      body,
      onUpdate: (next) => {
        if (!next) return;
        received = true;
        context.setDraft(renderDraft(mode, draft, next));
      },
    });
    const result = renderDraft(mode, draft, content).trimEnd();
    context.setDraft(result);
    return { handled: true, draft: result };
  } catch (error) {
    if (!received && draft) context.setDraft(draft);
    if (error instanceof DOMException && error.name === "AbortError") {
      return { handled: true, feedback: "Persona draft generation stopped." };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      handled: true,
      feedback: `Persona draft generation failed: ${detail}`,
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
    // Last-guidance reuse is optional; draft generation still works without browser storage.
  }
}

function readLastGuidance(chatId) {
  try {
    return globalThis.localStorage?.getItem(`${LAST_GUIDANCE_PREFIX}${chatId}`) || "";
  } catch {
    return "";
  }
}

function resolvePromptTemplate(mode, baseTemplate, settings = readBetterImpersonateSettings()) {
  if (mode === "continue") return applyImpersonateModeTemplate(settings.continueTemplate, baseTemplate);
  if (mode === "inner_state") return applyImpersonateModeTemplate(settings.thinkingTemplate, baseTemplate);
  return applyImpersonateModeTemplate(settings.draftTemplate, baseTemplate);
}

function defaultBetterImpersonateSettings() {
  return {
    draftTemplate: DEFAULT_IMPERSONATE_DRAFT_TEMPLATE,
    continueTemplate: DEFAULT_IMPERSONATE_CONTINUE_TEMPLATE,
    thinkingTemplate: DEFAULT_IMPERSONATE_THINKING_TEMPLATE,
  };
}

function readBetterImpersonateSettings() {
  const defaults = defaultBetterImpersonateSettings();
  try {
    const value = JSON.parse(localStorage.getItem(PACKAGE_SETTINGS_KEY) || "{}");
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof value?.[key] === "string" && value[key].trim() ? value[key].trim() : fallback,
    ]));
  } catch {
    return defaults;
  }
}

function renderBetterImpersonateSettings(root) {
  prepareMariBridgeSettingsRoot(root, { surface: root.getAttribute("view") === "detail" ? "detail" : "chat" });
  const settings = readBetterImpersonateSettings();
  const fields = [
    ["draftTemplate", "Draft guidance template", settings.draftTemplate],
    ["continueTemplate", "Continue template", settings.continueTemplate],
    ["thinkingTemplate", "Private thinking template", settings.thinkingTemplate],
  ];
  setMariBridgeSettingsHtml(root, JSON.stringify(settings), `
    <section class="mari-sdk-settings-group">
      <div class="mari-sdk-settings-heading"><h3 class="mari-sdk-settings-title">Better Impersonate</h3></div>
      <p class="mari-sdk-settings-description">These global templates wrap Marinara's native impersonate prompt. Connection, model, preset, and agent blocking remain in Marinara's Impersonate section.</p>
      ${fields.map(([key, label, value]) => `<label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">${label}</span><textarea rows="7" class="mari-sdk-settings-textarea" data-bi-setting="${key}">${escapeMariBridgeSettingsHtml(value)}</textarea></label>`).join("")}
      <p class="mari-sdk-settings-help">Macros: <code>{{base_prompt}}</code>, <code>{{user}}</code>, and <code>{{impersonate_direction}}</code>. Quick Replies resolve <code>{{input}}</code> before the slash command runs.</p>
      <p class="mari-sdk-settings-status" data-bi-status></p>
      <div class="mari-sdk-settings-actions"><button type="button" class="mari-sdk-settings-button" data-bi-reset>Reset defaults</button><button type="button" class="mari-sdk-settings-button" data-variant="primary" data-bi-save>Save</button></div>
    </section>
  `);
  root.querySelector("[data-bi-save]")?.addEventListener("click", () => saveBetterImpersonateSettings(root, false));
  root.querySelector("[data-bi-reset]")?.addEventListener("click", () => saveBetterImpersonateSettings(root, true));
}

function saveBetterImpersonateSettings(root, reset) {
  const status = root.querySelector("[data-bi-status]");
  try {
    if (reset) localStorage.removeItem(PACKAGE_SETTINGS_KEY);
    else {
      const next = {};
      for (const key of ["draftTemplate", "continueTemplate", "thinkingTemplate"]) {
        const value = root.querySelector(`[data-bi-setting="${key}"]`)?.value.trim() || "";
        if (!value.includes("{{impersonate_direction}}")) throw new Error(`${key} must contain {{impersonate_direction}}.`);
        next[key] = value;
      }
      localStorage.setItem(PACKAGE_SETTINGS_KEY, JSON.stringify(next));
    }
    root.dataset.mariBridgeSettingsRenderKey = "";
    renderBetterImpersonateSettings(root);
    const nextStatus = root.querySelector("[data-bi-status]");
    if (nextStatus) nextStatus.textContent = reset ? "Defaults restored." : "Saved.";
  } catch (error) {
    if (status) status.textContent = `Save failed: ${error.message}`;
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

function readImpersonateSettings() {
  const fallback = {
    impersonatePromptTemplate: "",
    impersonatePresetId: null,
    impersonateConnectionId: null,
    impersonateBlockAgents: false,
  };
  try {
    const raw = localStorage.getItem("marinara-engine-ui");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const state = parsed?.state && typeof parsed.state === "object" ? parsed.state : parsed;
    return {
      impersonatePromptTemplate:
        typeof state?.impersonatePromptTemplate === "string" ? state.impersonatePromptTemplate.trim() : "",
      impersonatePresetId: nonEmptyString(state?.impersonatePresetId),
      impersonateConnectionId: nonEmptyString(state?.impersonateConnectionId),
      impersonateBlockAgents: state?.impersonateBlockAgents === true,
    };
  } catch {
    return fallback;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readChatImpersonatePrompt(chatId) {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) return "";
  const chat = await response.json();
  try {
    const metadata = typeof chat?.metadata === "string" ? JSON.parse(chat.metadata || "{}") : chat?.metadata || {};
    return typeof metadata.impersonatePrompt === "string" ? metadata.impersonatePrompt.trim() : "";
  } catch {
    return "";
  }
}

void cleanupImpersonateCommands;
