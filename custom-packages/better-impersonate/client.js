(async () => {
  "use strict";
  // bridge-sdk/contracts.js
  const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 1 });
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

  // bridge-sdk/settings.js
  const MARI_BRIDGE_SETTINGS_STYLE_ID = "mari-bridge-sdk-settings-style";

  function ensureMariBridgeSettingsStyles() {
    if (!globalThis.document || document.getElementById(MARI_BRIDGE_SETTINGS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MARI_BRIDGE_SETTINGS_STYLE_ID;
    style.textContent = `
      .mari-sdk-settings { display:flex; flex-direction:column; gap:.75rem; color:var(--foreground); }
      .mari-sdk-settings[aria-busy="true"] { opacity:.72; }
      .mari-sdk-settings-group { display:flex; flex-direction:column; gap:.55rem; border-top:1px solid color-mix(in srgb,var(--border) 60%,transparent); padding-top:.7rem; }
      .mari-sdk-settings-group:first-child { border-top:0; padding-top:0; }
      .mari-sdk-settings-heading { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
      .mari-sdk-settings-title { margin:0; font-size:.75rem; font-weight:600; line-height:1.35; }
      .mari-sdk-settings-description,.mari-sdk-settings-help,.mari-sdk-settings-status { margin:0; color:var(--muted-foreground); font-size:.6875rem; line-height:1.4; }
      .mari-sdk-settings-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.65rem; }
      .mari-sdk-settings-field { display:flex; min-width:0; flex-direction:column; gap:.3rem; }
      .mari-sdk-settings-label { font-size:.6875rem; font-weight:600; line-height:1.35; }
      .mari-sdk-settings-input,.mari-sdk-settings-select,.mari-sdk-settings-textarea { width:100%; box-sizing:border-box; border:0; border-radius:.5rem; background:color-mix(in srgb,var(--secondary) 70%,transparent); color:var(--foreground); font:inherit; font-size:.75rem; outline:none; padding:.45rem .6rem; box-shadow:0 0 0 1px var(--border); }
      .mari-sdk-settings-textarea { min-height:5rem; resize:vertical; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; line-height:1.45; }
      .mari-sdk-settings-input:focus,.mari-sdk-settings-select:focus,.mari-sdk-settings-textarea:focus { box-shadow:0 0 0 2px color-mix(in srgb,var(--ring) 70%,transparent); }
      .mari-sdk-settings-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:.4rem; }
      .mari-sdk-settings-button { border:0; border-radius:.45rem; background:var(--secondary); color:var(--foreground); cursor:pointer; font-size:.6875rem; font-weight:600; padding:.4rem .65rem; box-shadow:0 0 0 1px var(--border); }
      .mari-sdk-settings-button[data-variant="primary"] { background:var(--primary); color:var(--primary-foreground); box-shadow:none; }
      .mari-sdk-settings-button:disabled { cursor:default; opacity:.55; }
      .mari-sdk-settings-switch { display:flex; align-items:flex-start; justify-content:space-between; gap:.75rem; border-radius:.45rem; padding:.35rem .15rem; }
      .mari-sdk-settings-switch-copy { display:flex; min-width:0; flex-direction:column; gap:.1rem; }
      .mari-sdk-settings-switch input { width:1rem; height:1rem; margin:.1rem 0 0; accent-color:var(--primary); }
      .mari-sdk-settings-chip-list { display:flex; flex-wrap:wrap; gap:.5rem; }
      .mari-sdk-settings-chip { display:flex; flex-direction:column; align-items:center; gap:.25rem; width:3.75rem; border:0; background:transparent; color:var(--foreground); cursor:pointer; padding:0; }
      .mari-sdk-settings-chip-avatar { display:grid; place-items:center; width:2.25rem; height:2.25rem; overflow:hidden; border-radius:999px; background:var(--secondary); box-shadow:0 0 0 1px var(--border); }
      .mari-sdk-settings-chip-avatar img { width:100%; height:100%; object-fit:cover; }
      .mari-sdk-settings-chip[aria-checked="true"] .mari-sdk-settings-chip-avatar { box-shadow:0 0 0 2px var(--primary); }
      .mari-sdk-settings-chip-label { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.625rem; }
      .mari-sdk-settings-detail { min-height:0; overflow:auto; padding:1rem; }
      @media (max-width:640px) { .mari-sdk-settings-grid { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  function prepareMariBridgeSettingsRoot(root, options = {}) {
    if (!(root instanceof Element)) throw new TypeError("Mari Bridge settings root must be an Element");
    ensureMariBridgeSettingsStyles();
    root.classList.add("mari-sdk-settings");
    root.classList.toggle("mari-sdk-settings-detail", options.surface === "detail");
    return root;
  }

  function setMariBridgeSettingsHtml(root, renderKey, html) {
    prepareMariBridgeSettingsRoot(root);
    const key = String(renderKey ?? "");
    if (root.dataset.mariBridgeSettingsRenderKey === key) return false;
    root.dataset.mariBridgeSettingsRenderKey = key;
    root.innerHTML = String(html ?? "");
    return true;
  }

  function escapeMariBridgeSettingsHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // bridge-sdk/client.js
  async function activateClientWithMariBridge(input, activateConsumer) {
    if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
    const requirements = normalizeBridgeRequirements(input);
    const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
    if (!runtime || runtime.status !== "ready" || typeof runtime.registerConsumer !== "function") {
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

  // src/client/prompts.js
  const DEFAULT_IMPERSONATE_DRAFT_TEMPLATE = [
    "{{base_prompt}}",
    "",
      "Guidance for {{user}}'s next in-character response:",
      "{{impersonate_direction}}",
      "",
      "Use this as a suggestion for the generated response, not as dialogue or chat history.",
      "Do not quote or rush to fulfill the suggestion; let it guide you naturally.",
  ].join("\n").trim();

  const DEFAULT_IMPERSONATE_THINKING_TEMPLATE = [
    "{{base_prompt}}",
    "",
      "Private inner state for {{user}}:",
      "{{impersonate_direction}}",
      "",
      "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
      "Let this ground the response in {{user}}'s feelings rather than force an outcome.",
  ].join("\n").trim();

  const DEFAULT_IMPERSONATE_CONTINUE_TEMPLATE = [
    "{{base_prompt}}",
    "",
      "Continue {{user}}'s current in-character draft.",
      "The draft so far is:",
      "{{impersonate_direction}}",
      "",
      "Return only the continuation text.",
      "Do not restart the draft.",
      "Do not repeat any part of the draft.",
      "Do not explain.",
  ].join("\n").trim();

  function applyImpersonateModeTemplate(template, baseTemplate) {
    const base = String(baseTemplate || "").trim();
    const source = String(template || "").trim();
    return source.includes("{{base_prompt}}")
      ? source.replaceAll("{{base_prompt}}", base).trim()
      : [base, source].filter(Boolean).join("\n\n");
  }

  // src/client/runtime.js
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
          commands: ["/impersonate-draft"],
          modes: ["roleplay"],
          handler: ({ raw, context }) => generateDraft(bridgeSession, "impersonate", commandArgument(raw), context),
        }),
        bridgeSession.commands.register({
          id: "impersonate-continue",
          commands: ["/impersonate-continue"],
          modes: ["roleplay"],
          handler: ({ raw, context }) => generateDraft(bridgeSession, "continue", commandArgument(raw), context),
        }),
        bridgeSession.commands.register({
          id: "impersonate-thinking",
          commands: ["/impersonate-thinking"],
          modes: ["roleplay"],
          handler: ({ raw, context }) => generateDraft(bridgeSession, "inner_state", commandArgument(raw), context),
        }),
        bridgeSession.commands.register({
          id: "impersonate-last",
          commands: ["/impersonate-last"],
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
          if (this.getAttribute("view") !== "settings") {
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
            ? "Usage: /impersonate-continue <current persona draft>"
            : "Usage: /impersonate-thinking <private thoughts or feelings>",
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
      throw error;
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
    prepareMariBridgeSettingsRoot(root);
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

})();
