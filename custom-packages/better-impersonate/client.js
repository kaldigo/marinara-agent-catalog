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

  const MARI_BRIDGE_NATIVE_SETTINGS_STYLE_ID = "mari-bridge-sdk-native-settings-style";

  function ensureMariBridgeNativeSettingsStyles() {
    if (!globalThis.document || document.getElementById(MARI_BRIDGE_NATIVE_SETTINGS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MARI_BRIDGE_NATIVE_SETTINGS_STYLE_ID;
    style.textContent = `
      .mari-native-settings-surface,.mari-native-settings-stack { display:flex; flex-direction:column; gap:1rem; }
      .mari-native-settings-title-block { min-width:0; flex:1 1 auto; }
      .mari-native-settings-title-block .mari-editor-title,.mari-native-settings-title-block .mari-editor-subtitle { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .mari-native-settings-card { display:flex; flex-direction:column; gap:.9rem; padding:1rem; }
      .mari-native-settings-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
      .mari-native-settings-title { margin:0; color:var(--foreground); font-size:.8125rem; font-weight:650; line-height:1.3; }
      .mari-native-settings-muted,.mari-native-settings-help,.mari-native-settings-status { margin:.25rem 0 0; color:var(--muted-foreground); font-size:.6875rem; line-height:1.45; }
      .mari-native-settings-error { margin:0; border-radius:.75rem; background:color-mix(in srgb,var(--destructive) 10%,transparent); color:var(--destructive); padding:.75rem; font-size:.75rem; line-height:1.45; }
      .mari-native-settings-chip { flex:0 0 auto; border-radius:999px; background:color-mix(in srgb,var(--primary) 12%,transparent); color:var(--primary); font-size:.625rem; font-weight:600; padding:.25rem .55rem; }
      .mari-native-settings-chip[data-muted="true"] { background:var(--secondary); color:var(--muted-foreground); }
      .mari-native-settings-switch { display:flex; align-items:center; justify-content:space-between; gap:1rem; border-radius:.75rem; background:color-mix(in srgb,var(--secondary) 55%,transparent); padding:.75rem; }
      .mari-native-settings-switch input { width:1rem; height:1rem; accent-color:var(--primary); }
      .mari-native-settings-field { display:flex; min-width:0; flex-direction:column; gap:.35rem; }
      .mari-native-settings-label { color:var(--foreground); font-size:.6875rem; font-weight:600; line-height:1.35; }
      .mari-native-settings-control { width:100%; box-sizing:border-box; border:0; border-radius:.75rem; background:var(--secondary); color:var(--foreground); font:inherit; font-size:.8125rem; outline:none; padding:.65rem .75rem; box-shadow:0 0 0 1px var(--border); }
      .mari-native-settings-control:focus { box-shadow:0 0 0 2px var(--ring); }
      .mari-native-settings-textarea { min-height:7rem; resize:vertical; font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; font-size:.75rem; line-height:1.5; }
      .mari-native-settings-control:disabled { opacity:.45; }
      .mari-native-settings-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.5rem; }
      .mari-native-settings-macro-list,.mari-native-settings-chip-list { display:flex; flex-wrap:wrap; gap:.45rem; }
      .mari-native-settings-macro { border-radius:.45rem; background:var(--secondary); color:var(--foreground); font-size:.625rem; padding:.25rem .45rem; box-shadow:0 0 0 1px var(--border); }
      .mari-native-settings-picker { display:flex; flex-wrap:wrap; gap:.5rem; padding-top:.25rem; }
      .mari-native-settings-choice { align-items:center; background:transparent; border:0; color:var(--foreground); cursor:pointer; display:flex; flex-direction:column; gap:.25rem; padding:0; width:3.5rem; }
      .mari-native-settings-avatar { align-items:center; background:var(--accent); border:2px solid transparent; border-radius:999px; color:var(--accent-foreground); display:flex; font-size:.75rem; font-weight:700; height:2.5rem; justify-content:center; opacity:.62; overflow:hidden; transition:opacity .15s ease, transform .15s ease; width:2.5rem; }
      .mari-native-settings-avatar img { height:100%; object-fit:cover; width:100%; }
      .mari-native-settings-choice:hover .mari-native-settings-avatar,.mari-native-settings-choice:focus-visible .mari-native-settings-avatar { opacity:1; transform:translateY(-1px); }
      .mari-native-settings-choice:focus-visible { outline:none; }
      .mari-native-settings-choice[aria-checked="true"] .mari-native-settings-avatar { border-color:var(--primary); box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 25%,transparent); opacity:1; }
      .mari-native-settings-choice-label { display:block; font-size:.59375rem; line-height:1.2; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%; }
    `;
    document.head.appendChild(style);
  }

  function setMariBridgeNativeSettingsHtml(root, renderKey, descriptor = {}) {
    if (!(root instanceof Element)) throw new TypeError("Mari Bridge native settings root must be an Element");
    ensureMariBridgeNativeSettingsStyles();
    root.classList.remove("mari-sdk-settings", "mari-sdk-settings-detail");
    const surface = descriptor.surface === "detail" ? "detail" : "chat";
    root.className = surface === "detail"
      ? "mari-editor-shell mari-editor-legacy-bridge flex min-h-0 flex-1 flex-col overflow-hidden"
      : "mari-native-settings-surface";
    const key = String(renderKey ?? "");
    if (root.dataset.mariBridgeSettingsRenderKey === key) return false;
    root.dataset.mariBridgeSettingsRenderKey = key;
    root.innerHTML = renderMariBridgeNativeSettingsHtml({ ...descriptor, surface });
    return true;
  }

  function renderMariBridgeNativeSettingsHtml(descriptor = {}) {
    const body = [
      ...(descriptor.activation ? [renderNativeActivation(descriptor.activation)] : []),
      ...(Array.isArray(descriptor.sections) ? descriptor.sections.map(renderNativeSection) : []),
      ...(Array.isArray(descriptor.actions) && descriptor.actions.length ? [renderNativeActions(descriptor.actions)] : []),
    ].join("");
    if (descriptor.surface !== "detail") return body;
    return `
      <header class="mari-editor-header">
        ${descriptor.backAction === false ? "" : `<button type="button" class="mari-editor-action inline-flex" data-mari-native-action="back" aria-label="Back to Agents">Back</button>`}
        <div class="mari-editor-icon-tile">${escapeMariBridgeSettingsHtml(descriptor.iconText || "")}</div>
        <div class="mari-native-settings-title-block">
          <h1 class="mari-editor-title">${escapeMariBridgeSettingsHtml(descriptor.title || "Settings")}</h1>
          ${descriptor.subtitle ? `<p class="mari-editor-subtitle">${escapeMariBridgeSettingsHtml(descriptor.subtitle)}</p>` : ""}
        </div>
      </header>
      <div class="mari-editor-content max-md:p-4">
        <div class="mari-editor-content-inner mari-editor-content-inner--wide mari-native-settings-stack">
          ${body}
        </div>
      </div>
    `;
  }

  function renderNativeActivation(activation = {}) {
    return renderNativeSection({
      title: activation.title || "Chat activation",
      description: activation.description || "",
      fields: [],
      after: `<button type="button" class="mari-editor-action ${activation.enabled ? "" : "mari-editor-action--accent"} inline-flex" data-mari-native-action="${escapeAttribute(activation.action || "toggle-agent")}">${escapeMariBridgeSettingsHtml(activation.enabled ? (activation.disableLabel || "Disable") : (activation.enableLabel || "Enable"))}</button>`,
    });
  }

  function renderNativeSection(section = {}) {
    return `
      <section class="mari-editor-panel mari-native-settings-card">
        <div class="mari-native-settings-heading">
          <div>
            ${section.title ? `<h2 class="mari-native-settings-title">${escapeMariBridgeSettingsHtml(section.title)}</h2>` : ""}
            ${section.description ? `<p class="mari-native-settings-muted">${escapeMariBridgeSettingsHtml(section.description)}</p>` : ""}
          </div>
          ${section.badge ? `<span class="mari-native-settings-chip"${section.badge.muted ? ' data-muted="true"' : ""}>${escapeMariBridgeSettingsHtml(section.badge.label || "")}</span>` : ""}
          ${section.after || ""}
        </div>
        ${(Array.isArray(section.fields) ? section.fields.map(renderNativeField).join("") : "")}
        ${section.html || ""}
      </section>
    `;
  }

  function renderNativeField(field = {}) {
    const settingAttr = field.settingAttribute || "data-mari-native-setting";
    const setting = field.name ? ` ${settingAttr}="${escapeAttribute(field.name)}"` : "";
    if (field.type === "switch") {
      return `
        <label class="mari-native-settings-switch">
          <span>
            <span class="mari-native-settings-label">${escapeMariBridgeSettingsHtml(field.label || "")}</span>
            ${field.help ? `<span class="mari-native-settings-help">${escapeMariBridgeSettingsHtml(field.help)}</span>` : ""}
          </span>
          <input${setting} type="checkbox"${field.checked ? " checked" : ""}${field.disabled ? " disabled" : ""}>
        </label>
      `;
    }
    if (field.type === "select") {
      const options = Array.isArray(field.options) ? field.options : [];
      return renderFieldShell(field, `<select class="mari-native-settings-control"${setting}${field.disabled ? " disabled" : ""}>${options.map((option) => `<option value="${escapeAttribute(option.value ?? "")}"${String(option.value ?? "") === String(field.value ?? "") ? " selected" : ""}>${escapeMariBridgeSettingsHtml(option.label ?? option.value ?? "")}</option>`).join("")}</select>`);
    }
    if (field.type === "textarea") {
      return renderFieldShell(field, `<textarea rows="${Number.isFinite(field.rows) ? Math.max(1, Math.floor(field.rows)) : 7}" class="mari-native-settings-control mari-native-settings-textarea"${setting}${field.disabled ? " disabled" : ""}>${escapeMariBridgeSettingsHtml(field.value ?? "")}</textarea>`);
    }
    if (field.type === "chips") {
      const optionAttr = field.optionAttribute || "data-mari-native-option";
      const options = Array.isArray(field.options) ? field.options : [];
      const chips = options.map((option) => {
        const label = String(option.label ?? option.value ?? "");
        const initial = label.trim().charAt(0).toUpperCase() || "?";
        const avatar = option.avatarUrl
          ? `<img src="${escapeAttribute(option.avatarUrl)}" alt="" aria-hidden="true" loading="lazy">`
          : `<span aria-hidden="true">${escapeMariBridgeSettingsHtml(initial)}</span>`;
        return `<button type="button" class="mari-native-settings-choice" ${optionAttr}="${escapeAttribute(option.value ?? "")}" role="checkbox" aria-checked="${option.selected ? "true" : "false"}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}"><span class="mari-native-settings-avatar">${avatar}</span><span class="mari-native-settings-choice-label">${escapeMariBridgeSettingsHtml(label)}</span></button>`;
      }).join("");
      return `
        <div class="mari-native-settings-field">
          ${field.label ? `<span class="mari-native-settings-label">${escapeMariBridgeSettingsHtml(field.label)}</span>` : ""}
          <div class="mari-native-settings-picker" role="group">${chips || `<p class="mari-native-settings-status">${escapeMariBridgeSettingsHtml(field.emptyText || "No options.")}</p>`}</div>
          ${field.help ? `<span class="mari-native-settings-help">${escapeMariBridgeSettingsHtml(field.help)}</span>` : ""}
        </div>
      `;
    }
    return renderFieldShell(field, `<input class="mari-native-settings-control"${setting} value="${escapeAttribute(field.value ?? "")}"${field.disabled ? " disabled" : ""}>`);
  }

  function renderFieldShell(field, controlHtml) {
    return `
      <label class="mari-native-settings-field">
        ${field.label ? `<span class="mari-native-settings-label">${escapeMariBridgeSettingsHtml(field.label)}</span>` : ""}
        ${controlHtml}
        ${field.help ? `<span class="mari-native-settings-help">${escapeMariBridgeSettingsHtml(field.help)}</span>` : ""}
      </label>
    `;
  }

  function renderNativeActions(actions) {
    return `<div class="mari-native-settings-actions">${actions.map((action) => `<button type="button" class="mari-editor-action ${action.variant === "primary" ? "mari-editor-action--accent" : ""} inline-flex" data-mari-native-action="${escapeAttribute(action.id)}">${escapeMariBridgeSettingsHtml(action.label)}</button>`).join("")}</div>`;
  }

  function escapeMariBridgeSettingsHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeMariBridgeSettingsHtml(value);
  }

  // bridge-sdk/client.js
  function readyClientRuntime() {
    const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
    return runtime?.status === "ready" && typeof runtime.registerConsumer === "function" ? runtime : null;
  }

  async function waitForClientRuntime(timeoutMs) {
    const timeout = Math.max(0, Math.min(30_000, Number(timeoutMs) || 0));
    const deadline = Date.now() + timeout;
    let runtime = readyClientRuntime();
    while (!runtime && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
      runtime = readyClientRuntime();
    }
    return runtime;
  }

  async function activateClientWithMariBridge(input, activateConsumer) {
    if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
    const requirements = normalizeBridgeRequirements(input);
    const runtime = readyClientRuntime() ?? await waitForClientRuntime(input?.waitForBridgeMs ?? 5_000);
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

})();
