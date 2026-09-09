import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";
import { DEFAULT_FRAGMENTS, QUEST_PRESETS, normalizeUnifiedSettings } from "../shared/settings.js";

const TAG = "marinara-capability-unified-tracker";
const NAMESPACE = "unified-tracker";
const SECTION_ROWS = Object.freeze([
  ["world", "World", "Native World State panel and HUD"],
  ["characters", "Characters + persona details", "One identity list with native character/profile storage"],
  ["characterStats", "Character stats", "Existing configured character stat rows only"],
  ["personaStats", "Persona stats", "Existing configured persona bars only"],
  ["quests", "Quests", "Native action-based Quest Tracker"],
  ["gmNotes", "GM Notes", "Shared GM Notes ledger and panels"],
]);

const cleanup = await activateClientWithMariBridge(
  {
    consumerId: "unified-tracker",
    api: { major: 1, minMinor: 10 },
    require: ["chat.active", "client.bridge-first", "consumer.sessions", "runtime.health", "tracker.surfaces", "ui.agent-settings"],
  },
  async (bridgeSession) => {
    const state = { byChat: new Map(), chats: new Map(), elements: new Set() };

    async function refresh(chatId) {
      if (!chatId) return;
      const chat = await api(`/chats/${encodeURIComponent(chatId)}`).catch(() => null);
      if (!chat) return;
      state.chats.set(chatId, chat);
      state.byChat.set(chatId, normalizeUnifiedSettings(asRecord(chat.metadata)[NAMESPACE]));
      bridgeSession.tracker.refreshSurfaces();
      for (const element of state.elements) if (element.chatId === chatId) void element.render();
    }

    function active(chatId) {
      const chat = state.chats.get(chatId);
      const metadata = asRecord(chat?.metadata);
      return chat?.mode === "roleplay" && metadata.enableAgents !== false
        && Array.isArray(metadata.activeAgentIds) && metadata.activeAgentIds.includes(NAMESPACE);
    }

    function settings(chatId) {
      return state.byChat.get(chatId) ?? normalizeUnifiedSettings(null);
    }

    class UnifiedTrackerSettings extends HTMLElement {
      connectedCallback() {
        state.elements.add(this);
        this.addEventListener("marinara-capability-props", this);
        this.addEventListener("change", this);
        this.addEventListener("input", this);
        void refresh(this.chatId).then(() => this.render());
      }
      disconnectedCallback() {
        state.elements.delete(this);
        this.removeEventListener("marinara-capability-props", this);
        this.removeEventListener("change", this);
        this.removeEventListener("input", this);
      }
      get chatId() {
        return String(this.capabilityProps?.chatId ?? bridgeSession.chat.active.getSnapshot().chatId ?? "");
      }
      handleEvent(event) {
        if (event.type === "marinara-capability-props") return void refresh(this.chatId).then(() => this.render());
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
        if (event.type === "input" && target instanceof HTMLTextAreaElement) return;
        void this.save(target);
      }
      async save(target) {
        const chatId = this.chatId;
        if (!chatId) return;
        const current = settings(chatId);
        let next = current;
        if (target.dataset.section) {
          const sections = { ...current.sections, [target.dataset.section]: target.checked };
          if (target.dataset.section === "characters" && !target.checked) sections.characterStats = false;
          next = normalizeUnifiedSettings({ ...current, sections });
        } else if (target.dataset.fragment) {
          next = normalizeUnifiedSettings({ ...current, fragments: { ...current.fragments, [target.dataset.fragment]: target.value } });
        } else if (target.dataset.questPreset) {
          next = normalizeUnifiedSettings({ ...current, questPreset: target.value });
        } else if (target.dataset.mainPrompt) {
          next = normalizeUnifiedSettings({ ...current, addToMainPrompt: target.checked });
        }
        state.byChat.set(chatId, next);
        bridgeSession.tracker.refreshSurfaces();
        await patchMetadata(chatId, { [NAMESPACE]: next });
        await refresh(chatId);
      }
      render() {
        if (this.getAttribute("view") !== "settings" || !this.chatId) {
          this.hidden = true;
          this.replaceChildren();
          return;
        }
        this.hidden = false;
        const current = settings(this.chatId);
        const chat = state.chats.get(this.chatId);
        const metadata = asRecord(chat?.metadata);
        const activeIds = Array.isArray(metadata.activeAgentIds) ? metadata.activeAgentIds : [];
        const overlap = [
          current.sections.world && activeIds.includes("world-state") ? "World State" : "",
          current.sections.characters && activeIds.includes("character-tracker") ? "Character Tracker" : "",
          current.sections.personaStats && activeIds.includes("persona-stats") ? "Persona Stats" : "",
          current.sections.quests && activeIds.includes("quest") ? "Quest Tracker" : "",
          current.sections.gmNotes && activeIds.includes("gm-notes") ? "GM Notes" : "",
        ].filter(Boolean);
        this.innerHTML = `<div class="flex flex-col gap-3 rounded-lg bg-[var(--background)]/75 p-3 ring-1 ring-[var(--border)]">
          <div><strong class="text-sm">Combined sections</strong><p class="mt-1 text-xs text-[var(--muted-foreground)]">Only enabled sections enter the prompt, result contract, state update, and tracker surfaces.</p></div>
          ${overlap.length ? `<div class="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs">Also enabled separately: ${escapeHtml(overlap.join(", "))}. Both agents will run; Unified Tracker does not disable them.</div>` : ""}
          <div class="grid gap-2">${SECTION_ROWS.map(([key, label, help]) => `<label class="flex items-start gap-2 rounded-md border border-[var(--border)] px-2.5 py-2"><input class="mt-0.5" data-section="${key}" type="checkbox" ${current.sections[key] ? "checked" : ""} ${key === "characterStats" && !current.sections.characters ? "disabled" : ""}><span><span class="block text-xs font-semibold">${label}</span><span class="block text-[0.675rem] text-[var(--muted-foreground)]">${help}</span></span></label>`).join("")}</div>
          <label class="flex items-center gap-2 text-xs"><input data-main-prompt type="checkbox" ${current.addToMainPrompt ? "checked" : ""}>Add source-depth Unified checkpoints to the main prompt</label>
          ${current.sections.quests ? `<label class="grid gap-1 text-xs"><span>Quest behavior</span><select data-quest-preset class="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">${QUEST_PRESETS.map((id) => `<option value="${id}" ${current.questPreset === id ? "selected" : ""}>${escapeHtml(id.replaceAll("-", " "))}</option>`).join("")}</select></label>` : ""}
          <details><summary class="cursor-pointer text-xs font-semibold">Per-chat prompt sections</summary><div class="mt-2 grid gap-2">${Object.entries(current.fragments).filter(([key]) => current.sections[key] || (key === "characterStats" && current.sections.characterStats) || (key === "personaStats" && current.sections.personaStats)).map(([key, value]) => `<label class="grid gap-1 text-xs"><span>${escapeHtml(key)}</span><textarea data-fragment="${key}" rows="3" class="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5">${escapeHtml(value)}</textarea></label>`).join("")}</div></details>
          <p class="text-[0.675rem] text-[var(--muted-foreground)]">Cadence, model, connection, context size, manual reruns, and Stop behavior remain in the normal agent controls.</p>
        </div>`;
      }
    }

    if (!customElements.get(TAG)) customElements.define(TAG, UnifiedTrackerSettings);
    const disposeSettings = bridgeSession.ui.register({ id: "settings", slot: "agent.settings", agentIds: [NAMESPACE], view: "settings" });
    const disposeSurfaces = bridgeSession.tracker.registerSurfaceOverrides({
      id: "enabled-sections",
      resolve({ chatId, agentType, content, surface }) {
        if (!active(chatId)) return null;
        const enabled = settings(chatId).sections;
        const metadata = asRecord(state.chats.get(chatId)?.metadata);
        const activeIds = new Set(Array.isArray(metadata.activeAgentIds) ? metadata.activeAgentIds : []);
        if (content === "character-stats") {
          return activeIds.has("character-tracker") ? null : { visible: enabled.characters && enabled.characterStats };
        }
        if (content === "persona-stats") {
          return activeIds.has("persona-stats") ? null : { visible: enabled.personaStats };
        }
        if (content === "persona-status" || content === "persona-inventory") {
          return activeIds.has("persona-stats") ? null : { visible: false };
        }
        if (agentType && activeIds.has(agentType)) return null;
        const visible = {
          "world-state": enabled.world,
          "character-tracker": enabled.characters,
          "persona-stats": surface === "hud" ? enabled.personaStats : enabled.characters || enabled.personaStats,
          "quest": enabled.quests,
          "gm-notes": enabled.gmNotes,
        }[agentType];
        if (!visible) return null;
        const section = { "world-state": "world", "character-tracker": "characters", "persona-stats": "personaStats", quest: "quests", "gm-notes": "gmNotes" }[agentType];
        return { visible: true, rerunAgentId: NAMESPACE, rerunSection: section };
      },
    });
    const disposeChat = bridgeSession.chat.active.subscribe(({ chatId }) => { if (chatId) void refresh(chatId); });
    const onCapabilityEvent = (event) => {
      const chatId = event?.detail?.chatId;
      if (chatId) void refresh(chatId);
    };
    window.addEventListener("marinara-capability-server-event", onCapabilityEvent);
    return () => {
      window.removeEventListener("marinara-capability-server-event", onCapabilityEvent);
      disposeChat();
      disposeSurfaces();
      disposeSettings();
    };
  },
);

function asRecord(value) {
  if (typeof value === "string") {
    try { return asRecord(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function patchMetadata(chatId, patch) {
  return api(`/chats/${encodeURIComponent(chatId)}/metadata`, { method: "PATCH", headers: { "x-marinara-csrf": "1" }, body: JSON.stringify(patch) });
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Unified Tracker request failed (${response.status})`);
  return data;
}

void cleanup;
