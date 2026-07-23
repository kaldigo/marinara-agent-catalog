(function () {
  const PACKAGE_ID = "group-sort-order";
  const TAG_NAME = "marinara-capability-group-sort-order";
  const ROOT_ID = "marinara-group-sort-order-root";
  const STYLE_ID = "marinara-group-sort-order-style";

  let disposed = false;
  let lastChatId = "";
  let pollTimer = 0;

  injectStyle();
  defineCapabilityElement();
  tick();

  function defineCapabilityElement() {
    if (customElements.get(TAG_NAME)) return;

    class GroupSortOrderCapabilityElement extends HTMLElement {
      connectedCallback() {
        this.hidden = true;
        this.setAttribute("aria-hidden", "true");
      }
    }

    customElements.define(TAG_NAME, GroupSortOrderCapabilityElement);
  }

  function tick() {
    if (disposed) return;
    const chatId = readChatId();
    if (chatId && chatId !== lastChatId) {
      lastChatId = chatId;
      ensure(chatId);
    }
    renderShell();
    pollTimer = window.setTimeout(tick, 1500);
  }

  async function ensure(chatId) {
    const persona = await readPersonaCandidate(chatId).catch(() => null);
    await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/ensure`, {
      method: "POST",
      body: JSON.stringify({ personaCandidate: persona }),
    }).catch(() => null);
    await refreshView(chatId);
  }

  async function refreshView(chatId) {
    const view = await api(`/group-sort-order/chat/${encodeURIComponent(chatId)}/state`).catch(() => null);
    updateBar(view);
  }

  function renderShell() {
    if (!lastChatId || document.getElementById(ROOT_ID)) return;
    const input =
      document.querySelector("textarea") ||
      document.querySelector("[contenteditable='true']") ||
      document.querySelector("form");
    if (!input?.parentElement) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = [
      '<span class="gso-label">Next</span>',
      '<strong class="gso-next">Unknown</strong>',
      '<label class="gso-toggle"><input type="checkbox" class="gso-persona"> Include persona</label>',
      '<button type="button" class="gso-refresh">Refresh</button>',
    ].join("");
    input.parentElement.insertBefore(root, input);
    root.querySelector(".gso-refresh")?.addEventListener("click", async () => {
      const button = root.querySelector(".gso-refresh");
      button.disabled = true;
      try {
        await api(`/group-sort-order/chat/${encodeURIComponent(lastChatId)}/refresh`, { method: "POST" });
        await refreshView(lastChatId);
      } finally {
        button.disabled = false;
      }
    });
    root.querySelector(".gso-persona")?.addEventListener("change", async (event) => {
      const persona = await readPersonaCandidate(lastChatId).catch(() => null);
      await api(`/group-sort-order/chat/${encodeURIComponent(lastChatId)}/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          includePersonaCandidate: event.target.checked,
          personaCandidate: persona,
        }),
      }).catch(() => null);
      await refreshView(lastChatId);
    });
  }

  function updateBar(view) {
    const root = document.getElementById(ROOT_ID);
    if (!root || !view) return;
    root.hidden = view.hidden || !view.enabled;
    root.querySelector(".gso-next").textContent = view.nextSpeaker?.name || "Unknown";
    const checkbox = root.querySelector(".gso-persona");
    if (checkbox) checkbox.checked = view.includePersonaCandidate === true;
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
    const response = await fetch(`/api${path}`, {
      headers: { "content-type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) throw new Error(await response.text());
    if (response.status === 204) return {};
    return response.json();
  }

  function readChatId() {
    const match = location.pathname.match(/\/chats?\/([^/?#]+)/u) || location.hash.match(/chatId=([^&#]+)/u);
    return match ? decodeURIComponent(match[1]) : "";
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

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} { display:flex; align-items:center; gap:8px; padding:6px 8px; font:12px system-ui,sans-serif; color:var(--muted-foreground,#9ca3af); }
      #${ROOT_ID}[hidden] { display:none !important; }
      #${ROOT_ID} .gso-next { color:var(--foreground,#f8fafc); font-weight:600; }
      #${ROOT_ID} .gso-toggle { display:flex; align-items:center; gap:4px; margin-left:auto; }
      #${ROOT_ID} button { border:1px solid var(--border,#334155); border-radius:6px; padding:3px 8px; background:var(--secondary,#1f2937); color:inherit; }
      #${ROOT_ID} button:disabled { opacity:.5; }
    `;
    document.head.appendChild(style);
  }

  window.marinaraGroupSortOrder = {
    dispose() {
      disposed = true;
      window.clearTimeout(pollTimer);
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
    },
  };
})();
