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

export function escapeMariBridgeSettingsHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
