import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";
import {
  escapeMariBridgeSettingsHtml,
  setMariBridgeSettingsHtml,
} from "../../../_mari-bridge/sdk/settings.js";

const PACKAGE_ID = "better-impersonate";
const TAG_NAME = "marinara-capability-better-impersonate";
const LAST_GUIDANCE_PREFIX = "mari-si-guidance:";
const SETTINGS_FIELDS = ["draftTemplate", "continueTemplate", "thinkingTemplate"];
let betterImpersonateSettingsCache = null;

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
  setMariBridgeSettingsHtml(root, renderKey, `
    <section class="mari-editor-shell mari-editor-legacy-bridge flex min-h-0 flex-1 flex-col overflow-hidden" aria-labelledby="better-impersonate-title">
      <header class="mari-editor-header">
        <button type="button" class="mari-editor-action inline-flex" data-bi-back aria-label="Back to Agents">Back</button>
        <div class="mari-editor-icon-tile">BI</div>
        <div class="min-w-0 flex-1">
          <h1 id="better-impersonate-title" class="mari-editor-title truncate">Better Impersonate</h1>
          <p class="mari-editor-subtitle truncate">Global slash-command prompt templates</p>
        </div>
      </header>
      <div class="mari-editor-content max-md:p-4">
        <div class="mari-editor-content-inner mari-editor-content-inner--wide flex flex-col gap-4">
          <section class="mari-editor-panel p-4">
            <div class="flex flex-wrap items-start gap-3">
              <div class="min-w-52 flex-1">
                <h2 class="text-xs font-semibold text-[var(--marinara-editor-foreground,var(--foreground))]">Command prompt templates</h2>
                <p class="mt-1 text-[0.6875rem] leading-relaxed text-[var(--marinara-editor-muted,var(--muted-foreground))]">These are global Better Impersonate settings. They wrap Marinara's native impersonate prompt for slash commands and system Quick Replies; they are not added to active chats.</p>
              </div>
              <span class="rounded-full bg-[var(--secondary)] px-2 py-1 text-[0.625rem] font-medium text-[var(--marinara-editor-muted,var(--muted-foreground))]">${state.loading ? "Loading" : state.saved ? "Saved" : "Global"}</span>
            </div>
            ${state.error ? `<p class="mt-3 rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-[0.6875rem] text-[var(--destructive)]" role="alert">${escapeMariBridgeSettingsHtml(state.error)}</p>` : ""}
            ${state.status ? `<p class="mt-3 text-[0.6875rem] leading-relaxed text-[var(--marinara-editor-muted,var(--muted-foreground))]">${escapeMariBridgeSettingsHtml(state.status)}</p>` : ""}
            <div class="mt-4 flex flex-col gap-4">
              ${fields.map(([key, label, description, value]) => `
                <section class="border-t border-[var(--border)] pt-4 first:border-t-0 first:pt-0">
                  <label class="text-[0.6875rem] font-semibold" for="better-impersonate-${key}">${label}</label>
                  <p class="mt-1 text-[0.625rem] leading-relaxed text-[var(--marinara-editor-muted,var(--muted-foreground))]">${description}</p>
                  <textarea id="better-impersonate-${key}" rows="9" spellcheck="false" class="mt-3 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]/50 focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-45" data-bi-setting="${key}" ${state.loading ? "disabled" : ""}>${escapeMariBridgeSettingsHtml(value)}</textarea>
                </section>
              `).join("")}
            </div>
            <div class="mt-4 border-t border-[var(--border)] pt-4">
              <p class="text-[0.625rem] font-semibold text-[var(--marinara-editor-muted,var(--muted-foreground))]">Available variables</p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                ${["{{base_prompt}}", "{{user}}", "{{impersonate_direction}}", "{{input}}"].map((macro) => `<code class="rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-[0.625rem] text-[var(--foreground)]">${escapeMariBridgeSettingsHtml(macro)}</code>`).join("")}
              </div>
              <p class="mt-2 text-[0.625rem] leading-relaxed text-[var(--marinara-editor-muted,var(--muted-foreground))]"><code>{{input}}</code> is resolved by the Mari Bridge Quick Reply macro before the slash command runs. Prompt templates should keep <code>{{impersonate_direction}}</code> so the command guidance reaches the model.</p>
              <p class="mt-2 text-[0.6875rem] text-[var(--marinara-editor-muted,var(--muted-foreground))]" data-bi-status>${state.saved ? "Saved." : ""}</p>
            </div>
          </section>
          <div class="flex flex-wrap justify-end gap-2">
            <button type="button" class="mari-editor-action inline-flex min-h-11 px-4" data-bi-reset>Reset defaults</button>
            <button type="button" class="mari-editor-action mari-editor-action--accent inline-flex min-h-11 px-4" data-bi-save>Save</button>
          </div>
        </div>
      </div>
    </section>
  `);
  root.querySelector("[data-bi-back]")?.addEventListener("click", () => {
    const close = root.capabilityProps?.onClose;
    if (typeof close === "function") close();
  });
  root.querySelector("[data-bi-save]")?.addEventListener("click", () => persistBetterImpersonateSettings(root, false));
  root.querySelector("[data-bi-reset]")?.addEventListener("click", () => persistBetterImpersonateSettings(root, true));
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
