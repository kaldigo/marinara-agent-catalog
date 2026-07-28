(() => {
  "use strict";

  const PACKAGE_ID = "tracker-json-editor";
  const TRACKER_JSON_EDITOR_VERSION = "__PACKAGE_VERSION__";
  const BUTTON_ATTR = "data-tracker-json-editor-button";
  const RERUN_MARK_ATTR = "data-tracker-json-editor-rerun";
  const STYLE_ID = "tracker-json-editor-styles";
  const MODAL_ID = "tracker-json-editor-modal";
  const ACTIVE_CHAT_STORAGE_KEY = "marinara-active-chat-id";

  const SECTION_LABELS = {
    world: "World State",
    persona: "Persona",
    characters: "Present Characters",
    quests: "Quests",
    custom: "Custom Tracker",
  };

  const SECTION_MATCHERS = [
    { id: "persona", tests: ["persona"] },
    { id: "characters", tests: ["character"] },
    { id: "quests", tests: ["quest"] },
    { id: "custom", tests: ["custom"] },
    { id: "world", tests: ["world"] },
  ];

  const state = {
    observer: null,
    scheduled: 0,
    modal: null,
    textarea: null,
    title: null,
    status: null,
    saveButton: null,
    currentSection: null,
    currentChatId: null,
  };

  start();

  function start() {
    if (window.__trackerJsonEditorStarted) return;
    window.__trackerJsonEditorStarted = true;
    ensureStyles();
    scheduleInject();
    state.observer = new MutationObserver(scheduleInject);
    state.observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", scheduleInject);
    window.addEventListener("popstate", scheduleInject);
    window.addEventListener("hashchange", scheduleInject);
    window.dispatchEvent(new CustomEvent("marinara:tracker-json-editor-ready", { detail: { version: TRACKER_JSON_EDITOR_VERSION } }));
  }

  function scheduleInject() {
    if (state.scheduled) return;
    state.scheduled = window.setTimeout(() => {
      state.scheduled = 0;
      injectButtons();
    }, 80);
  }

  function injectButtons() {
    const refreshButtons = Array.from(document.querySelectorAll("button[title], button[aria-label]"));
    for (const refreshButton of refreshButtons) {
      const section = resolveSectionForRefreshButton(refreshButton);
      if (!section) continue;
      if (refreshButton.getAttribute(RERUN_MARK_ATTR) === section) continue;
      refreshButton.setAttribute(RERUN_MARK_ATTR, section);

      const existing = findInjectedSibling(refreshButton);
      if (existing) {
        existing.dataset.section = section;
        existing.title = `Edit ${SECTION_LABELS[section]} JSON`;
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "tracker-json-editor-button";
      button.textContent = "{}";
      button.title = `Edit ${SECTION_LABELS[section]} JSON`;
      button.setAttribute("aria-label", `Edit ${SECTION_LABELS[section]} JSON`);
      button.setAttribute(BUTTON_ATTR, "true");
      button.dataset.section = section;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void openEditor(section);
      });

      refreshButton.insertAdjacentElement("afterend", button);
    }
  }

  function findInjectedSibling(refreshButton) {
    const next = refreshButton.nextElementSibling;
    if (next?.getAttribute?.(BUTTON_ATTR) === "true") return next;
    return null;
  }

  function resolveSectionForRefreshButton(button) {
    const label = [
      button.getAttribute("title"),
      button.getAttribute("aria-label"),
      button.textContent,
      button.closest("[class]")?.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!label.includes("re-run") && !label.includes("rerun")) return null;

    for (const matcher of SECTION_MATCHERS) {
      if (matcher.tests.some((test) => label.includes(test))) return matcher.id;
    }
    return null;
  }

  async function openEditor(section) {
    const chatId = getActiveChatId();
    if (!chatId) {
      showToast("Open a chat before editing tracker JSON.");
      return;
    }

    ensureModal();
    state.currentSection = section;
    state.currentChatId = chatId;
    state.title.textContent = `${SECTION_LABELS[section]} JSON`;
    state.textarea.value = "";
    setStatus("Loading current tracker state...", "muted");
    state.saveButton.disabled = true;
    state.modal.hidden = false;
    state.textarea.focus();

    try {
      const gameState = await fetchGameState(chatId);
      const patch = buildSectionPatch(section, gameState);
      state.textarea.value = `${JSON.stringify(patch, null, 2)}\n`;
      setStatus("Edit the JSON patch below, then save it back to this tracker section.", "muted");
      state.saveButton.disabled = false;
    } catch (error) {
      setStatus(errorMessage(error), "error");
    }
  }

  function ensureModal() {
    if (state.modal) return;

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "tracker-json-editor-modal";
    modal.hidden = true;
    modal.innerHTML = [
      '<div class="tracker-json-editor-backdrop" data-close="true"></div>',
      '<section class="tracker-json-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="tracker-json-editor-title">',
      '  <header class="tracker-json-editor-header">',
      '    <h2 id="tracker-json-editor-title"></h2>',
      '    <button type="button" class="tracker-json-editor-icon-button" data-close="true" aria-label="Close">×</button>',
      '  </header>',
      '  <textarea class="tracker-json-editor-textarea" spellcheck="false"></textarea>',
      '  <p class="tracker-json-editor-status"></p>',
      '  <footer class="tracker-json-editor-footer">',
      '    <button type="button" class="tracker-json-editor-secondary" data-copy="true">Copy</button>',
      '    <span class="tracker-json-editor-spacer"></span>',
      '    <button type="button" class="tracker-json-editor-secondary" data-close="true">Cancel</button>',
      '    <button type="button" class="tracker-json-editor-primary" data-save="true">Save</button>',
      '  </footer>',
      '</section>',
    ].join("");

    document.body.appendChild(modal);
    state.modal = modal;
    state.textarea = modal.querySelector(".tracker-json-editor-textarea");
    state.title = modal.querySelector("#tracker-json-editor-title");
    state.status = modal.querySelector(".tracker-json-editor-status");
    state.saveButton = modal.querySelector("[data-save]");

    modal.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.close === "true") closeModal();
      if (target.dataset.copy === "true") void copyJson();
      if (target.dataset.save === "true") void saveJson();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  function closeModal() {
    if (!state.modal) return;
    state.modal.hidden = true;
    state.currentSection = null;
    state.currentChatId = null;
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(state.textarea.value);
      setStatus("Copied JSON to clipboard.", "ok");
    } catch {
      state.textarea.select();
      document.execCommand("copy");
      setStatus("Copied JSON to clipboard.", "ok");
    }
  }

  async function saveJson() {
    const chatId = state.currentChatId;
    const section = state.currentSection;
    if (!chatId || !section) return;

    let parsed;
    try {
      parsed = JSON.parse(state.textarea.value);
    } catch (error) {
      setStatus(`Invalid JSON: ${errorMessage(error)}`, "error");
      return;
    }

    let patch;
    try {
      patch = normalizeSectionPatch(section, parsed);
    } catch (error) {
      setStatus(errorMessage(error), "error");
      return;
    }

    state.saveButton.disabled = true;
    setStatus("Saving tracker JSON...", "muted");
    try {
      const savePatch = await mergeSectionPatchForSave(chatId, section, patch);
      await patchGameState(chatId, savePatch);
      setStatus("Saved. Refreshing visible tracker state...", "ok");
      window.dispatchEvent(
        new CustomEvent("marinara:tracker-json-editor-saved", { detail: { chatId, section, patch: savePatch } }),
      );
      window.setTimeout(() => {
        closeModal();
        window.location.reload();
      }, 350);
    } catch (error) {
      state.saveButton.disabled = false;
      setStatus(errorMessage(error), "error");
    }
  }

  function buildSectionPatch(section, gameState) {
    const playerStats = normalizePlayerStats(gameState?.playerStats);
    switch (section) {
      case "world":
        return {
          date: gameState?.date ?? null,
          time: gameState?.time ?? null,
          location: gameState?.location ?? null,
          weather: gameState?.weather ?? null,
          temperature: gameState?.temperature ?? null,
          worldCustomFields: Array.isArray(gameState?.worldCustomFields) ? gameState.worldCustomFields : [],
        };
      case "persona":
        return {
          personaStats: Array.isArray(gameState?.personaStats) ? gameState.personaStats : [],
          playerStats: {
            status: playerStats.status,
            inventory: playerStats.inventory,
          },
        };
      case "characters":
        return {
          presentCharacters: Array.isArray(gameState?.presentCharacters) ? gameState.presentCharacters : [],
        };
      case "quests":
        return {
          playerStats: {
            activeQuests: playerStats.activeQuests,
          },
        };
      case "custom":
        return {
          playerStats: {
            customTrackerFields: playerStats.customTrackerFields,
          },
        };
      default:
        throw new Error(`Unsupported tracker section: ${section}`);
    }
  }

  function normalizeSectionPatch(section, parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON must be an object patch.");
    }

    const patch = {};
    if (section === "world") {
      for (const key of ["date", "time", "location", "weather", "temperature"]) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) patch[key] = parsed[key];
      }
      if (Object.prototype.hasOwnProperty.call(parsed, "worldCustomFields")) {
        assertArray(parsed.worldCustomFields, "worldCustomFields");
        patch.worldCustomFields = parsed.worldCustomFields;
      }
      return patch;
    }

    if (section === "characters") {
      assertArray(parsed.presentCharacters, "presentCharacters");
      return { presentCharacters: parsed.presentCharacters };
    }

    if (section === "persona") {
      if (Object.prototype.hasOwnProperty.call(parsed, "personaStats")) {
        assertArray(parsed.personaStats, "personaStats");
        patch.personaStats = parsed.personaStats;
      }
      if (Object.prototype.hasOwnProperty.call(parsed, "playerStats")) {
        const playerStatsPatch = normalizePlayerStatsPatch(parsed.playerStats, ["status", "inventory"]);
        if (Object.prototype.hasOwnProperty.call(playerStatsPatch, "status") && typeof playerStatsPatch.status !== "string") {
          throw new Error("playerStats.status must be a string.");
        }
        if (Object.prototype.hasOwnProperty.call(playerStatsPatch, "inventory")) {
          assertArray(playerStatsPatch.inventory, "playerStats.inventory");
        }
        patch.playerStats = playerStatsPatch;
      }
      if (!Object.keys(patch).length) throw new Error("Persona patch must include personaStats or playerStats.");
      return patch;
    }

    if (section === "quests") {
      if (!parsed.playerStats || typeof parsed.playerStats !== "object" || Array.isArray(parsed.playerStats)) {
        throw new Error("Quest patch must include playerStats.");
      }
      assertArray(parsed.playerStats.activeQuests, "playerStats.activeQuests");
      return { playerStats: { activeQuests: parsed.playerStats.activeQuests } };
    }

    if (section === "custom") {
      if (!parsed.playerStats || typeof parsed.playerStats !== "object" || Array.isArray(parsed.playerStats)) {
        throw new Error("Custom tracker patch must include playerStats.");
      }
      assertArray(parsed.playerStats.customTrackerFields, "playerStats.customTrackerFields");
      return { playerStats: { customTrackerFields: parsed.playerStats.customTrackerFields } };
    }

    throw new Error(`Unsupported tracker section: ${section}`);
  }

  async function mergeSectionPatchForSave(chatId, section, patch) {
    if (!patch.playerStats) return patch;

    const latest = await fetchGameState(chatId);
    const latestPlayerStats = normalizePlayerStats(latest?.playerStats);
    const playerStats = {
      ...latestPlayerStats,
      ...patch.playerStats,
    };
    const savePatch = { ...patch, playerStats };

    if (section === "persona") {
      if (!Object.prototype.hasOwnProperty.call(patch.playerStats, "status")) {
        savePatch.playerStats.status = latestPlayerStats.status;
      }
      if (!Object.prototype.hasOwnProperty.call(patch.playerStats, "inventory")) {
        savePatch.playerStats.inventory = latestPlayerStats.inventory;
      }
    }

    return savePatch;
  }

  function normalizePlayerStatsPatch(value, allowedKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const source = value;
    const patch = {};
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) patch[key] = source[key];
    }
    return patch;
  }

  function normalizePlayerStats(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      stats: Array.isArray(source.stats) ? source.stats : [],
      attributes: source.attributes ?? null,
      skills: source.skills && typeof source.skills === "object" && !Array.isArray(source.skills) ? source.skills : {},
      inventory: Array.isArray(source.inventory) ? source.inventory : [],
      activeQuests: Array.isArray(source.activeQuests) ? source.activeQuests : [],
      status: typeof source.status === "string" ? source.status : "",
      customTrackerFields: Array.isArray(source.customTrackerFields) ? source.customTrackerFields : [],
    };
  }

  function assertArray(value, label) {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  }

  async function fetchGameState(chatId) {
    const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/game-state`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(await readError(response, "Failed to load tracker state."));
    return response.json();
  }

  async function patchGameState(chatId, patch) {
    const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/game-state`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, manual: true }),
    });
    if (!response.ok) throw new Error(await readError(response, "Failed to save tracker state."));
    return response.json();
  }

  async function readError(response, fallback) {
    try {
      const body = await response.json();
      return body?.error || body?.message || fallback;
    } catch {
      return fallback;
    }
  }

  function getActiveChatId() {
    const fromBridge = window.__marinara?.chatStore?.getState?.();
    const candidates = [
      fromBridge?.activeChatId,
      fromBridge?.currentChatId,
      window.__marinara?.uiStore?.getState?.()?.activeChatId,
      localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY),
      parseChatIdFromLocation(),
    ];
    return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";
  }

  function parseChatIdFromLocation() {
    const match = window.location.pathname.match(/\/chats\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function setStatus(message, tone) {
    if (!state.status) return;
    state.status.textContent = message;
    state.status.dataset.tone = tone || "muted";
  }

  function showToast(message) {
    ensureModal();
    state.title.textContent = "Tracker JSON";
    state.textarea.value = "";
    setStatus(message, "error");
    state.saveButton.disabled = true;
    state.modal.hidden = false;
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || "Unknown error");
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .tracker-json-editor-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.35rem;
        height: 1.25rem;
        border: 1px solid color-mix(in srgb, var(--border, #666) 70%, transparent);
        border-radius: 0.25rem;
        padding: 0 0.2rem;
        background: color-mix(in srgb, var(--background, #111) 88%, var(--foreground, #fff) 12%);
        color: color-mix(in srgb, var(--foreground, #fff) 78%, var(--muted-foreground, #aaa) 22%);
        font: 600 0.56rem/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        cursor: pointer;
        opacity: 0.72;
        transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
      }
      .tracker-json-editor-button:hover {
        opacity: 1;
        background: var(--accent, rgba(255,255,255,0.12));
        color: var(--foreground, #fff);
      }
      .tracker-json-editor-modal[hidden] {
        display: none;
      }
      .tracker-json-editor-modal {
        position: fixed;
        inset: 0;
        z-index: 2147483640;
      }
      .tracker-json-editor-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.58);
      }
      .tracker-json-editor-dialog {
        position: absolute;
        left: 50%;
        top: 50%;
        display: flex;
        width: min(52rem, calc(100vw - 1.5rem));
        max-height: min(42rem, calc(100vh - 1.5rem));
        transform: translate(-50%, -50%);
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--border, rgba(255,255,255,0.16));
        border-radius: 0.75rem;
        background: var(--background, #101014);
        color: var(--foreground, #f5f5f5);
        box-shadow: 0 1.25rem 4rem rgba(0, 0, 0, 0.48);
      }
      .tracker-json-editor-header,
      .tracker-json-editor-footer {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        border-color: var(--border, rgba(255,255,255,0.14));
      }
      .tracker-json-editor-header {
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.14));
      }
      .tracker-json-editor-footer {
        border-top: 1px solid var(--border, rgba(255,255,255,0.14));
      }
      .tracker-json-editor-header h2 {
        min-width: 0;
        flex: 1;
        margin: 0;
        font: 700 0.9rem/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tracker-json-editor-icon-button,
      .tracker-json-editor-primary,
      .tracker-json-editor-secondary {
        border: 1px solid var(--border, rgba(255,255,255,0.18));
        border-radius: 0.4rem;
        cursor: pointer;
      }
      .tracker-json-editor-icon-button {
        width: 1.75rem;
        height: 1.75rem;
        background: transparent;
        color: var(--muted-foreground, #aaa);
        font-size: 1.1rem;
      }
      .tracker-json-editor-textarea {
        min-height: 24rem;
        flex: 1;
        resize: vertical;
        border: 0;
        outline: 0;
        padding: 0.85rem;
        background: color-mix(in srgb, var(--background, #101014) 86%, black 14%);
        color: var(--foreground, #f5f5f5);
        font: 0.78rem/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        tab-size: 2;
      }
      .tracker-json-editor-status {
        min-height: 1.25rem;
        margin: 0;
        padding: 0.4rem 0.75rem;
        border-top: 1px solid var(--border, rgba(255,255,255,0.14));
        color: var(--muted-foreground, #aaa);
        font: 0.75rem/1.25 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tracker-json-editor-status[data-tone="error"] {
        color: var(--destructive, #ff6b6b);
      }
      .tracker-json-editor-status[data-tone="ok"] {
        color: #63d471;
      }
      .tracker-json-editor-spacer {
        flex: 1;
      }
      .tracker-json-editor-primary,
      .tracker-json-editor-secondary {
        min-height: 2rem;
        padding: 0 0.8rem;
        font: 650 0.78rem/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tracker-json-editor-primary {
        background: var(--primary, #f5f5f5);
        color: var(--primary-foreground, #111);
      }
      .tracker-json-editor-primary:disabled {
        cursor: wait;
        opacity: 0.56;
      }
      .tracker-json-editor-secondary,
      .tracker-json-editor-icon-button {
        background: color-mix(in srgb, var(--background, #101014) 86%, var(--foreground, #fff) 14%);
        color: var(--foreground, #f5f5f5);
      }
    `;
    document.head.appendChild(style);
  }

  console.debug(`[${PACKAGE_ID}] loaded`, TRACKER_JSON_EDITOR_VERSION);
})();
