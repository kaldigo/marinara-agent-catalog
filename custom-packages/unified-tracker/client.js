const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 10 });
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


const UNIFIED_TRACKER_ID = "unified-tracker";
const UNIFIED_TRACKER_RESULT_TYPE = "unified_tracker_update";
const UNIFIED_TRACKER_NAMESPACE = "unified-tracker";

const DEFAULT_SECTIONS = Object.freeze({
  world: true,
  characters: true,
  characterStats: false,
  personaStats: false,
  quests: false,
  gmNotes: false,
});

const QUEST_PRESETS = Object.freeze(["story", "epic-campaign", "real-life-goals", "single-focus", "mystery-board", "custom"]);

const DEFAULT_FRAGMENTS = Object.freeze({
  world: "Preserve the current world unless the completed conversation history supplied for this run changes it. Advance time realistically and retain every configured custom world field.",
  characters: "Track the active persona, every saved chat character, and scene-relevant returning characters. Preserve unchanged scene details and remove an incidental character only after they clearly leave the scene.",
  characterStats: "Update only existing configured character stats, proportionally to events. Never invent a new stat row.",
  personaStats: "Update only existing configured persona stat bars, proportionally to events. Do not return persona status or inventory.",
  quests: "Track only meaningful goals with stakes or narrative weight. Use exact existing quest names for updates and return the complete objective list when replacing objectives.",
  gmNotes: "Keep only durable reminders, unresolved threads, and continuity risks not already owned by another enabled tracker section.",
});

function record(value) {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanFragment(value, fallback) {
  return typeof value === "string" ? value.trim().slice(0, 8_000) : fallback;
}

function normalizeUnifiedSettings(value) {
  const source = record(value);
  const rawSections = record(source.sections);
  const rawFragments = record(source.fragments);
  const sections = Object.fromEntries(Object.entries(DEFAULT_SECTIONS).map(([key, fallback]) => [
    key,
    typeof rawSections[key] === "boolean" ? rawSections[key] : fallback,
  ]));
  if (!sections.characters) sections.characterStats = false;
  return Object.freeze({
    schemaVersion: 1,
    sections: Object.freeze(sections),
    addToMainPrompt: source.addToMainPrompt !== false,
    questPreset: QUEST_PRESETS.includes(source.questPreset) ? source.questPreset : "story",
    fragments: Object.freeze(Object.fromEntries(Object.entries(DEFAULT_FRAGMENTS).map(([key, fallback]) => [
      key,
      cleanFragment(rawFragments[key], fallback),
    ]))),
  });
}

function settingsFromChat(chat) {
  const metadata = record(chat?.metadata);
  return normalizeUnifiedSettings(metadata[UNIFIED_TRACKER_NAMESPACE]);
}

function unifiedIsActive(chat) {
  const metadata = record(chat?.metadata);
  return chat?.mode === "roleplay"
    && metadata.enableAgents !== false
    && Array.isArray(metadata.activeAgentIds)
    && metadata.activeAgentIds.includes(UNIFIED_TRACKER_ID);
}



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
