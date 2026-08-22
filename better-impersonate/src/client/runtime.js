import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";
import {
  escapeMariBridgeSettingsHtml,
  setMariBridgeNativeSettingsHtml,
} from "../../../_mari-bridge/sdk/settings.js";

const PACKAGE_ID = "better-impersonate";
const TAG_NAME = "marinara-capability-better-impersonate";
const LAST_GUIDANCE_PREFIX = "mari-si-guidance:";
const SETTINGS_FIELDS = ["draftTemplate", "continueTemplate", "thinkingTemplate"];
let betterImpersonateSettingsCache = null;

defineCapabilityElement();

let cleanupImpersonateCommands = async () => {};
try {
  cleanupImpersonateCommands = await activateClientWithMariBridge(
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
      ],
    },
    async (bridgeSession) => {
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
      ];
      return () => {
        for (const dispose of disposers.splice(0).reverse()) dispose();
      };
    },
  );
} catch (error) {
  console.warn("[Better Impersonate] Mari Bridge activation failed; command handlers are disabled until the package is reloaded.", error);
  document.documentElement.dataset.mariBridgeConsumerBetterImpersonate = "bridge-unavailable";
}

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
        if (this.getAttribute("view") !== "detail") {
          this.hidden = true;
          this.setAttribute("aria-hidden", "true");
          this.replaceChildren();
          return;
        }
        this.hidden = false;
        this.removeAttribute("aria-hidden");
        void renderBetterImpersonateSettings(this);
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
  const packageSettings = await readBetterImpersonateSettings();
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

function resolvePromptTemplate(mode, baseTemplate, settings = defaultBetterImpersonateSettings()) {
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

function normalizeBetterImpersonateSettings(value) {
  const defaults = defaultBetterImpersonateSettings();
  const settings = typeof value === "string" ? parseJsonObject(value) : value;
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key,
    typeof settings?.[key] === "string" && settings[key].trim() ? settings[key].trim() : fallback,
  ]));
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readBetterImpersonateSettings(options = {}) {
  if (!options.fresh && betterImpersonateSettingsCache) return betterImpersonateSettingsCache;
  const response = await fetch("/api/agents", {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) {
    if (betterImpersonateSettingsCache) return betterImpersonateSettingsCache;
    return defaultBetterImpersonateSettings();
  }
  const agents = await response.json();
  const config = Array.isArray(agents)
    ? agents.find((agent) => agent && typeof agent === "object" && (agent.type === PACKAGE_ID || agent.id === PACKAGE_ID))
    : null;
  betterImpersonateSettingsCache = normalizeBetterImpersonateSettings(config?.settings);
  return betterImpersonateSettingsCache;
}

async function saveBetterImpersonateSettings(next) {
  const response = await fetch(`/api/agents/type/${encodeURIComponent(PACKAGE_ID)}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-marinara-csrf": "1",
    },
    credentials: "same-origin",
    body: JSON.stringify({ settings: next }),
  });
  if (!response.ok) throw new Error(`Agent settings update failed (${response.status})`);
  const config = await response.json().catch(() => null);
  betterImpersonateSettingsCache = normalizeBetterImpersonateSettings(config?.settings ?? next);
  return betterImpersonateSettingsCache;
}

async function renderBetterImpersonateSettings(root, state = {}) {
  const nonce = (root._betterImpersonateRenderNonce ?? 0) + 1;
  root._betterImpersonateRenderNonce = nonce;
  if (!betterImpersonateSettingsCache && !state.settings) {
    renderBetterImpersonateSettingsHtml(root, defaultBetterImpersonateSettings(), {
      loading: true,
      status: "Loading saved prompt templates…",
    });
  }
  let settings;
  try {
    settings = state.settings ?? await readBetterImpersonateSettings({ fresh: state.fresh === true });
  } catch (error) {
    if (root._betterImpersonateRenderNonce !== nonce) return;
    settings = defaultBetterImpersonateSettings();
    renderBetterImpersonateSettingsHtml(root, settings, {
      error: `Could not load saved prompt templates. Using built-ins for this view. ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  if (root._betterImpersonateRenderNonce !== nonce) return;
  renderBetterImpersonateSettingsHtml(root, settings, state);
}

function renderBetterImpersonateSettingsHtml(root, settings, state = {}) {
  const fields = [
    ["draftTemplate", "Draft guidance prompt", "Wraps /impersonate_draft guidance before calling Marinara's native impersonate endpoint.", settings.draftTemplate],
    ["continueTemplate", "Continue prompt", "Wraps /impersonate_continue so the model appends to the current draft instead of restarting it.", settings.continueTemplate],
    ["thinkingTemplate", "Private thinking prompt", "Wraps /impersonate_thinking as quiet inner-state context for the drafted response.", settings.thinkingTemplate],
  ];
  const renderKey = JSON.stringify({
    settings,
    loading: state.loading === true,
    status: state.status || "",
    error: state.error || "",
    saved: state.saved === true,
  });
  setMariBridgeNativeSettingsHtml(root, renderKey, {
    surface: "detail",
    title: "Better Impersonate",
    subtitle: "Global slash-command prompt templates",
    iconText: "BI",
    sections: [
      {
        title: "Command prompt templates",
        description: "These are global Better Impersonate settings. They wrap Marinara's native impersonate prompt for slash commands and system Quick Replies; they are not added to active chats.",
        badge: { label: state.loading ? "Loading" : state.saved ? "Saved" : "Global", muted: !state.saved },
        html: [
          state.error ? `<p class="mari-native-settings-error" role="alert">${escapeMariBridgeSettingsHtml(state.error)}</p>` : "",
          state.status ? `<p class="mari-native-settings-muted">${escapeMariBridgeSettingsHtml(state.status)}</p>` : "",
        ].join(""),
        fields: fields.map(([key, label, description, value]) => ({
          type: "textarea",
          settingAttribute: "data-bi-setting",
          name: key,
          label,
          help: description,
          rows: 9,
          value,
          disabled: state.loading === true,
        })),
      },
      {
        title: "Available variables",
        html: `
          <div class="mari-native-settings-macro-list">
            ${["{{base_prompt}}", "{{user}}", "{{impersonate_direction}}", "{{input}}"].map((macro) => `<code class="mari-native-settings-macro">${escapeMariBridgeSettingsHtml(macro)}</code>`).join("")}
          </div>
          <p class="mari-native-settings-muted"><code>{{input}}</code> is resolved by the Mari Bridge Quick Reply macro before the slash command runs. Prompt templates should keep <code>{{impersonate_direction}}</code> so the command guidance reaches the model.</p>
          <p class="mari-native-settings-status" data-bi-status>${state.saved ? "Saved." : ""}</p>
        `,
      },
    ],
    actions: [
      { id: "reset", label: "Reset defaults" },
      { id: "save", label: "Save", variant: "primary" },
    ],
  });
  root.querySelector('[data-mari-native-action="back"]')?.addEventListener("click", () => {
    const close = root.capabilityProps?.onClose;
    if (typeof close === "function") close();
  });
  root.querySelector('[data-mari-native-action="save"]')?.addEventListener("click", () => persistBetterImpersonateSettings(root, false));
  root.querySelector('[data-mari-native-action="reset"]')?.addEventListener("click", () => persistBetterImpersonateSettings(root, true));
}

async function persistBetterImpersonateSettings(root, reset) {
  const status = root.querySelector("[data-bi-status]");
  try {
    const next = reset ? defaultBetterImpersonateSettings() : {};
    if (!reset) {
      for (const key of SETTINGS_FIELDS) {
        const value = root.querySelector(`[data-bi-setting="${key}"]`)?.value.trim() || "";
        if (!value.includes("{{impersonate_direction}}")) throw new Error(`${key} must contain {{impersonate_direction}}.`);
        next[key] = value;
      }
    }
    if (status) status.textContent = reset ? "Restoring defaults…" : "Saving…";
    const saved = await saveBetterImpersonateSettings(next);
    root.dataset.mariBridgeSettingsRenderKey = "";
    renderBetterImpersonateSettingsHtml(root, saved, { saved: true });
  } catch (error) {
    if (status) status.textContent = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
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
