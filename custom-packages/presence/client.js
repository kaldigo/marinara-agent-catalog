(async () => {
  "use strict";
  const MARI_BRIDGE_API_VERSION = Object.freeze({ major: 1, minor: 7 });
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



  const PACKAGE_ID = "presence";
  const TAG_NAME = "marinara-capability-presence";

  const cleanupPresenceClient = await activateClientWithMariBridge(
    {
      consumerId: PACKAGE_ID,
      api: { major: 1, minMinor: 0 },
      require: ["chat.active", "client.bridge-first", "commands", "consumer.sessions", "runtime.health", "ui.agent-settings"],
    },
    async (bridgeSession) => {
      class PresenceElement extends HTMLElement {
        connectedCallback() {
          this.addEventListener("marinara-capability-props", this);
          this.addEventListener("click", this);
          void this.render();
        }
        disconnectedCallback() {
          this.removeEventListener("marinara-capability-props", this);
          this.removeEventListener("click", this);
        }
        handleEvent(event) {
          if (event.type === "click") {
            const button = event.target instanceof Element
              ? event.target.closest("[data-presence-character-id]")
              : null;
            if (button) void this.toggle(button.getAttribute("data-presence-character-id"));
            return;
          }
          void this.render();
        }
        get chatId() {
          return typeof this.capabilityProps?.chatId === "string"
            ? this.capabilityProps.chatId
            : bridgeSession.chat.active.getSnapshot().chatId || "";
        }
        async render() {
          if (this.getAttribute("view") !== "settings" || !this.chatId) {
            this.hidden = true;
            this.replaceChildren();
            return;
          }
          this.hidden = false;
          try {
            this.data = await request(`/chat/${encodeURIComponent(this.chatId)}/state`);
            const selected = new Set(uniqueStrings(this.data?.state?.alwaysPresentCharacterIds));
            const roster = Array.isArray(this.data?.roster) ? this.data.roster : [];
            this.innerHTML = `<section class="rounded-lg bg-[var(--background)]/75 p-3 ring-1 ring-[var(--border)]">
              <header class="mb-2"><strong class="text-xs">Always present</strong><p class="mt-1 text-[0.625rem] leading-snug text-[var(--muted-foreground)]">Selected characters retain access to every message that is not globally hidden.</p></header>
              <div class="flex flex-wrap gap-2" role="group" aria-label="Always present characters">
                ${roster.map((character) => renderCharacter(character, selected.has(character.id))).join("") || '<span class="text-[0.625rem] text-[var(--muted-foreground)]">No characters in this chat.</span>'}
              </div>
            </section>`;
          } catch (error) {
            this.innerHTML = `<p class="text-xs text-[var(--destructive)]">Presence settings could not load: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
          }
        }
        async toggle(characterId) {
          if (!characterId || !this.data) return;
          const selected = new Set(uniqueStrings(this.data?.state?.alwaysPresentCharacterIds));
          if (selected.has(characterId)) selected.delete(characterId);
          else selected.add(characterId);
          await request(`/chat/${encodeURIComponent(this.chatId)}/settings`, {
            method: "PATCH",
            body: { alwaysPresentCharacterIds: [...selected] },
          });
          await this.render();
        }
      }

      if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, PresenceElement);

      const disposeSettings = bridgeSession.ui.register({
        id: "settings",
        slot: "agent.settings",
        agentIds: [PACKAGE_ID],
        view: "settings",
      });
      const disposeCommands = [
        bridgeSession.commands.register({
          id: "presence",
          commands: ["/presence"],
          description: "Show or update character presence for this chat",
          usage: "/presence [status or character]",
          handler: ({ raw, context }) => runServerCommand(raw, context),
        }),
        bridgeSession.commands.register({
          id: "hide-from-ai",
          hijacks: ["/hide", "/unhide"],
          owns: createHideCommandOwner(),
          handler: ({ raw, context }) => runServerCommand(raw, context),
        }),
      ];

      async function runServerCommand(raw, context) {
        const chatId = context?.chatId || bridgeSession.chat.active.getSnapshot().chatId;
        if (!chatId) throw new Error("No active chat detected.");
        return request(`/chat/${encodeURIComponent(chatId)}/command`, { method: "POST", body: { text: raw } });
      }

      return () => {
        disposeCommands.splice(0).reverse().forEach((dispose) => dispose());
        disposeSettings();
      };
    },
  );

  function createHideCommandOwner() {
    return ({ tokens }) => {
      const value = String(tokens?.[0] ?? "").trim().toLowerCase();
      return Boolean(value) && !(
        value === "all" ||
        value === "last" ||
        value === "from" ||
        /^\d+(?:\s*-\s*\d+)?$/u.test(value)
      );
    };
  }

  async function request(path, options = {}) {
    const response = await fetch(`/api/${PACKAGE_ID}${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Presence request failed (${response.status})`);
    return data;
  }

  function renderCharacter(character, selected) {
    const name = typeof character?.name === "string" && character.name.trim() ? character.name.trim() : character?.id || "Character";
    const avatar = typeof character?.avatarUrl === "string" && character.avatarUrl
      ? `<img src="${escapeHtml(character.avatarUrl)}" alt="" class="h-full w-full object-cover">`
      : `<span aria-hidden="true">${escapeHtml(name.charAt(0).toUpperCase())}</span>`;
    return `<button type="button" data-presence-character-id="${escapeHtml(character.id)}" aria-pressed="${selected}" title="${escapeHtml(name)}" class="flex w-14 flex-col items-center gap-1 bg-transparent text-[var(--foreground)]">
      <span class="grid h-10 w-10 place-items-center overflow-hidden rounded-full border-2 ${selected ? "border-[var(--primary)]" : "border-transparent opacity-60"} bg-[var(--accent)] text-xs font-semibold">${avatar}</span>
      <span class="w-full truncate text-[0.59375rem]">${escapeHtml(name)}</span>
    </button>`;
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))];
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  void cleanupPresenceClient;

})();
