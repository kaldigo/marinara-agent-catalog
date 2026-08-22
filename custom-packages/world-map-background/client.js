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

// src/client/runtime.js
const cleanupWorldMapBackgroundClient = await activateClientWithMariBridge(
  {
    consumerId: "world-map-background",
    api: { major: 1, minMinor: 0 },
    require: ["chat.active", "client.bridge-first", "consumer.sessions", "runtime.health", "ui.chat-settings"],
  },
  async (bridgeSession) => {
  const PACKAGE_ID = "world-map-background";
  const WORLD_MAPS_AGENT_ID = "hierarchical-maps";
  const TAG_NAME = "marinara-capability-world-map-background";
  const STYLE_ID = "marinara-world-map-background-style";
  const RUNTIME_KEY = "__marinaraWorldMapBackgroundRuntime";
  const OWNER_STORAGE_KEY = "marinara-world-map-background-owner";
  const RUNTIME_VERSION = "1.1.1";
  const CAPABILITY_SERVER_EVENT = "marinara-capability-server-event";
  const GLOBAL_GALLERY_PREFIX = "global-gallery:";
  const SYNC_INTERVAL_MS = 2500;
  const API_TIMEOUT_MS = 10000;

  const previousState = window[RUNTIME_KEY];
  if (previousState && previousState.version !== RUNTIME_VERSION) {
    previousState.disposed = true;
    previousState.cleanups?.forEach?.((cleanup) => cleanup());
    previousState.settingsCleanup?.();
    window.clearTimeout(previousState.syncTimer);
    removeLiveBackground();
    window[RUNTIME_KEY] = null;
  }

  const state = window[RUNTIME_KEY] || {
    version: RUNTIME_VERSION,
    initialized: false,
    disposed: false,
    activeChatId: "",
    syncing: false,
    syncRequested: false,
    syncTimer: 0,
    syncDueAt: 0,
    lastSyncKey: "",
    lastAppliedUrl: "",
    cleanups: [],
    settingsCleanup: null,
  };
  state.version = RUNTIME_VERSION;
  state.disposed = false;
  window[RUNTIME_KEY] = state;

  injectStyle(STYLE_ID, styleText());
  defineCapabilityElement();
  document.documentElement.dataset.mariBridgeConsumerWorldMap = "ready";

  if (!state.initialized) {
    state.initialized = true;
    startRuntime();
  }

  function defineCapabilityElement() {
    if (customElements.get(TAG_NAME)) return;

    class WorldMapBackgroundCapabilityElement extends HTMLElement {
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
          this.setAttribute("aria-hidden", "true");
          this.style.display = "contents";
          this.replaceChildren();
          return;
        }
        this.removeAttribute("aria-hidden");
        this.style.display = "block";
        void renderWorldMapBackgroundSettings(this);
      }
    }

    customElements.define(TAG_NAME, WorldMapBackgroundCapabilityElement);
  }

  function startRuntime() {
    state.settingsCleanup = bridgeSession.ui.register({ id: "settings", slot: "chat.settings", view: "settings", priority: 20 });
    state.cleanups.push(bridgeSession.chat.active.subscribe(({ chatId }) => {
      bindActiveChat(chatId || "");
      scheduleSync(0);
    }));
    on(document, "visibilitychange", () => {
      if (!document.hidden) scheduleSync(100);
    });
    on(window, "focus", () => scheduleSync(100));
    on(window, CAPABILITY_SERVER_EVENT, handleCapabilityServerEvent);
    on(window, "marinara:generation-complete", handleGenerationSettled);
    on(window, "marinara:generation-error", handleGenerationSettled);
    scheduleSync(0);
  }

  function handleCapabilityServerEvent(event) {
    const detail = normalizeObject(event?.detail);
    if (detail.packageId !== WORLD_MAPS_AGENT_ID) return;
    if (detail.chatId && detail.chatId !== state.activeChatId) return;
    if (detail.type !== "spatial_transition_committed" && detail.type !== "spatial_context_refresh") return;
    scheduleSync(0);
  }

  function handleGenerationSettled(event) {
    const detail = normalizeObject(event?.detail);
    if (detail.chatId && detail.chatId !== state.activeChatId) return;
    scheduleSync(250);
  }

  function on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  function injectStyle(id, cssText) {
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = cssText;
    return style;
  }

  function bindActiveChat(chatId) {
    const nextChatId = typeof chatId === "string" ? chatId.trim() : "";
    if (nextChatId === state.activeChatId) return;
    state.activeChatId = nextChatId;
    state.lastSyncKey = "";
    state.lastAppliedUrl = "";
    removeLiveBackground();
  }

  function scheduleSync(delayMs = SYNC_INTERVAL_MS) {
    if (state.disposed) return;
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }

    const normalizedDelay = Math.max(0, Number(delayMs) || 0);
    const dueAt = Date.now() + normalizedDelay;
    if (state.syncTimer && state.syncDueAt && state.syncDueAt <= dueAt) return;
    if (state.syncTimer) window.clearTimeout(state.syncTimer);
    state.syncDueAt = dueAt;
    state.syncTimer = window.setTimeout(runSync, normalizedDelay);
  }

  async function runSync() {
    state.syncTimer = 0;
    state.syncDueAt = 0;
    if (state.disposed) return;
    if (state.syncing) {
      state.syncRequested = true;
      return;
    }
    state.syncing = true;
    try {
      const chatId = state.activeChatId;
      if (!chatId) {
        removeLiveBackground();
        return;
      }
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`).catch(() => null);
      if (!chat || chatId !== state.activeChatId) return;

      const metadata = normalizeObject(chat.metadata);
      if (!isAgentActive(chat, metadata)) {
        await clearOwnedBackground(chatId, metadata);
        removeLiveBackground();
        return;
      }

      const image = await resolveCurrentLocationImage(chatId).catch((error) => {
        warn("location image lookup failed", error);
        return null;
      });
      if (!image || chatId !== state.activeChatId) {
        await clearOwnedBackground(chatId, metadata);
        removeLiveBackground();
        return;
      }

      const displaySettings = normalizeWorldMapBackgroundSettings(metadata.worldMapBackground);
      const syncKey = `${chatId}:${image.referenceImageId}:${image.url}:${JSON.stringify(displaySettings)}`;
      if (!applyLiveBackground(image.url, displaySettings)) return;
      if (state.lastSyncKey === syncKey && metadata.background === image.url) return;
      state.lastSyncKey = syncKey;
      await persistOwnedBackground(chatId, metadata, image);
    } catch (error) {
      warn("background synchronization failed", error);
    } finally {
      state.syncing = false;
      const nextDelay = state.syncRequested ? 0 : SYNC_INTERVAL_MS;
      state.syncRequested = false;
      scheduleSync(nextDelay);
    }
  }

  function isAgentActive(chat, metadata) {
    if (chat?.mode && chat.mode !== "roleplay") return false;
    if (metadata.enableAgents !== true) return false;
    const activeAgentIds = Array.isArray(metadata.activeAgentIds) ? metadata.activeAgentIds : [];
    return activeAgentIds.includes(PACKAGE_ID) && activeAgentIds.includes(WORLD_MAPS_AGENT_ID);
  }

  async function resolveCurrentLocationImage(chatId) {
    const spatial = await api(`/chats/${encodeURIComponent(chatId)}/spatial-context`);
    const definition = normalizeObject(spatial?.definition);
    if (definition.enabled === false) return null;

    const currentLocationId = typeof spatial?.currentLocationId === "string" ? spatial.currentLocationId.trim() : "";
    const locations = Array.isArray(definition.locations) ? definition.locations : [];
    const current = locations.find((location) => location?.id === currentLocationId && location?.status !== "archived");
    if (!current || current.useReferenceImage !== true) return null;

    const referenceImageId = typeof current.referenceImageId === "string" ? current.referenceImageId.trim() : "";
    if (!referenceImageId) return null;

    const [chatImages, globalImages] = await Promise.all([
      api(`/gallery/${encodeURIComponent(chatId)}`).catch(() => []),
      api("/global-gallery").catch(() => []),
    ]);
    const image = resolveGalleryImage(referenceImageId, chatImages, globalImages);
    if (!image?.url) return null;

    return {
      referenceImageId,
      url: image.url,
    };
  }

  function resolveGalleryImage(referenceImageId, chatImages, globalImages) {
    const normalized = referenceImageId.trim();
    const chatMatch = asArray(chatImages).find((image) => image?.id === normalized);
    if (chatMatch) return chatMatch;

    const globalId = normalized.startsWith(GLOBAL_GALLERY_PREFIX)
      ? normalized.slice(GLOBAL_GALLERY_PREFIX.length).trim()
      : normalized;
    return asArray(globalImages).find((image) => {
      const id = typeof image?.id === "string" ? image.id.trim() : "";
      return id && (id === globalId || normalized === `${GLOBAL_GALLERY_PREFIX}${id}`);
    });
  }

  async function persistOwnedBackground(chatId, metadata, image) {
    const owners = readOwnerState();
    const currentOwner = owners[chatId] || {};
    const currentBackground = typeof metadata.background === "string" ? metadata.background : null;
    const previousBackground =
      currentBackground && currentBackground !== currentOwner.currentUrl ? currentBackground : currentOwner.previousBackground ?? null;

    if (currentBackground !== image.url) {
      await patchChatMetadata(chatId, { background: image.url });
    }

    owners[chatId] = {
      referenceImageId: image.referenceImageId,
      currentUrl: image.url,
      previousBackground,
      updatedAt: Date.now(),
    };
    writeOwnerState(owners);
    state.lastAppliedUrl = image.url;
  }

  async function clearOwnedBackground(chatId, metadata) {
    const owners = readOwnerState();
    const owner = owners[chatId];
    if (!owner) return;

    const currentBackground = typeof metadata.background === "string" ? metadata.background : null;
    if (currentBackground === owner.currentUrl) {
      await patchChatMetadata(chatId, { background: owner.previousBackground ?? null }).catch((error) =>
        warn("background restore failed", error),
      );
    }
    delete owners[chatId];
    writeOwnerState(owners);
    state.lastAppliedUrl = "";
  }

  function applyLiveBackground(url, displaySettings = normalizeWorldMapBackgroundSettings()) {
    const root = findRoleplayRoot();
    if (!root) return false;

    let image = root.querySelector(":scope > .wmb-live-background");
    if (!image) {
      image = document.createElement("img");
      image.className = "wmb-live-background";
      image.alt = "";
      image.draggable = false;
      const overlay = root.querySelector(":scope > .rpg-overlay");
      root.insertBefore(image, overlay || root.firstChild);
      image.addEventListener("load", () => {
        image.dataset.loadState = "loaded";
        scheduleSync(0);
      });
      image.addEventListener("error", () => {
        warn("background image failed to load; retrying", new Error(image.currentSrc || image.src || url));
        image.remove();
        scheduleSync(1000);
      });
    }
    if (image.getAttribute("src") !== url) {
      image.dataset.loadState = "loading";
      image.setAttribute("src", url);
    }
    image.setAttribute("data-reference-owned-by", PACKAGE_ID);
    image.style.objectFit = displaySettings.fit;
    image.style.objectPosition = displaySettings.position;
    image.style.opacity = String(displaySettings.opacity);
    image.style.filter = displaySettings.blur > 0 ? `blur(${displaySettings.blur}px)` : "none";
    image.style.transform = displaySettings.blur > 0 ? "scale(1.02)" : "none";
    if (image.complete && image.naturalWidth > 0) image.dataset.loadState = "loaded";
    return image.dataset.loadState === "loaded";
  }

  function findRoleplayRoot() {
    const exact = document.querySelector(
      '[data-component="ChatArea.Roleplay"] .rpg-chat-area[data-chat-mode="roleplay"]',
    );
    if (exact) return exact;
    return document.querySelector('.rpg-chat-area[data-chat-mode="roleplay"]');
  }

  function removeLiveBackground() {
    document.querySelectorAll(".wmb-live-background").forEach((node) => node.remove());
  }

  async function patchChatMetadata(chatId, metadata) {
    return api(`/chats/${encodeURIComponent(chatId)}/metadata`, {
      method: "PATCH",
      headers: { "x-marinara-csrf": "1" },
      body: JSON.stringify(metadata),
    });
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined && !headers["content-type"] && !headers["Content-Type"]) {
      headers["content-type"] = "application/json";
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await fetch(`/api${path}`, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      if (response.status === 204) return {};
      return response.json();
    } finally {
      window.clearTimeout(timeout);
    }
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

  function normalizeWorldMapBackgroundSettings(value = {}) {
    const input = normalizeObject(value);
    const fit = input.fit === "contain" ? "contain" : "cover";
    const allowedPositions = new Set(["center", "top", "bottom", "left", "right"]);
    const position = allowedPositions.has(input.position) ? input.position : "center";
    const opacityValue = Number(input.opacity);
    const blurValue = Number(input.blur);
    return {
      fit,
      position,
      opacity: Number.isFinite(opacityValue) ? Math.min(1, Math.max(0.1, opacityValue)) : 1,
      blur: Number.isFinite(blurValue) ? Math.min(20, Math.max(0, blurValue)) : 0,
    };
  }

  async function renderWorldMapBackgroundSettings(root) {
    prepareMariBridgeSettingsRoot(root);
    const chatId = root.capabilityProps?.chatId || state.activeChatId;
    if (!chatId) {
      setMariBridgeSettingsHtml(root, "no-chat", '<p class="mari-sdk-settings-status">Open a chat to configure World Map Background.</p>');
      return;
    }
    root.setAttribute("aria-busy", "true");
    try {
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`);
      const metadata = normalizeObject(chat?.metadata);
      const settings = normalizeWorldMapBackgroundSettings(metadata.worldMapBackground);
      setMariBridgeSettingsHtml(root, `${chatId}:${JSON.stringify(settings)}`, `
        <section class="mari-sdk-settings-group">
          <div class="mari-sdk-settings-heading"><h3 class="mari-sdk-settings-title">World Map Background</h3></div>
          <p class="mari-sdk-settings-description">Controls how the current World Maps location image is displayed in this chat.</p>
          <div class="mari-sdk-settings-grid">
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Image fit</span><select class="mari-sdk-settings-select" data-wmb-setting="fit"><option value="cover"${settings.fit === "cover" ? " selected" : ""}>Cover</option><option value="contain"${settings.fit === "contain" ? " selected" : ""}>Contain</option></select></label>
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Position</span><select class="mari-sdk-settings-select" data-wmb-setting="position">${["center","top","bottom","left","right"].map((value) => `<option value="${value}"${settings.position === value ? " selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label>
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Opacity</span><input class="mari-sdk-settings-input" type="number" min="10" max="100" step="5" data-wmb-setting="opacity" value="${Math.round(settings.opacity * 100)}"><span class="mari-sdk-settings-help">10–100 percent.</span></label>
            <label class="mari-sdk-settings-field"><span class="mari-sdk-settings-label">Blur</span><input class="mari-sdk-settings-input" type="number" min="0" max="20" step="1" data-wmb-setting="blur" value="${settings.blur}"><span class="mari-sdk-settings-help">0–20 pixels.</span></label>
          </div>
          <p class="mari-sdk-settings-status" data-wmb-status></p>
          <div class="mari-sdk-settings-actions"><button type="button" class="mari-sdk-settings-button" data-wmb-reset>Reset defaults</button><button type="button" class="mari-sdk-settings-button" data-variant="primary" data-wmb-save>Save</button></div>
        </section>
      `);
      root.querySelector("[data-wmb-save]")?.addEventListener("click", () => saveWorldMapBackgroundSettings(root, chatId, false));
      root.querySelector("[data-wmb-reset]")?.addEventListener("click", () => saveWorldMapBackgroundSettings(root, chatId, true));
    } catch (error) {
      setMariBridgeSettingsHtml(root, `error:${chatId}:${error.message}`, `<p class="mari-sdk-settings-status">World Map Background settings could not load: ${escapeMariBridgeSettingsHtml(error.message)}</p>`);
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  async function saveWorldMapBackgroundSettings(root, chatId, reset) {
    const status = root.querySelector("[data-wmb-status]");
    if (status) status.textContent = "Saving…";
    const read = (name) => root.querySelector(`[data-wmb-setting="${name}"]`);
    const value = reset ? {} : normalizeWorldMapBackgroundSettings({
      fit: read("fit")?.value,
      position: read("position")?.value,
      opacity: Number(read("opacity")?.value) / 100,
      blur: Number(read("blur")?.value),
    });
    try {
      await patchChatMetadata(chatId, { worldMapBackground: value });
      state.lastSyncKey = "";
      scheduleSync(0);
      root.dataset.mariBridgeSettingsRenderKey = "";
      await renderWorldMapBackgroundSettings(root);
    } catch (error) {
      if (status) status.textContent = `Save failed: ${error.message}`;
    }
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function readOwnerState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(OWNER_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeOwnerState(value) {
    try {
      localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(value));
    } catch {}
  }

  function warn(message, error) {
    console.warn(`[${PACKAGE_ID}] ${message}`, error);
  }

  function styleText() {
    return `
      .wmb-live-background {
        pointer-events: none;
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
        user-select: none;
        opacity: 1;
        transition: opacity 700ms ease-in-out;
      }
    `;
  }
  return () => {
    state.disposed = true;
    state.cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    state.settingsCleanup?.();
    window.clearTimeout(state.syncTimer);
    document.getElementById(STYLE_ID)?.remove();
    delete document.documentElement.dataset.mariBridgeConsumerWorldMap;
    removeLiveBackground();
    if (window[RUNTIME_KEY] === state) delete window[RUNTIME_KEY];
  };
  },
);

