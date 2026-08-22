(async () => {
  "use strict";
  // bridge/contracts.js
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

  // bridge/settings.js
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

  // bridge/client.js
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

  // src/client/runtime.js
  const cleanupGroupSortClient = await activateClientWithMariBridge(
    {
      consumerId: "group-sort-order",
      api: { major: 1, minMinor: 0 },
      require: ["chat.active", "client.bridge-first", "consumer.sessions", "generation.lifecycle", "runtime.health", "ui.chat-settings", "ui.composer.above-input"],
    },
    async (bridgeSession) => {
  return (function () {
    const PACKAGE_ID = "group-sort-order";
    const TAG_NAME = "marinara-capability-group-sort-order";
    const ROOT_ID = "marinara-group-sort-order-root";
    const STYLE_ID = "marinara-group-sort-order-style";
    const RUNTIME_KEY = "__marinaraGroupSortOrderRuntime";
    const RUNTIME_VERSION = "2.2.0";

    const previousState = window[RUNTIME_KEY];
    if (previousState && previousState.version !== RUNTIME_VERSION) {
      previousState.disposed = true;
      previousState.slotCleanup?.();
      previousState.settingsCleanup?.();
      previousState.cleanups?.forEach?.((cleanup) => cleanup());
      window.clearTimeout(previousState.pollTimer);
      window.clearTimeout(previousState.renderTimer);
      window.clearTimeout(previousState.followupTimer);
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      window[RUNTIME_KEY] = null;
    }

    const state = window[RUNTIME_KEY] || {
      version: RUNTIME_VERSION,
      disposed: false,
      initialized: false,
      activeChatId: "",
      lastEnsuredChatId: "",
      lastView: null,
      lastRefreshAt: 0,
      barNode: null,
      pollTimer: 0,
      renderTimer: 0,
      followupTimer: 0,
      refreshing: false,
      slotCleanup: null,
      settingsCleanup: null,
      settingsNodes: new Set(),
      cleanups: [],
      ensureInFlight: new Set(),
    };
    state.version = RUNTIME_VERSION;
    window[RUNTIME_KEY] = state;
    state.disposed = false;

    injectStyle(STYLE_ID, styleText());
    defineCapabilityElement();

    if (!state.initialized) {
      state.initialized = true;
      startRuntime();
    }

    function defineCapabilityElement() {
      if (customElements.get(TAG_NAME)) return;

      class GroupSortOrderCapabilityElement extends HTMLElement {
        connectedCallback() {
          this.addEventListener("marinara-capability-props", this);
          this.style.display = "block";
          bindActiveChat(this.capabilityProps?.chatId || bridgeSession.chat.active.getSnapshot().chatId || "");
          this.render();
        }

        disconnectedCallback() {
          this.removeEventListener("marinara-capability-props", this);
          if (state.barNode === this) state.barNode = null;
          state.settingsNodes.delete(this);
        }

        handleEvent(event) {
          if (event.type === "marinara-capability-props") {
            bindActiveChat(this.capabilityProps?.chatId || bridgeSession.chat.active.getSnapshot().chatId || "");
            this.render();
          }
        }

        render() {
          if (["settings", "detail"].includes(this.getAttribute("view"))) {
            state.settingsNodes.add(this);
            void renderSettings(this);
            return;
          }
          state.settingsNodes.delete(this);
          renderBar(this);
        }
      }

      customElements.define(TAG_NAME, GroupSortOrderCapabilityElement);
    }

    function startRuntime() {
      state.slotCleanup = bridgeSession.ui.register({
        id: "next-speaker",
        slot: "composer.above-input",
        view: "surface",
        priority: 40,
      });
      state.settingsCleanup = bridgeSession.ui.register({
        id: "settings",
        slot: "chat.settings",
        view: "settings",
        priority: 40,
      });
      state.cleanups.push(bridgeSession.chat.active.subscribe(({ chatId }) => bindActiveChat(chatId || "")));
      on(document, "visibilitychange", scheduleRefreshFromEvent, true);
      on(window, "focus", scheduleRefreshFromEvent);
      on(window, "marinara:generation-complete", scheduleRefreshFromEvent);
      on(window, "marinara:generation-error", scheduleRefreshFromEvent);
      scheduleComposerSlotRender(0);
    }

    function on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      state.cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function scheduleRefreshFromEvent(event) {
      const eventChatId = typeof event?.detail?.chatId === "string" ? event.detail.chatId : "";
      if (eventChatId && state.activeChatId && eventChatId !== state.activeChatId) return;
      state.lastRefreshAt = 0;
      scheduleViewRefresh(150);
      scheduleComposerSlotRender(100);
      if (state.followupTimer) window.clearTimeout(state.followupTimer);
      state.followupTimer = window.setTimeout(() => {
        state.followupTimer = 0;
        state.lastRefreshAt = 0;
        scheduleViewRefresh(0);
      }, 1250);
    }

    function injectStyle(id, css) {
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }

    function scheduleComposerSlotRender(delay = 0) {
      window.setTimeout(() => updateBar(state.barNode, state.lastView), Math.max(0, delay));
    }

    function scheduleViewRefresh(delay) {
      if (state.disposed) return;
      if (state.renderTimer) window.clearTimeout(state.renderTimer);
      state.renderTimer = window.setTimeout(runViewRefresh, delay);
    }

    function runViewRefresh() {
      state.renderTimer = 0;
      if (state.disposed) return;
      const chatId = state.activeChatId;
      if (chatId && chatId !== state.lastEnsuredChatId && !state.ensureInFlight.has(chatId)) {
        void ensure(chatId);
      } else if (chatId && Date.now() - state.lastRefreshAt > 1500) {
        void refreshView(chatId);
      }
      if (state.pollTimer) window.clearTimeout(state.pollTimer);
      state.pollTimer = window.setTimeout(runViewRefresh, 2000);
    }

    function bindActiveChat(chatId) {
      const nextChatId = typeof chatId === "string" ? chatId.trim() : "";
      if (nextChatId === state.activeChatId) return;
      state.activeChatId = nextChatId;
      state.lastView = null;
      state.lastRefreshAt = 0;
      updateBar(state.barNode, null);
      if (nextChatId) scheduleViewRefresh(0);
    }

    async function ensure(chatId) {
      state.ensureInFlight.add(chatId);
      try {
        const persona = await readPersonaCandidate(chatId).catch(() => null);
        await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/ensure`, {
          method: "POST",
          body: JSON.stringify({ personaCandidate: persona }),
        });
        state.lastEnsuredChatId = chatId;
      } catch (error) {
        warn("ensure failed", error);
      } finally {
        state.ensureInFlight.delete(chatId);
        await refreshView(chatId);
      }
    }

    async function refreshView(chatId) {
      try {
        state.lastRefreshAt = Date.now();
        const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/state`);
        if (chatId !== state.activeChatId) return;
        state.lastView = view;
        updateBar(state.barNode, view);
        scheduleComposerSlotRender(0);
      } catch (error) {
        warn("state refresh failed", error);
        updateBar(state.barNode, { enabled: true, hidden: true, nextSpeaker: null, includePersonaCandidate: false, status: "unknown" });
      }
    }

    function renderBar(host) {
      host.id = ROOT_ID;
      host.className = "mari-bridge-slot-contribution gso-root";
      host.innerHTML = [
        '<span class="gso-label">Next</span>',
        '<strong class="gso-next">Unknown</strong>',
        '<button type="button" class="gso-icon-button gso-persona" aria-label="Include persona candidate" title="Include persona candidate" aria-pressed="false">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>' +
        "</button>",
        '<button type="button" class="gso-icon-button gso-refresh" aria-label="Refresh next speaker" title="Refresh next speaker">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.36 6.36L4 16"/><path d="M4 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.36 5.64L20 8"/><path d="M20 3v5h-5"/></svg>' +
        "</button>",
      ].join("");
      host.querySelector(".gso-refresh")?.addEventListener("click", onRefreshClick);
      host.querySelector(".gso-persona")?.addEventListener("click", onPersonaToggle);
      state.barNode = host;
      updateBar(host, state.lastView);
      return host;
    }

    async function onRefreshClick() {
      const chatId = state.activeChatId;
      if (!chatId) return;
      const button = state.barNode?.querySelector(".gso-refresh");
      state.refreshing = true;
      updateBar(state.barNode, state.lastView);
      if (button) button.disabled = true;
      try {
        const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/refresh`, { method: "POST", body: "{}" });
        if (chatId !== state.activeChatId) return;
        state.lastView = view;
        updateBar(state.barNode, view);
        scheduleComposerSlotRender(0);
      } catch (error) {
        warn("refresh failed", error);
        await refreshView(chatId);
      } finally {
        state.refreshing = false;
        updateBar(state.barNode, state.lastView);
      }
    }

    async function onPersonaToggle() {
      const chatId = state.activeChatId;
      if (!chatId) return;
      const checked = state.lastView?.includePersonaCandidate !== true;
      try {
        const persona = await readPersonaCandidate(chatId).catch(() => null);
        const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/settings`, {
          method: "PATCH",
          body: JSON.stringify({
            includePersonaCandidate: checked,
            personaCandidate: persona,
          }),
        });
        if (chatId !== state.activeChatId) return;
        state.lastView = view;
        updateBar(state.barNode, view);
        scheduleComposerSlotRender(0);
      } catch (error) {
        warn("settings update failed", error);
        await refreshView(chatId);
      }
    }

    async function renderSettings(root) {
      const detailView = root.getAttribute("view") === "detail";
      const chatId = root.capabilityProps?.chatId || state.activeChatId;
      if (!chatId) {
        setMariBridgeNativeSettingsHtml(root, `no-chat:${detailView}`, {
          surface: detailView ? "detail" : "chat",
          title: "Group Sort Order",
          subtitle: "Open a Roleplay chat",
          iconText: "GS",
          sections: [{ html: '<p class="mari-native-settings-muted">Open a Roleplay chat to configure Group Sort Order.</p>' }],
        });
        return;
      }
      root.setAttribute("aria-busy", "true");
      try {
        const [view, connections] = await Promise.all([
          api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/state`),
          api("/connections").catch(() => []),
        ]);
        if (!root.isConnected || (root.capabilityProps?.chatId || state.activeChatId) !== chatId) return;
        const settings = normalizeObject(view.settings);
        const options = [
          { value: "", label: "Use Agent default" },
          { value: "random", label: "Random pool" },
          ...(Array.isArray(connections) ? connections : []).map((connection) => ({
            value: connection?.id || "",
            label: `${connection?.name || connection?.model || connection?.id || "Connection"}${connection?.model ? ` — ${connection.model}` : ""}`,
          })),
        ];
        setMariBridgeNativeSettingsHtml(root, `${detailView}:${chatId}:${JSON.stringify(settings)}:${JSON.stringify(options)}`, {
          surface: detailView ? "detail" : "chat",
          title: "Group Sort Order",
          subtitle: root.capabilityProps?.chatName || "Current chat",
          iconText: "GS",
          activation: detailView ? {
            enabled: root.capabilityProps?.enabledForChat === true,
            description: "Group Sort Order only applies to chats where this agent is enabled.",
          } : null,
          sections: [
            {
              title: "Next speaker controls",
              description: "Controls the terminal next-speaker marker and the optional hidden selector call for this chat.",
              badge: { label: view.enabled ? "Active in chat" : "Not active", muted: !view.enabled },
              fields: [
                { type: "switch", settingAttribute: "data-gso-setting", name: "includePersonaCandidate", label: "Include persona candidate", help: "Allow the current persona to be selected as the next participant.", checked: view.includePersonaCandidate === true },
                { type: "select", settingAttribute: "data-gso-setting", name: "selectorConnectionId", label: "Selector connection / model", help: "Used only by Refresh. Normal replies still use the chat model.", value: settings.selectorConnectionId || "", options },
              ],
            },
            {
              title: "Prompt and marker templates",
              description: "These values are inserted into the main generation prompt and stripped from the final message after generation.",
              fields: [
                { type: "input", settingAttribute: "data-gso-setting", name: "markerTemplate", label: "Terminal marker", help: "Must contain exactly one {{speaker_id}}.", value: settings.markerTemplate || "" },
                { type: "textarea", settingAttribute: "data-gso-setting", name: "promptTemplate", label: "Main-response instruction", help: "Macros: {{candidates}}, {{marker}}, {{excluded_candidate_id}}.", rows: 8, value: settings.promptTemplate || "" },
                { type: "textarea", settingAttribute: "data-gso-setting", name: "selectorPrompt", label: "Refresh selector prompt", rows: 7, value: settings.selectorPrompt || "" },
              ],
              html: '<p class="mari-native-settings-status" data-gso-settings-status></p>',
            },
          ],
          actions: [
            { id: "reset", label: "Reset defaults" },
            { id: "save", label: "Save", variant: "primary" },
          ],
        });
        root.querySelector('[data-mari-native-action="back"]')?.addEventListener("click", () => root.capabilityProps?.onClose?.());
        root.querySelector('[data-mari-native-action="toggle-agent"]')?.addEventListener("click", async () => {
          const next = root.capabilityProps?.enabledForChat !== true;
          const button = root.querySelector('[data-mari-native-action="toggle-agent"]');
          if (button) button.disabled = true;
          try {
            await root.capabilityProps?.onEnabledForChatChange?.(next);
          } finally {
            if (button) button.disabled = false;
          }
        });
        root.querySelector('[data-mari-native-action="save"]')?.addEventListener("click", () => saveGsoSettings(root, chatId, false));
        root.querySelector('[data-mari-native-action="reset"]')?.addEventListener("click", () => saveGsoSettings(root, chatId, true));
      } catch (error) {
        setMariBridgeNativeSettingsHtml(root, `error:${chatId}:${error.message}`, {
          surface: detailView ? "detail" : "chat",
          title: "Group Sort Order",
          subtitle: root.capabilityProps?.chatName || "Current chat",
          iconText: "GS",
          sections: [{ html: `<p class="mari-native-settings-error">Group Sort Order settings could not load: ${escapeMariBridgeSettingsHtml(error.message)}</p>` }],
        });
      } finally {
        root.removeAttribute("aria-busy");
      }
    }

    async function saveGsoSettings(root, chatId, reset) {
      const status = root.querySelector("[data-gso-settings-status]");
      root.setAttribute("aria-busy", "true");
      if (status) status.textContent = "Saving…";
      const read = (name) => root.querySelector(`[data-gso-setting="${name}"]`);
      const body = reset ? {
        markerTemplate: null,
        promptTemplate: null,
        selectorPrompt: null,
        selectorConnectionId: null,
      } : {
        includePersonaCandidate: read("includePersonaCandidate")?.checked === true,
        markerTemplate: read("markerTemplate")?.value || "",
        promptTemplate: read("promptTemplate")?.value || "",
        selectorPrompt: read("selectorPrompt")?.value || "",
        selectorConnectionId: read("selectorConnectionId")?.value || null,
      };
      try {
        const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/settings`, { method: "PATCH", body: JSON.stringify(body) });
        if (chatId === state.activeChatId) state.lastView = view;
        root.dataset.mariBridgeSettingsRenderKey = "";
        await renderSettings(root);
      } catch (error) {
        if (status) status.textContent = `Save failed: ${error.message}`;
      } finally {
        root.removeAttribute("aria-busy");
      }
    }

    function updateBar(root, view) {
      if (!root) return;
      const shouldHide = !state.activeChatId || view?.enabled === false || view?.hidden !== false;
      root.hidden = shouldHide;
      root.dataset.status = typeof view?.status === "string" ? view.status : "unknown";
      if (root.dataset.chatId !== (state.activeChatId || "")) root.dataset.chatId = state.activeChatId || "";
      root.querySelector(".gso-next").textContent = state.refreshing ? "Refreshing..." : view?.nextSpeaker?.name || "Unknown";
      const personaButton = root.querySelector(".gso-persona");
      if (personaButton) personaButton.setAttribute("aria-pressed", view?.includePersonaCandidate === true ? "true" : "false");
      const refreshButton = root.querySelector(".gso-refresh");
      if (refreshButton) refreshButton.disabled = state.refreshing || view?.canRefresh !== true;
    }

    async function readPersonaCandidate(chatId) {
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
      const personaId = typeof chat?.personaId === "string" ? chat.personaId : "";
      if (!personaId) return null;
      const persona = await api(`/characters/personas/${encodeURIComponent(personaId)}`).catch(() => null);
      const data = normalizeObject(persona?.data ?? persona);
      return { id: personaId, name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : personaId };
    }

    async function api(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (options.body !== undefined && !headers["content-type"] && !headers["Content-Type"]) {
        headers["content-type"] = "application/json";
      }
      const response = await fetch(`/api${path}`, {
        headers,
        ...options,
      });
      if (!response.ok) throw new Error(await response.text());
      if (response.status === 204) return {};
      return response.json();
    }

    function normalizeObject(value) {
      if (!value) return {};
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
          return {};
        }
      }
      return typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    function styleText() {
      return `
        #${ROOT_ID} { display:flex; align-items:center; gap:8px; min-height:28px; padding:4px 8px 6px; font:12px system-ui,sans-serif; color:var(--muted-foreground,#9ca3af); }
        #${ROOT_ID}[hidden] { display:none !important; }
        #${ROOT_ID} .gso-label { text-transform:uppercase; letter-spacing:.04em; font-size:10px; opacity:.78; }
        #${ROOT_ID} .gso-next { color:var(--foreground,#f8fafc); font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #${ROOT_ID} .gso-persona { margin-left:auto; }
        #${ROOT_ID} .gso-icon-button { display:inline-flex; width:26px; height:26px; align-items:center; justify-content:center; border:1px solid color-mix(in srgb,var(--foreground,#f8fafc) 16%,transparent); border-radius:999px; padding:0; background:color-mix(in srgb,var(--secondary,#1f2937) 72%,transparent); color:color-mix(in srgb,var(--foreground,#f8fafc) 82%,transparent); line-height:1; }
        #${ROOT_ID} .gso-icon-button:hover:not(:disabled) { background:color-mix(in srgb,var(--foreground,#f8fafc) 10%,transparent); color:var(--foreground,#f8fafc); }
        #${ROOT_ID} .gso-icon-button[aria-pressed="true"] { color:var(--primary,#93c5fd); border-color:color-mix(in srgb,var(--primary,#93c5fd) 45%,transparent); background:color-mix(in srgb,var(--primary,#93c5fd) 16%,transparent); }
        #${ROOT_ID} .gso-icon-button svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
        #${ROOT_ID} button:disabled { opacity:.5; }
      `;
    }

    function warn(...args) {
      console.warn("[Group Sort Order]", ...args);
    }

    window.marinaraGroupSortOrder = {
      refresh() {
        return state.activeChatId ? refreshView(state.activeChatId) : Promise.resolve();
      },
      state,
      dispose() {
        state.disposed = true;
        state.slotCleanup?.();
        state.settingsCleanup?.();
        state.cleanups.forEach((cleanup) => cleanup());
        state.cleanups = [];
        window.clearTimeout(state.pollTimer);
        window.clearTimeout(state.renderTimer);
        window.clearTimeout(state.followupTimer);
        state.slotCleanup = null;
        state.settingsCleanup = null;
        state.barNode = null;
        document.getElementById(ROOT_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();
      },
    };
    return async () => {
      state.disposed = true;
      state.slotCleanup?.();
      state.settingsCleanup?.();
      state.slotCleanup = null;
      state.settingsCleanup = null;
      for (const cleanup of state.cleanups.splice(0)) cleanup();
      window.clearTimeout(state.pollTimer);
      window.clearTimeout(state.renderTimer);
      window.clearTimeout(state.followupTimer);
      state.initialized = false;
    };
  })();
    },
  );

  void cleanupGroupSortClient;

})();
