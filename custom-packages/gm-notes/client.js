const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 2 });
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



function readyClientRuntime() {
  const runtime = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
  return runtime?.status === "ready" && typeof runtime.registerConsumer === "function" ? runtime : null;
}

async function activateClientWithMariBridge(input, activateConsumer) {
  if (typeof activateConsumer !== "function") throw new TypeError("Mari Bridge consumer activation must be a function");
  const requirements = normalizeBridgeRequirements(input);
  const runtime = readyClientRuntime();
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


const GM_NOTES_AGENT_ID = "gm-notes";
const GM_NOTES_RESULT_TYPE = "gm_notes_update";
const GM_NOTES_NAMESPACE = "gm-notes";
const GM_NOTE_KINDS = Object.freeze(["reminder", "thread", "debug"]);

const KIND_SET = new Set(GM_NOTE_KINDS);

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function text(value, max = 600) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, max) : "";
}

function sourceStamp(value, fallback = {}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.freeze({
    messageId: text(record.messageId ?? fallback.messageId, 160),
    swipeIndex: Number.isInteger(Number(record.swipeIndex ?? fallback.swipeIndex))
      ? Math.max(0, Number(record.swipeIndex ?? fallback.swipeIndex))
      : 0,
  });
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function noteId(kind, noteText, source, index) {
  return `gmn-${stableHash(`${kind}\u0000${noteText}\u0000${source.messageId}\u0000${source.swipeIndex}\u0000${index}`)}`;
}

function normalizeGmNote(value, fallbackSource = {}, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = KIND_SET.has(value.kind) ? value.kind : null;
  const noteText = text(value.text);
  if (!kind || !noteText) return null;
  const createdSource = sourceStamp(value.createdSource, fallbackSource);
  const updatedSource = sourceStamp(value.updatedSource, createdSource);
  return Object.freeze({
    id: text(value.id, 160) || noteId(kind, noteText, createdSource, index),
    kind,
    text: noteText,
    locked: value.locked === true,
    createdSource,
    updatedSource,
  });
}

function normalizeGmNotesState(value, fallbackSource = {}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const notes = [];
  const ids = new Set();
  for (const [index, candidate] of (Array.isArray(record.notes) ? record.notes : []).entries()) {
    const note = normalizeGmNote(candidate, fallbackSource, index);
    if (!note || ids.has(note.id)) continue;
    ids.add(note.id);
    notes.push(note);
  }
  return Object.freeze({ schemaVersion: 1, notes: Object.freeze(notes) });
}

function readGmNotesFromPlayerStats(playerStats) {
  const parsed = parseMaybeJson(playerStats);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return normalizeGmNotesState(null);
  const packageState = parseMaybeJson(parsed.packageState);
  const namespace = packageState && typeof packageState === "object" && !Array.isArray(packageState)
    ? packageState[GM_NOTES_NAMESPACE]
    : null;
  return normalizeGmNotesState(parseMaybeJson(namespace));
}

function mergeGmNotesIntoPlayerStats(playerStats, gmNotesState) {
  const parsed = parseMaybeJson(playerStats);
  const base = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const parsedPackageState = parseMaybeJson(base.packageState);
  const packageState = parsedPackageState && typeof parsedPackageState === "object" && !Array.isArray(parsedPackageState)
    ? parsedPackageState
    : {};
  return {
    ...base,
    packageState: {
      ...packageState,
      [GM_NOTES_NAMESPACE]: normalizeGmNotesState(gmNotesState),
    },
  };
}

function applyGmNoteUpdates(currentState, rawUpdates, source = {}) {
  const before = normalizeGmNotesState(currentState, source);
  const notes = before.notes.map((note) => ({ ...note }));
  const updates = Array.isArray(rawUpdates) ? rawUpdates : [];
  const stamp = sourceStamp(source);
  let createIndex = 0;

  for (const update of updates) {
    if (!update || typeof update !== "object" || Array.isArray(update)) continue;
    const action = text(update.action, 24).toLowerCase();
    const id = text(update.id, 160);
    if (["remove", "delete", "resolve"].includes(action)) {
      if (!id) continue;
      const index = notes.findIndex((note) => note.id === id);
      if (index >= 0 && notes[index].locked !== true) notes.splice(index, 1);
      continue;
    }
    const kind = KIND_SET.has(update.kind) ? update.kind : null;
    const noteText = text(update.text);
    if (action === "update") {
      if (!id) continue;
      const index = notes.findIndex((note) => note.id === id);
      if (index < 0) continue;
      const previous = notes[index];
      if (previous.locked === true) continue;
      notes[index] = {
        ...previous,
        ...(kind ? { kind } : {}),
        ...(noteText ? { text: noteText } : {}),
        updatedSource: stamp,
      };
      continue;
    }
    if (action !== "create" || !kind || !noteText) continue;
    const duplicate = notes.find((note) => note.kind === kind && note.text.toLocaleLowerCase() === noteText.toLocaleLowerCase());
    if (duplicate) continue;
    const nextId = id || noteId(kind, noteText, stamp, createIndex++);
    if (notes.some((note) => note.id === nextId)) continue;
    notes.push({ id: nextId, kind, text: noteText, locked: false, createdSource: stamp, updatedSource: stamp });
  }

  const state = normalizeGmNotesState({ schemaVersion: 1, notes }, stamp);
  return Object.freeze({
    changed: JSON.stringify(before) !== JSON.stringify(state),
    state,
  });
}

function formatGmNotesForCommittedContext(playerStats) {
  const state = readGmNotesFromPlayerStats(playerStats);
  if (state.notes.length === 0) return "";
  const prefix = { reminder: "[R]", thread: "[T]", debug: "[D]" };
  return state.notes.map((note) => `${prefix[note.kind]} ${note.text}`).join("\n");
}

function gmNotesAgentState(playerStats) {
  const state = readGmNotesFromPlayerStats(playerStats);
  return state.notes.length > 0 ? state : null;
}



const PACKAGE_ID = "gm-notes";
const TAG_NAME = "marinara-capability-gm-notes";
const TOOLBAR_BUTTON_CLASS = [
  "marinara-chat-toolbar-button",
  "flex items-center justify-center rounded-lg border",
  "border-[var(--marinara-chat-chrome-button-border)]",
  "bg-[var(--marinara-chat-chrome-button-bg)]",
  "text-[var(--marinara-chat-chrome-button-text)]",
  "backdrop-blur-md transition-all",
  "hover:border-[var(--marinara-chat-chrome-button-border-hover)]",
  "hover:bg-[var(--marinara-chat-chrome-button-bg-hover)]",
  "hover:text-[var(--marinara-chat-chrome-button-text-hover)]",
  "focus-visible:outline-none focus-visible:ring-2",
  "focus-visible:ring-[var(--marinara-chat-chrome-focus-ring)]",
  "h-8 w-8 max-md:h-9 p-1 group flex-col gap-0 overflow-hidden cursor-pointer select-none",
].join(" ");
const POPOVER_CLASS = [
  "gm-notes-popover mari-chrome-token-scope marinara-chat-popover",
  "rounded-xl border border-[var(--marinara-chat-chrome-panel-border)]",
  "bg-[var(--marinara-chat-chrome-panel-bg)]",
  "text-[var(--marinara-chat-chrome-panel-text)]",
  "shadow-2xl shadow-black/40 backdrop-blur-md animate-message-in",
  "scrollbar-thin scrollbar-thumb-[var(--marinara-chat-chrome-panel-scrollbar)] scrollbar-track-transparent",
].join(" ");

const cleanupGmNotesClient = await activateClientWithMariBridge(
  {
    consumerId: PACKAGE_ID,
    api: { major: 1, minMinor: 1 },
    require: [
      "chat.active",
      "client.bridge-first",
      "consumer.sessions",
      "generation.lifecycle",
      "runtime.health",
      "ui.roleplay-hud",
      "ui.tracker-section",
    ],
  },
  async (bridgeSession) => {
    const state = { cache: new Map(), elements: new Set(), loads: new Map(), saves: new Map() };

    class GmNotesElement extends HTMLElement {
      connectedCallback() {
        this._cycleIndex = 0;
        this._adding = false;
        this._editingId = null;
        this._lockMode = false;
        this._removeMode = false;
        this._reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
        state.elements.add(this);
        this.addEventListener("marinara-capability-props", this);
        this.addEventListener("click", this);
        this.addEventListener("submit", this);
        this.addEventListener("keydown", this);
        this.addEventListener("focusout", this);
        ensureStyles();
        if (this.getAttribute("view") === "hud" && !this._reduceMotion) {
          this._cycleTimer = window.setInterval(() => {
            const notes = state.cache.get(this.chatId)?.notes ?? [];
            if (notes.length <= 1 || this.hasAttribute("data-open")) return;
            this._cycleIndex = (this._cycleIndex + 1) % notes.length;
            this.render();
          }, 3000);
        }
        void this.refresh();
      }

      disconnectedCallback() {
        state.elements.delete(this);
        this.removeEventListener("marinara-capability-props", this);
        this.removeEventListener("click", this);
        this.removeEventListener("submit", this);
        this.removeEventListener("keydown", this);
        this.removeEventListener("focusout", this);
        if (this._cycleTimer) window.clearInterval(this._cycleTimer);
        this.closePopover();
      }

      handleEvent(event) {
        if (event.type === "marinara-capability-props") {
          this._adding = false;
          this._lockMode = false;
          this._removeMode = false;
          if (this.chatId && state.cache.has(this.chatId)) this.render();
          else void this.refresh(true);
          return;
        }
        if (event.type === "click") {
          const action = event.target instanceof Element ? event.target.closest("[data-gm-notes-action]") : null;
          if (!action) return;
          const name = action.getAttribute("data-gm-notes-action");
          if (name === "toggle") {
            if (this.hasAttribute("data-open")) this.closePopover();
            else {
              this.setAttribute("data-open", "");
              this.render();
            }
          } else if (name === "add-mode") {
            this._adding = !this._adding;
            this._editingId = null;
            this._lockMode = false;
            this._removeMode = false;
            this.renderAndFocus();
          } else if (name === "lock-mode") {
            this._lockMode = !this._lockMode;
            this._removeMode = false;
            this._adding = false;
            this._editingId = null;
            this.render();
          } else if (name === "remove-mode") {
            this._removeMode = !this._removeMode;
            this._lockMode = false;
            this._adding = false;
            this._editingId = null;
            this.render();
          } else if (name === "edit") {
            this._editingId = action.getAttribute("data-note-id");
            this._adding = false;
            this.renderAndFocus();
          } else if (name === "toggle-lock") {
            const noteId = action.getAttribute("data-note-id");
            if (noteId) void mutateNotes(this.chatId, (notes) => notes.map((note) => (
              note.id === noteId ? { ...note, locked: note.locked !== true } : note
            )));
          } else if (name === "remove") {
            const noteId = action.getAttribute("data-note-id");
            if (noteId) void mutateNotes(this.chatId, (notes) => notes.filter((note) => note.id !== noteId || note.locked === true));
          } else if (name === "cancel-add") {
            this._adding = false;
            this.render();
          }
          return;
        }
        if (event.type === "submit") {
          const form = event.target instanceof Element ? event.target.closest("[data-gm-note-add-form]") : null;
          if (!form) return;
          event.preventDefault();
          const formData = new FormData(form);
          const kind = String(formData.get("kind") || "");
          const text = String(formData.get("text") || "").trim();
          if (!GM_NOTE_KINDS.includes(kind) || !text) return;
          this._adding = false;
          void mutateNotes(this.chatId, (notes, gameState) => {
            const source = { messageId: gameState.messageId || "manual", swipeIndex: gameState.swipeIndex ?? 0 };
            return [...notes, {
              id: `gmn-manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              kind,
              text,
              locked: false,
              createdSource: source,
              updatedSource: source,
            }];
          });
          this.render();
          return;
        }
        if (event.type === "keydown") {
          const input = event.target instanceof Element ? event.target.closest("[data-gm-note-edit-input]") : null;
          if (!input) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            input.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            this._editingId = null;
            this.render();
          }
          return;
        }
        if (event.type === "focusout") {
          const input = event.target instanceof Element ? event.target.closest("[data-gm-note-edit-input]") : null;
          if (input && input.getAttribute("data-note-id") === this._editingId) this.commitEditor(input);
          return;
        }
        void this.refresh();
      }

      renderAndFocus() {
        this.render();
        window.requestAnimationFrame(() => {
          const root = this._popover ?? this;
          const input = root.querySelector("[data-gm-note-edit-input], [data-gm-note-add-input]");
          if (input instanceof HTMLInputElement) {
            input.focus();
            if (input.hasAttribute("data-gm-note-edit-input")) input.select();
          }
        });
      }

      commitEditor(input) {
        const noteId = input.getAttribute("data-note-id");
        const value = input.value.trim();
        this._editingId = null;
        if (!noteId || !value) {
          this.render();
          return;
        }
        void mutateNotes(this.chatId, (notes, gameState) => notes.map((note) => (
          note.id === noteId && note.locked !== true
            ? {
              ...note,
              text: value,
              updatedSource: { messageId: gameState.messageId || "manual", swipeIndex: gameState.swipeIndex ?? 0 },
            }
            : note
        )));
        this.render();
      }

      get chatId() {
        return typeof this.capabilityProps?.chatId === "string"
          ? this.capabilityProps.chatId
          : bridgeSession.chat.active.getSnapshot().chatId || "";
      }

      async refresh(force = false) {
        const view = this.getAttribute("view");
        if (!this.chatId || !["tracker-section-body", "hud"].includes(view)) {
          this.hidden = true;
          this.replaceChildren();
          this.closePopover();
          return;
        }
        if (force || !state.cache.has(this.chatId)) await loadState(this.chatId, force);
        this.render();
      }

      render() {
        const data = state.cache.get(this.chatId);
        const nativeTracker = this.getAttribute("view") === "tracker-section-body"
          && this.capabilityProps?.nativeEnabled === true;
        this.hidden = nativeTracker ? !data : data?.enabled !== true;
        if (this.hidden) {
          this.replaceChildren();
          this.closePopover();
          return;
        }
        if (this._cycleIndex >= data.notes.length) this._cycleIndex = 0;
        if (this.getAttribute("view") === "hud") {
          this.innerHTML = renderHud(this, data);
          if (this.hasAttribute("data-open")) this.renderPopover(data);
        } else {
          this.innerHTML = renderTracker(this, data);
        }
      }

      renderPopover(data) {
        if (!this._popover) {
          this._popover = document.createElement("section");
          this._popover.className = POPOVER_CLASS;
          this._popover.setAttribute("aria-label", "GM Notes");
          this._popover.addEventListener("click", this);
          this._popover.addEventListener("submit", this);
          this._popover.addEventListener("keydown", this);
          this._popover.addEventListener("focusout", this);
          document.body.appendChild(this._popover);
          this._outsideHandler = (event) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (!this.contains(target) && !this._popover?.contains(target)) {
              window.requestAnimationFrame(() => this.closePopover());
            }
          };
          this._escapeHandler = (event) => {
            if (event.key === "Escape") this.closePopover();
          };
          this._positionHandler = () => this.positionPopover();
          document.addEventListener("mousedown", this._outsideHandler);
          document.addEventListener("keydown", this._escapeHandler);
          window.addEventListener("scroll", this._positionHandler, true);
          window.addEventListener("resize", this._positionHandler);
          this._resizeObserver = new ResizeObserver(this._positionHandler);
          this._resizeObserver.observe(this._popover);
        }
        this._popover.innerHTML = renderPanel(this, data.notes, { popover: true });
        window.requestAnimationFrame(() => this.positionPopover());
      }

      positionPopover() {
        const anchor = this.querySelector('[data-gm-notes-action="toggle"]');
        if (!(anchor instanceof HTMLElement) || !this._popover) return;
        const rect = anchor.getBoundingClientRect();
        const width = this._popover.offsetWidth || 288;
        const height = this._popover.offsetHeight || 200;
        let left = window.innerWidth < 768 ? Math.round((window.innerWidth - width) / 2) : rect.left;
        if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
        const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8));
        this._popover.style.top = `${top}px`;
        this._popover.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
      }

      closePopover() {
        this.removeAttribute("data-open");
        this._resizeObserver?.disconnect();
        if (this._outsideHandler) document.removeEventListener("mousedown", this._outsideHandler);
        if (this._escapeHandler) document.removeEventListener("keydown", this._escapeHandler);
        if (this._positionHandler) {
          window.removeEventListener("scroll", this._positionHandler, true);
          window.removeEventListener("resize", this._positionHandler);
        }
        this._popover?.remove();
        this._popover = null;
        this._resizeObserver = null;
        this._outsideHandler = null;
        this._escapeHandler = null;
        this._positionHandler = null;
        const button = this.querySelector('[data-gm-notes-action="toggle"]');
        if (button) button.setAttribute("aria-expanded", "false");
      }
    }

    if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, GmNotesElement);

    async function loadState(chatId, force = false) {
      if (!chatId) return null;
      if (!force && state.loads.has(chatId)) return state.loads.get(chatId);
      const request = Promise.all([
        nativeJson(`/api/chats/${encodeURIComponent(chatId)}`),
        nativeJson(`/api/chats/${encodeURIComponent(chatId)}/game-state`),
      ]).then(([chat, gameState]) => {
        const metadata = parseRecord(chat?.metadata);
        const activeAgentIds = Array.isArray(metadata.activeAgentIds) ? metadata.activeAgentIds : [];
        const notes = readGmNotesFromPlayerStats(gameState?.playerStats).notes;
        const next = {
          chatId,
          enabled: metadata.enableAgents === true && activeAgentIds.includes(PACKAGE_ID),
          notes,
        };
        state.cache.set(chatId, next);
        notify(chatId);
        return next;
      }).catch((error) => {
        console.warn("[GM Notes] native state read failed", error);
        const next = { chatId, enabled: false, notes: [] };
        state.cache.set(chatId, next);
        notify(chatId);
        return next;
      }).finally(() => state.loads.delete(chatId));
      state.loads.set(chatId, request);
      return request;
    }

    function mutateNotes(chatId, updater) {
      if (!chatId) return Promise.resolve();
      const previous = state.saves.get(chatId) ?? Promise.resolve();
      const task = previous.catch(() => {}).then(async () => {
        const gameState = await nativeJson(`/api/chats/${encodeURIComponent(chatId)}/game-state`);
        const current = readGmNotesFromPlayerStats(gameState?.playerStats);
        const notes = updater(current.notes.map((note) => ({ ...note })), gameState);
        const playerStats = mergeGmNotesIntoPlayerStats(gameState?.playerStats, { schemaVersion: 1, notes });
        const updated = await nativeJson(`/api/chats/${encodeURIComponent(chatId)}/game-state`, {
          method: "PATCH",
          body: JSON.stringify({
            playerStats,
            manual: true,
            ...(gameState?.messageId ? { messageId: gameState.messageId, swipeIndex: gameState.swipeIndex ?? 0 } : {}),
          }),
        });
        const cached = state.cache.get(chatId) ?? { chatId, enabled: true };
        state.cache.set(chatId, {
          ...cached,
          notes: readGmNotesFromPlayerStats(updated?.playerStats ?? playerStats).notes,
        });
        notify(chatId);
      }).catch((error) => {
        console.warn("[GM Notes] native state update failed", error);
      }).finally(() => {
        if (state.saves.get(chatId) === task) state.saves.delete(chatId);
      });
      state.saves.set(chatId, task);
      return task;
    }

    function notify(chatId) {
      for (const element of state.elements) {
        if (element.chatId === chatId) element.render();
      }
    }

    const disposeTracker = bridgeSession.ui.register({
      id: "tracker",
      slot: "tracker.section",
      view: "tracker-section-body",
      title: "GM Notes",
      icon: "notebook-pen",
      placement: "before:custom",
      agentIds: [PACKAGE_ID],
      rerunAgentId: PACKAGE_ID,
    });
    const disposeHud = bridgeSession.ui.register({ id: "hud", slot: "roleplay.hud", view: "hud" });
    const disposeChat = bridgeSession.chat.active.subscribe(({ chatId }) => {
      if (chatId) void loadState(chatId, true);
    });
    const disposeGeneration = bridgeSession.generation.subscribe((snapshot, event) => {
      if (!snapshot.mainActive && event?.detail?.chatId) void loadState(event.detail.chatId, true);
    }, { emitCurrent: false });

    return () => {
      disposeGeneration();
      disposeChat();
      disposeHud();
      disposeTracker();
    };
  },
);

async function nativeJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Native request failed (${response.status})`);
  return data;
}

function parseRecord(value) {
  if (typeof value !== "string") return value && typeof value === "object" ? value : {};
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function renderTracker(element, data) {
  const editMode = String(element.capabilityProps?.editMode ?? "");
  return renderPanelBody(element, data.notes, {
    tracker: true,
    addMode: editMode === "add",
    lockMode: editMode === "lock",
    removeMode: editMode === "delete",
  });
}

function renderHud(element, data) {
  const note = data.notes[element._cycleIndex];
  const preview = note ? `${shortKind(note.kind)}: ${note.text}` : "";
  const longestWord = preview.split(/\s+/u).reduce((max, word) => Math.max(max, word.length), 0);
  const fontSize = Math.max(3.5, Math.min(6, 60 / Math.max(longestWord, 1)));
  const content = note
    ? `<span class="gm-notes-hud-preview" style="font-size:${fontSize}px">${escapeHtml(preview)}</span>`
    : noteIcon("0.875rem");
  return `<button type="button" class="${TOOLBAR_BUTTON_CLASS}" data-gm-notes-action="toggle"
    title="GM Notes" aria-label="GM Notes" aria-expanded="${element.hasAttribute("data-open")}">${content}</button>`;
}

function renderPanel(element, notes, { popover = false } = {}) {
  return `<header class="gm-notes-popover-header">
    <span class="gm-notes-panel-title">${noteIcon("0.625rem")} GM Notes (${notes.length})</span>
    <span class="gm-notes-panel-actions">
      ${modeButton("add-mode", "Add note", plusIcon(), element._adding)}
      ${modeButton("lock-mode", "Edit note locks", lockIcon(false), element._lockMode)}
      ${modeButton("remove-mode", "Remove notes", trashIcon(), element._removeMode, true)}
    </span>
  </header>
  ${renderPanelBody(element, notes, {
    popover,
    addMode: element._adding,
    lockMode: element._lockMode,
    removeMode: element._removeMode,
  })}`;
}

function renderPanelBody(element, notes, {
  popover = false,
  tracker = false,
  addMode = false,
  lockMode = false,
  removeMode = false,
} = {}) {
  return `<div class="gm-notes-panel-body${popover ? " gm-notes-panel-body--popover" : ""}${tracker ? " gm-notes-panel-body--tracker" : ""}">
    ${addMode ? renderAddForm({ tracker }) : ""}
    ${renderGroups(element, notes, { tracker, lockMode, removeMode })}
  </div>`;
}

function renderGroups(element, notes, { tracker = false, lockMode = false, removeMode = false } = {}) {
  const labels = { reminder: "Reminders", thread: "Threads", debug: "Debug" };
  const groups = GM_NOTE_KINDS.map((kind) => [kind, notes.filter((note) => note.kind === kind)]).filter(([, items]) => items.length);
  if (!groups.length) return `<div class="gm-notes-empty">${noteIcon("0.875rem")}<span>No GM notes recorded yet.</span></div>`;
  return groups.map(([kind, items]) => `<section class="gm-notes-group gm-notes-group--${kind}${tracker ? " gm-notes-group--tracker" : ""}">
    <header><span class="gm-notes-kind-dot" aria-hidden="true"></span><strong>${labels[kind]}</strong><span>${items.length}</span></header>
    <ul>${items.map((note) => renderNoteRow(element, note, { lockMode, removeMode })).join("")}</ul>
  </section>`).join("");
}

function renderNoteRow(element, note, { lockMode = false, removeMode = false } = {}) {
  let content;
  if (element._editingId === note.id && note.locked !== true) {
    content = `<input class="gm-notes-inline-input" data-gm-note-edit-input data-note-id="${escapeHtml(note.id)}" value="${escapeHtml(note.text)}" aria-label="Edit GM note">`;
  } else if (note.locked === true) {
    content = `<span class="gm-notes-note-text gm-notes-note-text--locked" title="Unlock this note to edit it">${escapeHtml(note.text)}</span>`;
  } else {
    content = `<button type="button" class="gm-notes-note-text" data-gm-notes-action="edit" data-note-id="${escapeHtml(note.id)}" title="Edit note">${escapeHtml(note.text)}</button>`;
  }
  let control = note.locked === true ? `<span class="gm-notes-lock-status" title="Locked">${lockIcon(true)}</span>` : "";
  if (lockMode) {
    control = `<button type="button" class="gm-notes-row-action${note.locked ? " is-active" : ""}" data-gm-notes-action="toggle-lock" data-note-id="${escapeHtml(note.id)}" title="${note.locked ? "Unlock" : "Lock"} note">${lockIcon(note.locked)}</button>`;
  } else if (removeMode) {
    control = `<button type="button" class="gm-notes-row-action gm-notes-row-action--danger" data-gm-notes-action="remove" data-note-id="${escapeHtml(note.id)}" title="${note.locked ? "Unlock before removing" : "Remove note"}" ${note.locked ? "disabled" : ""}>${trashIcon()}</button>`;
  }
  return `<li><span class="gm-notes-row-icon" aria-hidden="true">${kindGlyph(note.kind)}</span>${content}${control}</li>`;
}

function renderAddForm({ tracker = false } = {}) {
  return `<form class="gm-notes-add-form" data-gm-note-add-form>
    <select name="kind" aria-label="Note kind">
      <option value="reminder">Reminder</option><option value="thread">Thread</option><option value="debug">Debug</option>
    </select>
    <input name="text" data-gm-note-add-input aria-label="New GM note" placeholder="New note" autocomplete="off" required>
    <button type="submit" title="Add note">${plusIcon()}</button>
    ${tracker ? "" : '<button type="button" data-gm-notes-action="cancel-add" title="Cancel">×</button>'}
  </form>`;
}

function modeButton(action, title, icon, active = false, danger = false) {
  return `<button type="button" class="gm-notes-mode-button${active ? " is-active" : ""}${danger ? " gm-notes-mode-button--danger" : ""}" data-gm-notes-action="${action}" title="${title}" aria-label="${title}" aria-pressed="${active}">${icon}</button>`;
}

function shortKind(kind) {
  return { reminder: "R", thread: "T", debug: "D" }[kind] || "N";
}

function kindGlyph(kind) {
  return { reminder: "!", thread: "↳", debug: "·" }[kind] || "·";
}

function plusIcon() {
  return '<svg aria-hidden="true" width="0.625rem" height="0.625rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
}

function lockIcon(locked) {
  const shackle = locked ? "M7 10V7a5 5 0 0 1 10 0v3" : "M7 10V7a5 5 0 0 1 9.5-2";
  return `<svg aria-hidden="true" width="0.625rem" height="0.625rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="10" rx="2"/><path d="${shackle}"/></svg>`;
}

function trashIcon() {
  return '<svg aria-hidden="true" width="0.625rem" height="0.625rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>';
}

function noteIcon(size) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M15.4 5.6 18.4 8.6"/><path d="m14 10 5.5-5.5a2.1 2.1 0 0 1 3 3L17 13l-4 1z"/></svg>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function ensureStyles() {
  if (document.getElementById("gm-notes-style")) return;
  const style = document.createElement("style");
  style.id = "gm-notes-style";
  style.textContent = `
    marinara-capability-gm-notes[view="tracker-section-body"]{display:block;min-width:0}
    marinara-capability-gm-notes[view="hud"]{display:inline-flex;position:relative}
    marinara-capability-gm-notes[hidden]{display:none!important}
    .gm-notes-hud-preview{display:block;width:100%;padding:0 .125rem;text-align:center;font-weight:600;line-height:1.2;overflow-wrap:anywhere;animation:inventory-cycle .4s ease-out}
    @media(prefers-reduced-motion:reduce){.gm-notes-hud-preview{animation:none}}
    .gm-notes-popover-header{display:flex;align-items:center;justify-content:space-between;gap:.25rem;border-bottom:1px solid var(--marinara-chat-chrome-panel-divider,var(--border));padding:.4rem .35rem}
    .gm-notes-panel-title{display:flex;min-width:0;align-items:center;gap:.25rem;color:var(--marinara-chat-chrome-panel-title,var(--foreground));font-size:.625rem;font-weight:600;line-height:1.25;white-space:nowrap}
    .gm-notes-panel-title svg{flex:none;color:var(--muted-foreground)}
    .gm-notes-panel-actions{display:flex;flex:none;align-items:center;gap:.0625rem}
    .gm-notes-mode-button,.gm-notes-row-action{display:inline-flex;height:1.125rem;width:1.125rem;align-items:center;justify-content:center;border:0;border-radius:.35rem;background:transparent;color:var(--muted-foreground);cursor:pointer;transition:background-color .15s,color .15s}
    .gm-notes-mode-button:hover,.gm-notes-row-action:hover,.gm-notes-mode-button.is-active,.gm-notes-row-action.is-active{background:var(--accent);color:var(--foreground)}
    .gm-notes-mode-button--danger.is-active,.gm-notes-row-action--danger:hover{background:color-mix(in srgb,#ef4444 18%,transparent);color:#f87171}
    .gm-notes-panel-body{display:grid;gap:.5rem;padding:.5rem}
    .gm-notes-panel-body--tracker{gap:.125rem;padding:.125rem .25rem .25rem}
    .gm-notes-panel-body--popover{max-height:22rem;overflow:auto}
    .gm-notes-group{overflow:hidden;border:1px solid var(--marinara-chat-chrome-panel-divider,var(--border));border-radius:.625rem;background:color-mix(in srgb,var(--muted) 8%,transparent)}
    .gm-notes-group--tracker{border-color:color-mix(in srgb,var(--border) 30%,transparent);border-radius:.125rem;background:var(--tracker-panel-card-background,color-mix(in srgb,var(--background) 22%,transparent));box-shadow:inset 0 1px 0 color-mix(in srgb,var(--foreground) 5%,transparent)}
    .gm-notes-group>header{display:flex;align-items:center;gap:.375rem;padding:.4rem .5rem;color:var(--muted-foreground);font-size:.625rem;line-height:1;text-transform:uppercase;letter-spacing:.04em}
    .gm-notes-group>header strong{flex:1;font-weight:600}
    .gm-notes-group>header>span:last-child{font-variant-numeric:tabular-nums;opacity:.7}
    .gm-notes-kind-dot{width:.375rem;height:.375rem;border-radius:999px;background:currentColor}
    .gm-notes-group ul{display:grid;gap:.25rem;list-style:none;margin:0;padding:0 .375rem .375rem}
    .gm-notes-group li{display:flex;min-width:0;align-items:flex-start;gap:.4rem;border-radius:.5rem;background:color-mix(in srgb,var(--muted) 20%,transparent);padding:.35rem .4rem;color:var(--foreground);font-size:.6875rem;line-height:1.4;overflow-wrap:anywhere}
    .gm-notes-row-icon{display:inline-flex;width:.75rem;flex:none;justify-content:center;color:var(--muted-foreground);font-size:.625rem;font-weight:700;line-height:1.5}
    .gm-notes-note-text{display:block;min-width:0;flex:1;border:0;background:transparent;padding:0;color:inherit;font:inherit;line-height:inherit;text-align:left;overflow-wrap:anywhere;cursor:text}
    .gm-notes-note-text--locked{cursor:default}
    .gm-notes-inline-input{min-width:0;flex:1;border:1px solid var(--input);border-radius:.35rem;background:var(--background);padding:.2rem .3rem;color:var(--foreground);font:inherit;line-height:1.35;outline:none}
    .gm-notes-inline-input:focus{border-color:var(--ring);box-shadow:0 0 0 1px var(--ring)}
    .gm-notes-row-action{height:1.25rem;width:1.25rem;flex:none}
    .gm-notes-row-action:disabled{cursor:not-allowed;opacity:.35}
    .gm-notes-lock-status{display:inline-flex;height:1.25rem;width:1.25rem;flex:none;align-items:center;justify-content:center;color:var(--muted-foreground);opacity:.55}
    .gm-notes-add-form{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.25rem;border:1px solid var(--marinara-chat-chrome-panel-divider,var(--border));border-radius:.625rem;background:color-mix(in srgb,var(--muted) 12%,transparent);padding:.375rem}
    .gm-notes-add-form select,.gm-notes-add-form input{min-width:0;border:1px solid var(--input);border-radius:.4rem;background:var(--background);padding:.3rem .4rem;color:var(--foreground);font-size:.625rem;outline:none}
    .gm-notes-add-form select{grid-column:1/-1}.gm-notes-add-form input:focus,.gm-notes-add-form select:focus{border-color:var(--ring)}
    .gm-notes-add-form button{display:inline-flex;height:1.6rem;width:1.6rem;align-items:center;justify-content:center;border:0;border-radius:.4rem;background:transparent;color:var(--muted-foreground);cursor:pointer}.gm-notes-add-form button:hover{background:var(--accent);color:var(--foreground)}
    .gm-notes-group--reminder>header{color:#facc15cc}.gm-notes-group--thread>header{color:#34d399cc}.gm-notes-group--debug>header{color:#fb7185cc}
    .gm-notes-empty{display:flex;flex-direction:column;align-items:center;gap:.375rem;padding:1rem .5rem;color:var(--muted-foreground);font-size:.6875rem;text-align:center;opacity:.7}
    .gm-notes-popover{position:fixed;z-index:9999;width:18rem;min-width:15rem;max-width:calc(100vw - 1rem);max-height:calc(100vh - 1rem);overflow:auto;resize:both;box-sizing:border-box;--accent:var(--marinara-chat-chrome-highlight-bg);--accent-foreground:var(--marinara-chat-chrome-highlight-text);--background:var(--marinara-chat-chrome-panel-bg);--border:var(--marinara-chat-chrome-panel-border);--foreground:var(--marinara-chat-chrome-panel-text);--input:var(--marinara-chat-chrome-input-border);--muted:var(--marinara-chat-chrome-highlight-bg);--muted-foreground:var(--marinara-chat-chrome-panel-muted);--ring:var(--marinara-chat-chrome-focus-ring)}
  `;
  document.head.appendChild(style);
}

void cleanupGmNotesClient;

