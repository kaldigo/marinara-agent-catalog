import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";
import { GM_NOTE_KINDS } from "../shared/state.js";

const cleanupGmNotesClient = await activateClientWithMariBridge(
  {
    consumerId: "gm-notes",
    api: { major: 1, minMinor: 1 },
    require: [
      "chat.active",
      "client.bridge-first",
      "consumer.sessions",
      "generation.lifecycle",
      "runtime.health",
      "ui.roleplay-hud",
      "ui.tracker-panel"
    ],
  },
  async (bridgeSession) => {
    const TAG_NAME = "marinara-capability-gm-notes";
    const runtime = window.__marinaraGmNotesRuntime ?? {
      cache: new Map(),
      elements: new Set(),
      loads: new Map(),
      styleReady: false,
      rerunning: new Set(),
    };
    window.__marinaraGmNotesRuntime = runtime;

    class GmNotesElement extends HTMLElement {
      constructor() {
        super();
        this.hudOpen = false;
        this.handleProps = () => this.refresh();
      }

      static get observedAttributes() { return ["view"]; }
      attributeChangedCallback() { if (this.isConnected) this.refresh(); }
      connectedCallback() {
        runtime.elements.add(this);
        this.addEventListener("marinara-capability-props", this.handleProps);
        injectStyles();
        this.refresh();
      }
      disconnectedCallback() {
        runtime.elements.delete(this);
        this.removeEventListener("marinara-capability-props", this.handleProps);
      }
      get chatId() {
        return typeof this.capabilityProps?.chatId === "string"
          ? this.capabilityProps.chatId
          : bridgeSession.chat.active.getSnapshot().chatId || "";
      }
      async refresh(force = false) {
        const view = this.getAttribute("view");
        if (!this.chatId || !["tracker-panel", "hud"].includes(view)) {
          this.hidden = true;
          this.replaceChildren();
          return;
        }
        const cached = runtime.cache.get(this.chatId);
        if (!cached || force || Date.now() - cached.loadedAt > 5_000) void loadState(this.chatId, force);
        this.render(cached);
      }
      render(data = runtime.cache.get(this.chatId)) {
        const enabled = data?.enabled === true;
        this.hidden = !enabled;
        if (!enabled) {
          this.replaceChildren();
          return;
        }
        const view = this.getAttribute("view");
        this.innerHTML = view === "hud" ? renderHud(this, data) : renderTracker(data);
      }
      async onClick(event) {
        const button = event.target instanceof Element ? event.target.closest("[data-gm-notes-action]") : null;
        if (!(button instanceof HTMLElement)) return;
        const action = button.dataset.gmNotesAction;
        if (action === "toggle-hud") {
          this.hudOpen = !this.hudOpen;
          this.render();
          return;
        }
        if (action === "rerun") return rerun(this.chatId);
        if (action === "add") {
          const kindInput = window.prompt("Note kind: reminder, thread, or debug", "thread")?.trim().toLowerCase();
          if (!GM_NOTE_KINDS.includes(kindInput)) return;
          const noteText = window.prompt("GM note")?.trim();
          if (noteText) await updateState(this.chatId, [{ action: "create", kind: kindInput, text: noteText }]);
          return;
        }
        const id = button.dataset.noteId;
        if (!id) return;
        const current = runtime.cache.get(this.chatId)?.notes?.find((note) => note.id === id);
        if (!current) return;
        if (action === "remove") {
          if (window.confirm("Remove this GM note?")) await updateState(this.chatId, [{ action: "remove", id }]);
          return;
        }
        if (action === "edit") {
          const noteText = window.prompt("Edit GM note", current.text)?.trim();
          if (noteText && noteText !== current.text) {
            await updateState(this.chatId, [{ action: "update", id, kind: current.kind, text: noteText }]);
          }
        }
      }
    }

    if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, GmNotesElement);
    const handleDocumentClick = (event) => {
      const button = event.target instanceof Element
        ? event.target.closest(`${TAG_NAME} [data-gm-notes-action]`)
        : null;
      const element = button?.closest(TAG_NAME);
      if (element && typeof element.onClick === "function") void element.onClick(event);
    };
    document.addEventListener("click", handleDocumentClick, true);

    function notify(chatId) {
      for (const element of runtime.elements) {
        if (element instanceof GmNotesElement && element.chatId === chatId) element.render();
      }
    }

    async function loadState(chatId, force = false) {
      if (!chatId) return null;
      if (!force && runtime.loads.has(chatId)) return runtime.loads.get(chatId);
      const request = (async () => {
        try {
          const response = await fetch(`/api/gm-notes/chat/${encodeURIComponent(chatId)}/state`, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || `GM Notes state failed (${response.status})`);
          const next = { ...data, notes: Array.isArray(data.notes) ? data.notes : [], loadedAt: Date.now() };
          runtime.cache.set(chatId, next);
          return next;
        } catch (error) {
          const next = { chatId, enabled: false, notes: [], error: error instanceof Error ? error.message : String(error), loadedAt: Date.now() };
          runtime.cache.set(chatId, next);
          return next;
        } finally {
          runtime.loads.delete(chatId);
          notify(chatId);
        }
      })();
      runtime.loads.set(chatId, request);
      return request;
    }

    async function updateState(chatId, updates) {
      const response = await fetch(`/api/gm-notes/chat/${encodeURIComponent(chatId)}/state`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `GM Notes update failed (${response.status})`);
      runtime.cache.set(chatId, { ...data, notes: Array.isArray(data.notes) ? data.notes : [], loadedAt: Date.now() });
      notify(chatId);
    }

    async function rerun(chatId) {
      if (!chatId || runtime.rerunning.has(chatId)) return;
      runtime.rerunning.add(chatId);
      notify(chatId);
      try {
        const response = await fetch("/api/generate/retry-agents", {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, agentTypes: ["gm-notes"], streaming: true }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data?.error || `GM Notes rerun failed (${response.status})`);
        }
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          while (!(await reader.read()).done) { /* drain native SSE */ }
        }
        await loadState(chatId, true);
      } catch (error) {
        console.warn("[GM Notes] tracker rerun failed", error);
      } finally {
        runtime.rerunning.delete(chatId);
        notify(chatId);
      }
    }

    function renderTracker(data) {
      const groups = groupNotes(data.notes);
      return `<section class="gm-notes-panel" aria-label="GM Notes">
        <header class="gm-notes-panel__header">
          <div><strong>GM Notes</strong><span>${data.notes.length}/20</span></div>
          <div class="gm-notes-actions">
            <button type="button" data-gm-notes-action="rerun" title="Re-run GM Notes" ${runtime.rerunning.has(data.chatId) ? "disabled" : ""}>↻</button>
            <button type="button" data-gm-notes-action="add" title="Add GM note">＋</button>
          </div>
        </header>
        <div class="gm-notes-panel__body">${renderGroups(groups, true)}</div>
      </section>`;
    }

    function renderHud(element, data) {
      const preview = data.notes.at(-1)?.text ?? "GM Notes";
      return `<div class="gm-notes-hud">
        <button type="button" class="gm-notes-hud__button" data-gm-notes-action="toggle-hud" title="GM Notes" aria-expanded="${element.hudOpen}">
          <span aria-hidden="true">✎</span><span class="gm-notes-hud__count">${data.notes.length}</span>
        </button>
        ${element.hudOpen ? `<div class="gm-notes-hud__popover">
          <header><strong>GM Notes</strong><button type="button" data-gm-notes-action="rerun" ${runtime.rerunning.has(data.chatId) ? "disabled" : ""}>↻</button></header>
          <p class="gm-notes-hud__preview">${escapeHtml(preview)}</p>
          ${renderGroups(groupNotes(data.notes), false)}
        </div>` : ""}
      </div>`;
    }

    function groupNotes(notes) {
      return GM_NOTE_KINDS.map((kind) => [kind, notes.filter((note) => note.kind === kind)]);
    }

    function renderGroups(groups, editable) {
      const names = { reminder: "Reminders", thread: "Threads", debug: "Debug" };
      const marks = { reminder: "R", thread: "T", debug: "D" };
      const content = groups.filter(([, notes]) => notes.length > 0).map(([kind, notes]) => `
        <section class="gm-notes-group gm-notes-group--${kind}">
          <h4><span>${marks[kind]}</span>${names[kind]}<small>${notes.length}</small></h4>
          <ul>${notes.map((note) => `<li><p>${escapeHtml(note.text)}</p>${editable ? `<div><button type="button" data-gm-notes-action="edit" data-note-id="${escapeHtml(note.id)}">Edit</button><button type="button" data-gm-notes-action="remove" data-note-id="${escapeHtml(note.id)}">Remove</button></div>` : ""}</li>`).join("")}</ul>
        </section>`).join("");
      return content || '<p class="gm-notes-empty">No GM notes recorded yet.</p>';
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[character]);
    }

    function injectStyles() {
      if (runtime.styleReady || document.getElementById("gm-notes-style")) return;
      const style = document.createElement("style");
      style.id = "gm-notes-style";
      style.textContent = `
        marinara-mari-bridge-slot[name="tracker.panel"] { display:block; }
        marinara-mari-bridge-slot[name="roleplay.hud"] { display:inline-flex; }
        marinara-capability-gm-notes[view="tracker-panel"] { display:block; padding:.45rem .6rem .75rem; }
        .gm-notes-panel { border:1px solid color-mix(in srgb,var(--border) 85%,transparent); border-radius:.65rem; background:color-mix(in srgb,var(--card) 20%,transparent); overflow:hidden; }
        .gm-notes-panel__header { align-items:center; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; padding:.55rem .65rem; }
        .gm-notes-panel__header>div:first-child { align-items:baseline; display:flex; gap:.4rem; font-size:.72rem; }
        .gm-notes-panel__header span,.gm-notes-group small { color:var(--muted-foreground); font-size:.56rem; font-weight:500; }
        .gm-notes-actions { display:flex; gap:.25rem; }
        .gm-notes-actions button,.gm-notes-hud__popover header button { background:transparent; border:1px solid var(--border); border-radius:.35rem; color:var(--muted-foreground); cursor:pointer; font-size:.72rem; min-height:1.65rem; min-width:1.65rem; }
        .gm-notes-panel__body { display:grid; gap:.55rem; padding:.6rem; }
        .gm-notes-group h4 { align-items:center; display:flex; gap:.35rem; font-size:.64rem; margin:0 0 .3rem; text-transform:uppercase; }
        .gm-notes-group h4>span { align-items:center; border:1px solid currentColor; border-radius:999px; display:inline-flex; font-size:.5rem; height:1rem; justify-content:center; width:1rem; }
        .gm-notes-group h4 small { margin-left:auto; }
        .gm-notes-group ul { display:grid; gap:.3rem; list-style:none; margin:0; padding:0; }
        .gm-notes-group li { border-left:2px solid color-mix(in srgb,currentColor 55%,transparent); border-radius:.25rem; background:color-mix(in srgb,var(--background) 40%,transparent); padding:.4rem .45rem; }
        .gm-notes-group--reminder { color:#eab308; }.gm-notes-group--thread { color:#34d399; }.gm-notes-group--debug { color:#fb7185; }
        .gm-notes-group p { color:var(--foreground); font-size:.64rem; line-height:1.4; margin:0; }
        .gm-notes-group li>div { display:flex; gap:.45rem; margin-top:.3rem; }
        .gm-notes-group li>div button { background:none; border:0; color:var(--muted-foreground); cursor:pointer; font-size:.55rem; padding:0; }
        .gm-notes-empty { color:var(--muted-foreground); font-size:.64rem; margin:.25rem; text-align:center; }
        marinara-capability-gm-notes[view="hud"] { align-items:center; display:inline-flex; position:relative; }
        .gm-notes-hud__button { align-items:center; background:var(--marinara-chat-chrome-button-bg,transparent); border:1px solid var(--marinara-chat-chrome-button-border,var(--border)); border-radius:.45rem; color:var(--marinara-chat-chrome-button-text,var(--foreground)); cursor:pointer; display:flex; font-size:.8rem; height:2rem; justify-content:center; min-width:2rem; position:relative; }
        .gm-notes-hud__count { align-items:center; background:var(--primary); border-radius:999px; color:var(--primary-foreground); display:flex; font-size:.48rem; height:.85rem; justify-content:center; position:absolute; right:-.28rem; top:-.28rem; min-width:.85rem; padding:0 .15rem; }
        .gm-notes-hud__popover { background:var(--popover); border:1px solid var(--border); border-radius:.65rem; bottom:calc(100% + .5rem); box-shadow:0 12px 30px rgb(0 0 0 / .35); color:var(--popover-foreground); max-height:24rem; overflow:auto; padding:.65rem; position:absolute; right:0; width:18rem; z-index:80; }
        .gm-notes-hud__popover>header { align-items:center; display:flex; justify-content:space-between; font-size:.72rem; margin-bottom:.4rem; }
        .gm-notes-hud__preview { color:var(--muted-foreground); font-size:.58rem; line-height:1.35; margin:0 0 .55rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .gm-notes-hud__popover .gm-notes-group { margin-top:.5rem; }
        button:disabled { cursor:not-allowed; opacity:.45; }
      `;
      document.head.appendChild(style);
      runtime.styleReady = true;
    }

    const disposeTracker = bridgeSession.ui.register({ id: "gm-notes.tracker", slot: "tracker.panel", view: "tracker-panel" });
    const disposeHud = bridgeSession.ui.register({ id: "gm-notes.hud", slot: "roleplay.hud", view: "hud" });
    const disposeChat = bridgeSession.chat.active.subscribe(({ chatId }) => {
      if (chatId) void loadState(chatId, true);
      for (const element of runtime.elements) element.refresh();
    });
    const disposeGeneration = bridgeSession.generation.subscribe((snapshot, event) => {
      if (snapshot.mainActive || !event?.detail?.chatId) return;
      void loadState(event.detail.chatId, true);
    }, { emitCurrent: false });

    return async () => {
      document.removeEventListener("click", handleDocumentClick, true);
      disposeGeneration();
      disposeChat();
      disposeHud();
      disposeTracker();
    };
  },
);

void cleanupGmNotesClient;
