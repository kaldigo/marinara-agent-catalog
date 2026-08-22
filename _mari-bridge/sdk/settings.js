export const MARI_BRIDGE_SETTINGS_STYLE_ID = "mari-bridge-sdk-settings-style";

export function ensureMariBridgeSettingsStyles() {
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

export function prepareMariBridgeSettingsRoot(root, options = {}) {
  if (!(root instanceof Element)) throw new TypeError("Mari Bridge settings root must be an Element");
  ensureMariBridgeSettingsStyles();
  root.classList.add("mari-sdk-settings");
  root.classList.toggle("mari-sdk-settings-detail", options.surface === "detail");
  return root;
}

export function setMariBridgeSettingsHtml(root, renderKey, html) {
  prepareMariBridgeSettingsRoot(root);
  const key = String(renderKey ?? "");
  if (root.dataset.mariBridgeSettingsRenderKey === key) return false;
  root.dataset.mariBridgeSettingsRenderKey = key;
  root.innerHTML = String(html ?? "");
  return true;
}

const MARI_BRIDGE_NATIVE_SETTINGS_STYLE_ID = "mari-bridge-sdk-native-settings-style";

export function ensureMariBridgeNativeSettingsStyles() {
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

export function setMariBridgeNativeSettingsHtml(root, renderKey, descriptor = {}) {
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

export function renderMariBridgeNativeSettingsHtml(descriptor = {}) {
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

export function escapeMariBridgeSettingsHtml(value) {
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
