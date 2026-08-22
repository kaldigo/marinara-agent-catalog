(async () => {
  "use strict";
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


  function parseMessageRange(tokens, messages) {
    const list = Array.isArray(messages) ? messages : [];
    const parts = Array.isArray(tokens) ? tokens.map(String) : tokenizeCommandTail(String(tokens || ""));
    const joined = parts.join(" ").trim().toLowerCase();
    if (!joined) throw new Error("Range is required.");
    if (joined === "all") return list;
    if (parts[0]?.toLowerCase() === "last") {
      const count = Math.max(0, Math.floor(Number(parts[1])));
      if (!count) throw new Error("Use last <number>.");
      return list.slice(-count);
    }
    if (parts[0]?.toLowerCase() === "from" && parts[2]?.toLowerCase() === "to") {
      return selectIndexRange(list, Number(parts[1]), Number(parts[3]));
    }
    const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/u);
    if (dash) return selectIndexRange(list, Number(dash[1]), Number(dash[2]));
    const single = Number(joined);
    if (Number.isInteger(single) && single > 0) return selectIndexRange(list, single, single);
    throw new Error(`Unsupported range: ${parts.join(" ")}`);
  }

  function selectIndexRange(messages, start, end) {
    const list = Array.isArray(messages) ? messages : [];
    const left = Math.max(1, Math.min(start, end));
    const right = Math.min(list.length, Math.max(start, end));
    if (!Number.isFinite(left) || !Number.isFinite(right) || left > list.length) {
      throw new Error("Range is outside the loaded chat.");
    }
    return list.slice(left - 1, right);
  }

  function tokenizeCommandTail(text) {
    const tokens = [];
    const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/gu;
    for (const match of String(text || "").matchAll(pattern)) {
      tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/gu, "$1"));
    }
    return tokens;
  }

  function looksLikeNativeMessageRange(value) {
    const text = String(value || "").trim().toLowerCase();
    return text === "all" || /^last\s+\d+$/u.test(text) || /^from\s+\d+\s+to\s+\d+$/u.test(text) || /^\d+(?:\s*-\s*\d+)?$/u.test(text);
  }

  function createHideCommandOwner() {
    return ({ tokens }) => Boolean(tokens?.[0]) && !looksLikeNativeMessageRange(tokens[0]);
  }


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



  const cleanupPresenceClient = await activateClientWithMariBridge(
    {
      consumerId: "presence",
      api: { major: 1, minMinor: 0 },
      require: ["chat.active", "client.bridge-first", "commands", "consumer.sessions", "runtime.health", "ui.chat-settings"],
    },
    async (bridgeSession) => {

  const PACKAGE_ID = "presence";
  const TAG_NAME = "marinara-capability-presence";
  const state = window.__marinaraPresencePackageRuntime || {
    initialized: false,
    commandDisposers: [],
    chatSettingsDisposer: null,
    activeChatId: "",
    pendingChatId: "",
    chatWatcherCleanup: null,
    ensureTimer: 0,
    ensureInFlight: new Set(),
    lastEnsureAttemptAt: 0,
    lastEnsureAttemptChatId: "",
    settingsTimer: 0,
    settingsDataByChatId: new Map(),
    settingsLoadingChatIds: new Set(),
    settingsLoadPromisesByChatId: new Map(),
    settingsElements: new Set(),
  };
  window.__marinaraPresencePackageRuntime = state;
  state.activeChatId = typeof state.activeChatId === "string" ? state.activeChatId : "";
  state.chatSettingsDisposer = typeof state.chatSettingsDisposer === "function" ? state.chatSettingsDisposer : null;
  state.pendingChatId = typeof state.pendingChatId === "string" ? state.pendingChatId : "";
  state.chatWatcherCleanup = typeof state.chatWatcherCleanup === "function" ? state.chatWatcherCleanup : null;
  state.ensureTimer = Number(state.ensureTimer) || 0;
  state.ensureInFlight = state.ensureInFlight instanceof Set ? state.ensureInFlight : new Set();
  state.settingsDataByChatId = state.settingsDataByChatId instanceof Map ? state.settingsDataByChatId : new Map();
  state.settingsLoadingChatIds = state.settingsLoadingChatIds instanceof Set ? state.settingsLoadingChatIds : new Set();
  state.settingsLoadPromisesByChatId =
    state.settingsLoadPromisesByChatId instanceof Map ? state.settingsLoadPromisesByChatId : new Map();
  state.commandDisposers = Array.isArray(state.commandDisposers) ? state.commandDisposers : [];
  state.lastEnsureAttemptAt = Number(state.lastEnsureAttemptAt) || 0;
  state.lastEnsureAttemptChatId = typeof state.lastEnsureAttemptChatId === "string" ? state.lastEnsureAttemptChatId : "";
  state.settingsTimer = Number(state.settingsTimer) || 0;
  state.settingsElements = state.settingsElements instanceof Set ? state.settingsElements : new Set();

  class PresenceCapabilityElement extends HTMLElement {
    constructor() {
      super();
      this.onCapabilityProps = () => this.render();
    }

    static get observedAttributes() {
      return ["view"];
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (name === "view" && oldValue !== newValue && this.isConnected) this.render();
    }

    connectedCallback() {
      this.addEventListener("marinara-capability-props", this.onCapabilityProps);
      state.settingsElements.add(this);
      this.render();
    }

    disconnectedCallback() {
      this.removeEventListener("marinara-capability-props", this.onCapabilityProps);
      state.settingsElements.delete(this);
    }

    render() {
      const view = this.getAttribute("view");
      if (view !== "settings" && view !== "detail") {
        this.hidden = true;
        this.setAttribute("aria-hidden", "true");
        this.replaceChildren();
        return;
      }
      this.hidden = false;
      this.removeAttribute("aria-hidden");
      const mount = getSettingsRenderRoot(this);
      mount.dataset.presenceDetailView = view === "detail" ? "true" : "false";
      const chatId = getChatIdFromCapabilityProps(this.capabilityProps) || getActiveChatId();
      this.dataset.chatId = chatId || "";
      if (!chatId) {
        renderPresenceSettingsNotice(mount, "Open a chat to configure Presence.");
        return;
      }
      const cached = state.settingsDataByChatId.get(chatId);
      if (cached) renderPresenceSettingsSection(mount, cached);
      else renderPresenceSettingsLoading(mount);
      if (!cached || Date.now() - cached.loadedAt >= 5_000) {
        loadPresenceSettings(chatId).then(() => {
          if (this.isConnected && ["settings", "detail"].includes(this.getAttribute("view")) && this.dataset.chatId === chatId) this.render();
        });
      }
    }
  }

  if (!customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, PresenceCapabilityElement);
  }

  if (!state.initialized) {
    state.initialized = true;
    registerPresenceCommands();
  }
  if (!state.chatSettingsDisposer) registerPresenceChatSettings();
  if (!state.chatWatcherCleanup) startChatLifecycleDetection();

  function registerPresenceChatSettings() {
    state.chatSettingsDisposer = bridgeSession.ui.register({
      id: "presence.settings",
      slot: "chat.settings",
      view: "settings",
      props: () => ({ enabledForChat: true }),
    });
  }

  function startChatLifecycleDetection() {
    state.chatWatcherCleanup = bridgeSession.chat.active.subscribe(({ chatId }) => scheduleEnsureActiveChat(chatId));
  }

  function getActiveChatId() {
    return bridgeSession.chat.active.getSnapshot().chatId || "";
  }

  function scheduleEnsureActiveChat(chatId = getActiveChatId()) {
    state.pendingChatId = chatId || "";
    if (state.ensureTimer) window.clearTimeout(state.ensureTimer);
    state.ensureTimer = window.setTimeout(ensureActiveChat, 150);
    scheduleRenderPresenceSettings();
  }

  async function ensureActiveChat() {
    state.ensureTimer = 0;
    const chatId = state.pendingChatId || getActiveChatId();
    state.pendingChatId = "";
    const now = Date.now();
    if (!chatId || chatId === state.activeChatId || state.ensureInFlight.has(chatId)) return;
    if (chatId === state.lastEnsureAttemptChatId && now - state.lastEnsureAttemptAt < 10_000) return;
    state.lastEnsureAttemptAt = now;
    state.lastEnsureAttemptChatId = chatId;
    state.ensureInFlight.add(chatId);
    try {
      const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/ensure`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || `${response.status} ${response.statusText}`);
      }
      state.activeChatId = chatId;
    } catch (error) {
      console.warn("[Presence] chat lifecycle ensure failed", error);
    } finally {
      state.ensureInFlight.delete(chatId);
    }
  }

  function scheduleRenderPresenceSettings() {
    if (state.settingsTimer) window.clearTimeout(state.settingsTimer);
    state.settingsTimer = window.setTimeout(() => {
      state.settingsTimer = 0;
      for (const element of state.settingsElements) {
        if (element instanceof PresenceCapabilityElement) element.render();
      }
    }, 100);
  }

  function getChatIdFromCapabilityProps(props) {
    const chatId = props?.chatId;
    return typeof chatId === "string" && chatId.trim() ? chatId.trim() : "";
  }

  function getSettingsRenderRoot(element) {
    const current = element.firstElementChild;
    if (current instanceof HTMLElement && current.dataset.presenceSettingsRoot === "true") return current;
    const root = document.createElement("div");
    root.dataset.presenceSettingsRoot = "true";
    element.replaceChildren(root);
    return root;
  }

  async function loadPresenceSettings(chatId, { force = false } = {}) {
    const cached = state.settingsDataByChatId.get(chatId);
    if (!force && cached && Date.now() - cached.loadedAt < 5_000) return cached;
    const existingLoad = state.settingsLoadPromisesByChatId.get(chatId);
    if (existingLoad && !force) return existingLoad;
    state.settingsLoadingChatIds.add(chatId);
    let loadPromise;
    loadPromise = (async () => {
      try {
        const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/state`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
        const normalized = normalizeSettingsData(data);
        state.settingsDataByChatId.set(chatId, normalized);
        return normalized;
      } catch (error) {
        const fallback = {
          chatId,
          enabled: true,
          error: error instanceof Error ? error.message : String(error),
          loadedAt: Date.now(),
          roster: [],
          state: { alwaysPresentCharacterIds: [] },
        };
        state.settingsDataByChatId.set(chatId, fallback);
        return fallback;
      } finally {
        state.settingsLoadingChatIds.delete(chatId);
        if (state.settingsLoadPromisesByChatId.get(chatId) === loadPromise) state.settingsLoadPromisesByChatId.delete(chatId);
      }
    })();
    state.settingsLoadPromisesByChatId.set(chatId, loadPromise);
    return loadPromise;
  }

  function normalizeSettingsData(data) {
    const roster = Array.isArray(data?.roster)
      ? data.roster
          .filter((character) => character && typeof character.id === "string")
          .map((character) => ({
            id: character.id,
            name: typeof character.name === "string" && character.name.trim() ? character.name.trim() : character.id,
            avatarUrl: typeof character.avatarUrl === "string" && character.avatarUrl.trim() ? character.avatarUrl.trim() : null,
          }))
      : [];
    return {
      chatId: typeof data?.chatId === "string" ? data.chatId : "",
      enabled: data?.enabled !== false,
      loadedAt: Date.now(),
      roster,
      state: {
        alwaysPresentCharacterIds: uniqueStrings(data?.state?.alwaysPresentCharacterIds),
      },
    };
  }

  function renderPresenceSettingsLoading(mount) {
    setPresenceNativeSettings(mount, `loading:${mount.dataset.chatId || ""}`, {
      sections: [{ html: '<p class="mari-native-settings-muted">Loading Presence settings...</p>' }],
    });
    bindPresenceChromeActions(mount);
  }

  function renderPresenceSettingsNotice(mount, message) {
    setPresenceNativeSettings(mount, `notice:${message}`, {
      sections: [{ html: `<p class="mari-native-settings-muted">${escapeMariBridgeSettingsHtml(message)}</p>` }],
    });
    bindPresenceChromeActions(mount);
  }

  function renderPresenceSettingsSection(mount, data) {
    if (data.error) {
      mount.hidden = false;
      renderPresenceSettingsNotice(mount, `Presence settings could not load: ${data.error}`);
      return;
    }
    mount.hidden = false;
    const alwaysPresent = new Set(uniqueStrings(data.state?.alwaysPresentCharacterIds));
    const renderKey = JSON.stringify({
      chatId: data.chatId,
      roster: data.roster.map((character) => [character.id, character.name, character.avatarUrl]),
      alwaysPresent: [...alwaysPresent].sort(),
    });
    const activeCount = alwaysPresent.size;
    const changed = setPresenceNativeSettings(mount, renderKey, {
      sections: [
        {
          title: "Always present",
          description: "Selected characters see every non-globally-hidden message, even while inactive. Use this for narrators or other cards that should always know the full scene.",
          badge: activeCount > 0 ? { label: `${activeCount} selected` } : null,
          fields: [
            {
              type: "chips",
              optionAttribute: "data-presence-always-character-id",
              emptyText: "No characters in this chat.",
              options: data.roster.map((character) => ({
                value: character.id,
                label: character.name,
                avatarUrl: character.avatarUrl,
                selected: alwaysPresent.has(character.id),
              })),
            },
          ],
        },
      ],
    });
    if (!changed) return;
    bindPresenceChromeActions(mount);
    for (const button of mount.querySelectorAll("[data-presence-always-character-id]")) {
      button.addEventListener("click", () => {
        const characterId = button.getAttribute("data-presence-always-character-id");
        if (!characterId) return;
        toggleAlwaysPresentCharacter(data.chatId, characterId);
      });
    }
  }

  function bindPresenceChromeActions(mount) {
    mount.querySelector('[data-mari-native-action="back"]')?.addEventListener("click", () => mount.parentElement?.capabilityProps?.onClose?.());
    mount.querySelector('[data-mari-native-action="toggle-agent"]')?.addEventListener("click", async () => {
      const element = mount.parentElement;
      const next = element?.capabilityProps?.enabledForChat !== true;
      const button = mount.querySelector('[data-mari-native-action="toggle-agent"]');
      if (button) button.disabled = true;
      try {
        await element?.capabilityProps?.onEnabledForChatChange?.(next);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  function setPresenceNativeSettings(mount, renderKey, descriptor) {
    const host = mount.parentElement;
    const chatName = host?.capabilityProps?.chatName || "Current chat";
    const enabled = host?.capabilityProps?.enabledForChat === true;
    return setMariBridgeNativeSettingsHtml(mount, renderKey, {
      surface: mount.dataset.presenceDetailView === "true" ? "detail" : "chat",
      title: "Presence",
      subtitle: chatName,
      iconText: "PR",
      activation: mount.dataset.presenceDetailView === "true" ? {
        enabled,
        description: "Presence only tracks chats where this agent is enabled.",
      } : null,
      ...descriptor,
    });
  }

  async function toggleAlwaysPresentCharacter(chatId, characterId) {
    const current = state.settingsDataByChatId.get(chatId);
    if (!current) return;
    const next = new Set(uniqueStrings(current.state?.alwaysPresentCharacterIds));
    if (next.has(characterId)) next.delete(characterId);
    else next.add(characterId);
    const optimistic = {
      ...current,
      state: { ...current.state, alwaysPresentCharacterIds: [...next] },
      loadedAt: Date.now(),
    };
    state.settingsDataByChatId.set(chatId, optimistic);
    scheduleRenderPresenceSettings();
    try {
      const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alwaysPresentCharacterIds: [...next] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
      state.settingsDataByChatId.set(chatId, normalizeSettingsData({
        ...data,
        chatId,
        roster: current.roster,
        enabled: true,
      }));
    } catch (error) {
      console.warn("[Presence] could not update always-present characters", error);
      state.settingsDataByChatId.set(chatId, current);
    } finally {
      scheduleRenderPresenceSettings();
    }
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))];
  }

  async function runServerCommand(raw, context) {
    const chatId = context?.chatId || getActiveChatId();
    if (!chatId) throw new Error("No active chat detected.");
    const response = await fetch(`/api/${PACKAGE_ID}/chat/${encodeURIComponent(chatId)}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: raw }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `${response.status} ${response.statusText}`);
    return data;
  }

  function registerPresenceCommands() {
    state.commandDisposers.push(
      bridgeSession.commands.register({
        id: "presence.command",
        commands: ["/presence"],
        description: "Show or update character presence for this chat",
        usage: "/presence [status or character]",
        handler: ({ raw, context }) => runServerCommand(raw, context),
      }),
    );
    state.commandDisposers.push(
      bridgeSession.commands.register({
        id: "hide-from-ai.augment",
        hijacks: ["/hide", "/unhide"],
        owns: createHideCommandOwner(),
        handler: ({ raw, context }) => runServerCommand(raw, context),
      }),
    );
  }

  return async () => {
    if (state.ensureTimer) window.clearTimeout(state.ensureTimer);
    if (state.settingsTimer) window.clearTimeout(state.settingsTimer);
    state.chatWatcherCleanup?.();
    state.chatWatcherCleanup = null;
    state.chatSettingsDisposer?.();
    state.chatSettingsDisposer = null;
    for (const dispose of state.commandDisposers.splice(0)) dispose();
    state.initialized = false;
  };
    },
  );

  void cleanupPresenceClient;

})();
