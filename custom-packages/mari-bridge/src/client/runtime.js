const API_VERSION = Object.freeze({ major: 1, minor: 3 });
const CLIENT_SYMBOL = Symbol.for("marinara.mari-bridge.client.v1");
const NATIVE_SLOT_TAG = "marinara-mari-bridge-slot";
const AGENT_SETTINGS_TAG = "marinara-mari-bridge-agent-settings";
const NATIVE_PATCHES = new Set(["__MARI_BRIDGE_NATIVE_PATCHES__"]);

function setClientDiagnostic(name, value) {
  const root = globalThis.document?.documentElement;
  if (typeof root?.setAttribute === "function") root.setAttribute(name, value);
}

function tokenizeCommand(input) {
  const tokens = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/gu;
  for (const match of String(input ?? "").trim().matchAll(pattern)) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\([\\"'])/gu, "$1"));
  }
  return tokens;
}

function createCommandRegistry() {
  const registrations = new Map();

  function sorted() {
    return [...registrations.values()].sort(
      (left, right) => right.priority - left.priority || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id),
    );
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const commands = [...new Set((input.commands ?? []).map((value) => String(value).trim().toLowerCase()).filter((value) => /^\/[a-z0-9][a-z0-9_-]*$/u.test(value)))];
      const aliases = [...new Set((input.aliases ?? []).map((value) => String(value).trim().toLowerCase()).filter((value) => /^\/[a-z0-9][a-z0-9_-]*$/u.test(value)))];
      const hijacks = [...new Set((input.hijacks ?? []).map((value) => String(value).trim().toLowerCase()).filter((value) => /^\/[a-z0-9][a-z0-9_-]*$/u.test(value)))];
      if (!id || commands.length + hijacks.length === 0 || typeof input.handler !== "function") {
        throw new TypeError("Mari Bridge command registration requires id, commands, and handler");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge command ${key}`);
      const registration = Object.freeze({
        ownerId,
        id,
        commands: Object.freeze(commands),
        aliases: Object.freeze(aliases),
        hijacks: Object.freeze(hijacks),
        modes: Object.freeze([...(input.modes ?? ["roleplay", "conversation"])]),
        description: String(input.description ?? `${ownerId} command`).trim(),
        usage: String(input.usage ?? commands[0] ?? "").trim(),
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        handler: input.handler,
        owns: typeof input.owns === "function" ? input.owns : () => true,
      });
      registrations.set(key, registration);
      return () => registrations.delete(key);
    },
    match(raw, context = {}) {
      const tokens = tokenizeCommand(raw);
      const command = tokens[0]?.toLowerCase();
      if (!command) return null;
      const registration = sorted().find((item) => {
        if (!item.modes.includes(context.mode)) return false;
        const direct = item.commands.includes(command) || item.aliases.includes(command);
        const hijacked = item.hijacks.includes(command);
        return (direct || hijacked) && item.owns({ raw: String(raw), command, tokens: tokens.slice(1), hijacked });
      });
      if (!registration) return null;
      return Object.freeze({
        args: Object.freeze(tokens.slice(1)),
        command: Object.freeze({
          id: `${registration.ownerId}:${registration.id}`,
          execute: async (_args, nativeContext = {}) => {
            const result = await registration.handler({
              raw: String(raw),
              command,
              tokens: Object.freeze(tokens.slice(1)),
              context: Object.freeze({ ...context, ...nativeContext }),
            });
            return result && typeof result === "object" ? result : { feedback: result == null ? undefined : String(result) };
          },
        }),
      });
    },
    list(context = {}) {
      return sorted()
        .filter((item) => item.modes.includes(context.mode))
        .flatMap((item) => item.commands.map((command) => Object.freeze({
          name: command.slice(1),
          aliases: Object.freeze(item.aliases.map((alias) => alias.slice(1))),
          description: item.description,
          usage: item.usage || command,
          local: true,
        })));
    },
    count() {
      return registrations.size;
    },
  });
}

function createDraftGenerationService() {
  const activeByChat = new Map();
  const subscribers = new Set();

  function snapshot(chatId = null) {
    const runs = [...activeByChat.values()]
      .filter((run) => !chatId || run.chatId === chatId)
      .map((run) => Object.freeze({
        chatId: run.chatId,
        ownerId: run.ownerId,
        runId: run.runId,
        status: run.status,
        content: run.content,
        continuation: run.continuation,
        reasoning: run.reasoning,
      }));
    return Object.freeze({ active: Object.freeze(runs), activeCount: runs.length });
  }

  function publish(run) {
    const current = snapshot(run?.chatId ?? null);
    for (const subscriber of [...subscribers]) subscriber(current);
  }

  async function generate(ownerId, input = {}) {
    const chatId = String(input.chatId ?? "").trim();
    if (!chatId) throw new TypeError("Mari Bridge draft generation requires chatId");
    if (activeByChat.has(chatId)) throw new Error("A draft generation is already running for this chat");
    const controller = new AbortController();
    const run = {
      ownerId,
      chatId,
      runId: "",
      status: "starting",
      content: "",
      continuation: "",
      reasoning: "",
      controller,
    };
    activeByChat.set(chatId, run);
    publish(run);
    try {
      const body = { ...(input.body ?? {}), chatId, streaming: true };
      if (body.impersonate === true) Object.assign(body, readNativeImpersonateOptions(), input.body ?? {});
      if (body.impersonate === true && typeof input.promptTemplate === "string") {
        const basePrompt = String(body.impersonatePromptTemplate || await readChatImpersonatePrompt(chatId)).trim();
        body.impersonatePromptTemplate = applyDraftPromptTemplate(input.promptTemplate, basePrompt);
      }
      const response = await fetch("/api/generate/dryRun", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        credentials: "same-origin",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Draft generation failed (${response.status})`);
      }
      if (!response.body?.getReader) throw new Error("Draft generation stream is unavailable");
      run.status = "streaming";
      publish(run);
      await readDraftEventStream(response.body, (event) => {
        if (event.type === "dryrun_started") run.runId = String(event.data?.runId ?? "");
        else if (event.type === "token") {
          const chunk = String(event.data ?? "");
          run.content += chunk;
          run.continuation += chunk;
        } else if (event.type === "thinking") {
          run.reasoning += String(event.data ?? "");
          input.onReasoning?.(run.reasoning, Object.freeze({ type: event.type, runId: run.runId }));
        } else if (event.type === "result") {
          run.content = String(event.data?.content ?? run.content);
          run.continuation = String(event.data?.continuation ?? run.content);
          run.reasoning = String(event.data?.reasoning ?? run.reasoning);
        } else if (event.type === "content_replace") {
          run.content = String(event.data ?? "");
          run.continuation = run.content;
        } else if (event.type === "text_rewrite" && event.data?.editedText != null) {
          run.content = String(event.data.editedText);
          run.continuation = run.content;
        } else if (event.type === "error") {
          throw new Error(String(event.data?.error ?? event.data ?? "Draft generation failed"));
        }
        const output = input.output === "continuation" ? run.continuation : run.content;
        input.onUpdate?.(output, Object.freeze({
          type: event.type,
          runId: run.runId,
          reasoning: run.reasoning,
        }));
        publish(run);
      });
      run.status = "complete";
      const output = input.output === "continuation" ? run.continuation : run.content;
      input.onUpdate?.(output, Object.freeze({ type: "complete", runId: run.runId, reasoning: run.reasoning }));
      return input.returnDetails === true
        ? Object.freeze({
            content: run.content,
            continuation: run.continuation,
            reasoning: run.reasoning,
            runId: run.runId,
          })
        : output;
    } finally {
      if (activeByChat.get(chatId) === run) activeByChat.delete(chatId);
      publish(run);
    }
  }

  return Object.freeze({
    generate,
    abort(ownerId, chatId) {
      const run = activeByChat.get(String(chatId ?? ""));
      if (!run || run.ownerId !== ownerId) return false;
      run.controller.abort(`${ownerId} stopped draft generation`);
      return true;
    },
    abortOwner(ownerId) {
      for (const run of activeByChat.values()) {
        if (run.ownerId === ownerId) run.controller.abort(`${ownerId} client closed`);
      }
    },
    abortChat(chatId) {
      const run = activeByChat.get(String(chatId ?? ""));
      if (!run) return false;
      run.controller.abort("Draft generation stopped from Marinara's native Stop control");
      return true;
    },
    getSnapshot: snapshot,
    subscribe(listener, options = {}) {
      if (typeof listener !== "function") throw new TypeError("Mari Bridge draft listener must be a function");
      subscribers.add(listener);
      if (options.emitCurrent !== false) listener(snapshot());
      return () => subscribers.delete(listener);
    },
  });
}

function readNativeImpersonateOptions() {
  try {
    const raw = globalThis.localStorage?.getItem("marinara-engine-ui");
    const parsed = raw ? JSON.parse(raw) : {};
    const state = parsed?.state && typeof parsed.state === "object" ? parsed.state : parsed;
    const prompt = typeof state?.impersonatePromptTemplate === "string" ? state.impersonatePromptTemplate.trim() : "";
    const presetId = typeof state?.impersonatePresetId === "string" && state.impersonatePresetId.trim()
      ? state.impersonatePresetId.trim()
      : null;
    const connectionId = typeof state?.impersonateConnectionId === "string" && state.impersonateConnectionId.trim()
      ? state.impersonateConnectionId.trim()
      : null;
    return {
      ...(prompt ? { impersonatePromptTemplate: prompt } : {}),
      ...(presetId ? { impersonatePresetId: presetId } : {}),
      ...(connectionId ? { impersonateConnectionId: connectionId } : {}),
      impersonateBlockAgents: state?.impersonateBlockAgents === true,
    };
  } catch {
    return {};
  }
}

async function readChatImpersonatePrompt(chatId) {
  try {
    const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) return "";
    const chat = await response.json();
    const metadata = typeof chat?.metadata === "string" ? JSON.parse(chat.metadata || "{}") : chat?.metadata || {};
    return typeof metadata.impersonatePrompt === "string" ? metadata.impersonatePrompt.trim() : "";
  } catch {
    return "";
  }
}

function applyDraftPromptTemplate(template, basePrompt) {
  const source = String(template ?? "").trim();
  const base = String(basePrompt ?? "").trim();
  return source.includes("{{base_prompt}}")
    ? source.replaceAll("{{base_prompt}}", base).trim()
    : [base, source].filter(Boolean).join("\n\n");
}

async function readDraftEventStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary).replaceAll("\r", "");
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      const event = JSON.parse(data);
      onEvent(event && typeof event === "object" ? event : { type: "unknown", data: event });
    }
    if (done) break;
  }
}

function createUiRegistry(activeChat) {
  const registrations = new Map();
  const subscribers = new Set();
  let revision = 0;

  function publish() {
    revision += 1;
    for (const subscriber of [...subscribers]) subscriber();
  }
  activeChat.subscribe(publish, { emitCurrent: false });

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const slot = String(input.slot ?? "").trim();
      if (!id || !["agent.settings", "composer.above-input", "tracker.section", "roleplay.hud"].includes(slot)) {
        throw new TypeError("Mari Bridge UI registration requires a supported slot and stable id");
      }
      if (slot === "tracker.section" && input.placement != null && input.placement !== "before:custom") {
        throw new TypeError("Mari Bridge tracker sections currently support placement before:custom");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge UI contribution ${key}`);
      registrations.set(key, Object.freeze({
        ownerId,
        id,
        slot,
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        view: String(input.view ?? (slot === "agent.settings" ? "settings" : "surface")),
        agentIds: Object.freeze(
          [...new Set((input.agentIds ?? []).map((value) => String(value).trim()).filter(Boolean))],
        ),
        title: String(input.title ?? "").trim(),
        icon: String(input.icon ?? "extension").trim(),
        placement: String(input.placement ?? "before:custom").trim(),
        rerunAgentId: String(input.rerunAgentId ?? "").trim(),
        props: typeof input.props === "function" ? input.props : null,
      }));
      publish();
      return () => {
        if (registrations.delete(key)) publish();
      };
    },
    list(slot, options = {}) {
      const chat = activeChat.getSnapshot();
      const agentId = String(options.agentId ?? "").trim();
      return [...registrations.values()]
        .filter((item) => item.slot === slot && (!agentId || item.agentIds.includes(agentId)))
        .sort((left, right) => right.priority - left.priority || left.ownerId.localeCompare(right.ownerId))
        .map((item) => Object.freeze({ ...item, capabilityProps: Object.freeze({ chatId: chat.chatId, ...(item.props?.(chat) ?? {}) }) }));
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    getVersion() {
      return revision;
    },
  });
}

function createAgentSuiteTrackerDataRegistry() {
  const registrations = new Map();
  const subscribers = new Set();
  let revision = 0;

  function publish() {
    revision += 1;
    for (const subscriber of [...subscribers]) subscriber();
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const agentId = String(input.agentId ?? "").trim();
      const label = String(input.label ?? "").trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(agentId) || !label) {
        throw new TypeError("Mari Bridge Agent Suite tracker data requires an agentId and label");
      }
      if (typeof input.getValue !== "function" || typeof input.buildPatch !== "function") {
        throw new TypeError("Mari Bridge Agent Suite tracker data requires getValue and buildPatch functions");
      }
      if (registrations.has(agentId)) throw new Error(`Duplicate Mari Bridge Agent Suite tracker data for ${agentId}`);
      const registration = Object.freeze({
        ownerId,
        agentId,
        label,
        description: String(input.description ?? "").trim(),
        getValue: input.getValue,
        buildPatch: input.buildPatch,
        onSaved: typeof input.onSaved === "function" ? input.onSaved : null,
      });
      registrations.set(agentId, registration);
      publish();
      return () => {
        if (registrations.get(agentId) === registration) {
          registrations.delete(agentId);
          publish();
        }
      };
    },
    resolve(agentId) {
      return registrations.get(String(agentId ?? "").trim());
    },
    async notifySaved(agentId, detail = {}) {
      const registration = registrations.get(String(agentId ?? "").trim());
      if (!registration?.onSaved) return;
      try {
        await registration.onSaved(Object.freeze({ ...detail, agentId: registration.agentId }));
      } catch (error) {
        console.warn(`[Mari Bridge] Agent Suite tracker save notification failed for ${registration.agentId}`, error);
      }
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    getVersion() {
      return revision;
    },
  });
}

function defineAgentSettingsElement(ui) {
  if (!globalThis.customElements || customElements.get(AGENT_SETTINGS_TAG)) return;
  customElements.define(AGENT_SETTINGS_TAG, class MariBridgeAgentSettings extends HTMLElement {
    connectedCallback() {
      this.unsubscribe = ui.subscribe(() => this.render());
      this.render();
    }
    disconnectedCallback() {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    static get observedAttributes() { return ["agent-id"]; }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      const agentId = this.getAttribute("agent-id") ?? "";
      const nodes = ui.list("agent.settings", { agentId }).map((item) => {
        const node = document.createElement(`marinara-capability-${item.ownerId}`);
        node.setAttribute("view", item.view);
        node.capabilityProps = Object.freeze({ ...item.capabilityProps, agentId });
        queueMicrotask(() => node.dispatchEvent(new CustomEvent("marinara-capability-props")));
        return node;
      });
      this.replaceChildren(...nodes);
    }
  });
}

function createNativeSlotMounter() {
  const mountedByRoot = new WeakMap();

  return function mountNativeSlot(root, slot, options = {}) {
    if (!(root instanceof HTMLElement)) return;
    const current = mountedByRoot.get(root) ?? new Map();
    mountedByRoot.set(root, current);
    const ensureHost = (key, target) => {
      let host = current.get(key);
      if (!(host instanceof HTMLElement)) {
        host = document.createElement(NATIVE_SLOT_TAG);
        host.setAttribute("name", slot);
        host.dataset.mariBridgeNativeSlot = key;
        current.set(key, host);
      }
      // Let HUD contributions participate as native flex items so the existing
      // alignment and gap-0.5 spacing apply across package and native widgets.
      if (slot === "roleplay.hud") host.style.display = "contents";
      if (host.parentElement !== target) target.appendChild(host);
    };
    if (slot === "roleplay.hud") {
      const targets = [...root.children].filter(
        (child) => child.classList?.contains("md:hidden") || child.classList?.contains("md:flex"),
      );
      targets.forEach((target, index) => ensureHost(`${slot}:${index}`, target));
      return;
    }
    const existingHosts = new Set([...current.values()]);
    const target = options.target === "content"
      ? [...root.children].filter((child) => !existingHosts.has(child)).at(-1) ?? root
      : root;
    ensureHost(slot, target);
  };
}

function defineNativeSlotElement(ui) {
  if (!globalThis.customElements || customElements.get(NATIVE_SLOT_TAG)) return;
  customElements.define(NATIVE_SLOT_TAG, class MariBridgeNativeSlot extends HTMLElement {
    connectedCallback() {
      this.unsubscribe = ui.subscribe(() => this.render());
      this.render();
    }
    disconnectedCallback() {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
    static get observedAttributes() { return ["name"]; }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      const slot = this.getAttribute("name") ?? "";
      const nodes = ui.list(slot).map((item) => {
        const node = document.createElement(`marinara-capability-${item.ownerId}`);
        node.setAttribute("view", item.view);
        node.capabilityProps = item.capabilityProps;
        queueMicrotask(() => node.dispatchEvent(new CustomEvent("marinara-capability-props")));
        return node;
      });
      this.replaceChildren(...nodes);
    }
  });
}

function createNativeTrackerSectionRenderer(ui) {
  const componentCache = new WeakMap();
  const ROOT_CLASS = "relative z-10 overflow-hidden border-b border-[var(--border)] bg-[var(--tracker-panel-section-background,color-mix(in_srgb,var(--card)_10%,transparent))] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]";

  function readCollapsed(key) {
    try {
      return globalThis.localStorage?.getItem(`mari-bridge:tracker-section-collapsed:${key}`) === "true";
    } catch {
      return false;
    }
  }

  function writeCollapsed(key, value) {
    try {
      globalThis.localStorage?.setItem(`mari-bridge:tracker-section-collapsed:${key}`, String(value));
    } catch {
      // Collapsing remains available for the current session when storage is unavailable.
    }
  }

  function trackerIcon(jsx, name) {
    const common = {
      xmlns: "http://www.w3.org/2000/svg",
      width: "0.6875rem",
      height: "0.6875rem",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
    };
    if (name === "notebook-pen") {
      return jsx.jsxs("svg", {
        ...common,
        className: "lucide lucide-notebook-pen",
        children: [
          jsx.jsx("path", { d: "M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" }),
          jsx.jsx("path", { d: "M2 6h4M2 10h4M2 14h4M2 18h4" }),
          jsx.jsx("path", { d: "M15.4 5.6 18.4 8.6" }),
          jsx.jsx("path", { d: "m14 10 5.5-5.5a2.1 2.1 0 0 1 3 3L17 13l-4 1z" }),
        ],
      });
    }
    return jsx.jsxs("svg", {
      ...common,
      className: "lucide lucide-puzzle",
      children: [
        jsx.jsx("path", { d: "M19.439 7.85c-.049.322-.059.648-.028.972.036.67.294 1.458.79 1.954.496.496 1.284.754 1.954.79.324.031.65.021.972-.028V16a2 2 0 0 1-2 2h-3.536c.031-.322.021-.648-.028-.972-.036-.67-.294-1.458-.79-1.954-.496-.496-1.284-.754-1.954-.79a4.35 4.35 0 0 0-.972.028V18H9.312a4.35 4.35 0 0 0 .028-.972c-.036-.67-.294-1.458-.79-1.954-.496-.496-1.284-.754-1.954-.79a4.35 4.35 0 0 0-.972.028V10h3.536a4.35 4.35 0 0 1-.028-.972c.036-.67.294-1.458.79-1.954.496-.496 1.284-.754 1.954-.79.324-.031.65-.021.972.028V2h4.591a2 2 0 0 1 2 2z" }),
      ],
    });
  }

  function refreshIcon(jsx, busy) {
    return jsx.jsxs("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      width: "0.75rem",
      height: "0.75rem",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: `lucide lucide-refresh-cw${busy ? " animate-spin" : ""}`,
      "aria-hidden": "true",
      children: [
        jsx.jsx("path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }),
        jsx.jsx("path", { d: "M21 3v5h-5" }),
        jsx.jsx("path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }),
        jsx.jsx("path", { d: "M8 16H3v5" }),
      ],
    });
  }

  function componentsFor(react, jsx) {
    let cached = componentCache.get(react);
    if (cached) return cached;

    function CapabilityBody({ item, capabilityProps }) {
      const ref = react.useRef(null);
      react.useLayoutEffect(() => {
        const node = ref.current;
        if (!(node instanceof HTMLElement)) return;
        node.capabilityProps = capabilityProps;
        node.dispatchEvent(new CustomEvent("marinara-capability-props"));
      }, [capabilityProps]);
      return jsx.jsx(`marinara-capability-${item.ownerId}`, { ref, view: item.view });
    }

    function TrackerSection({ item, native, context }) {
      const storageKey = `${item.ownerId}:${item.id}`;
      const [collapsed, setCollapsed] = react.useState(() => readCollapsed(storageKey));
      const rerunAgentId = item.rerunAgentId || item.agentIds[0] || "";
      const canRerun = !!rerunAgentId && context.enabledAgentTypes?.has?.(rerunAgentId);
      const rerunTitle = context.retryBusy
        ? "A tracker or reply is already running"
        : `Re-run ${item.title || item.ownerId} tracker`;
      const action = canRerun
        ? jsx.jsx(native.SectionIconButton, {
            onClick: () => { void context.rerunTracker(rerunAgentId); },
            disabled: context.retryBusy,
            title: rerunTitle,
            children: refreshIcon(jsx, context.retryBusy),
          })
        : null;
      const capabilityProps = react.useMemo(() => Object.freeze({
        ...item.capabilityProps,
        chatId: context.activeChatId,
        editMode: context.editMode,
        nativeEnabled: true,
      }), [item.capabilityProps, context.activeChatId, context.editMode]);
      const toggle = () => setCollapsed((current) => {
        const next = !current;
        writeCollapsed(storageKey, next);
        return next;
      });
      return jsx.jsxs("section", {
        className: ROOT_CLASS,
        "data-mari-bridge-tracker-section": storageKey,
        children: [
          native.TrackerReadabilityVeil ? jsx.jsx(native.TrackerReadabilityVeil, { strength: "strong" }) : null,
          jsx.jsxs("div", {
            className: "relative z-10",
            children: [
              jsx.jsx(native.SectionHeader, {
                icon: trackerIcon(jsx, item.icon),
                title: item.title || item.ownerId,
                action,
                collapsed,
                onToggle: toggle,
              }),
              !collapsed && jsx.jsx(CapabilityBody, { item, capabilityProps }),
            ],
          }),
        ],
      }, storageKey);
    }

    function TrackerSections({ native, context }) {
      react.useSyncExternalStore(ui.subscribe, ui.getVersion, ui.getVersion);
      const items = ui.list("tracker.section").filter((item) => (
        item.placement === "before:custom"
        && (item.agentIds.length === 0 || item.agentIds.some((agentId) => context.enabledAgentTypes?.has?.(agentId)))
      ));
      if (items.length === 0 && context.nativeSectionCount === 0 && native.EmptySection) {
        return jsx.jsx(native.EmptySection, { children: context.emptyLabel || "No enabled tracker panels." });
      }
      return items.map((item) => jsx.jsx(TrackerSection, { item, native, context }, `${item.ownerId}:${item.id}`));
    }

    cached = Object.freeze({ TrackerSections });
    componentCache.set(react, cached);
    return cached;
  }

  return function renderNativeTrackerSections(input = {}) {
    const { react, jsx, native, sections, renderSection, context } = input;
    if (!react?.useSyncExternalStore || !jsx?.jsx || typeof renderSection !== "function" || !Array.isArray(sections)) {
      return null;
    }
    if (!native?.SectionHeader || !native?.SectionIconButton) return null;
    const { TrackerSections } = componentsFor(react, jsx);
    const rendered = sections.map((section) => renderSection(section));
    const host = jsx.jsx(TrackerSections, { native, context: context ?? {} }, "mari-bridge:tracker-sections");
    const customIndex = sections.indexOf("custom");
    rendered.splice(customIndex >= 0 ? customIndex : rendered.length, 0, host);
    return rendered;
  };
}

function createGenerationLifecycle() {
  const activeByChat = new Map();
  const subscribers = new Set();

  function snapshot() {
    const active = [...activeByChat.entries()].map(([chatId, phase]) => Object.freeze({
      id: `native:${chatId}`,
      chatId,
      kind: "main",
      phase,
    }));
    return Object.freeze({
      active: Object.freeze(active),
      activeCount: active.length,
      mainActive: active.length > 0,
      agentActive: false,
    });
  }

  function publish(source, detail) {
    const current = snapshot();
    for (const subscriber of [...subscribers]) subscriber(current, Object.freeze({ source, detail }));
  }

  function onPhase(event) {
    const chatId = String(event?.detail?.chatId ?? "").trim();
    const phase = String(event?.detail?.phase ?? "").trim();
    if (!chatId) return;
    if (!phase || phase === "idle") activeByChat.delete(chatId);
    else activeByChat.set(chatId, phase);
    publish("marinara:mari-phase", event?.detail ?? null);
  }

  function onSettled(event) {
    const chatId = String(event?.detail?.chatId ?? "").trim();
    if (chatId) activeByChat.delete(chatId);
    else activeByChat.clear();
    publish(event?.type ?? "generation-settled", event?.detail ?? null);
  }

  function onController(event) {
    const chatId = String(event?.detail?.chatId ?? "").trim();
    if (!chatId) return;
    if (event?.detail?.active) activeByChat.set(chatId, "starting");
    else activeByChat.delete(chatId);
    publish("marinara:generation-controller", event?.detail ?? null);
  }

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("marinara:generation-controller", onController);
    globalThis.addEventListener("marinara:mari-phase", onPhase);
    globalThis.addEventListener("marinara:generation-complete", onSettled);
    globalThis.addEventListener("marinara:generation-error", onSettled);
  }

  return Object.freeze({
    getSnapshot: snapshot,
    subscribe(listener, options = {}) {
      if (typeof listener !== "function") throw new TypeError("Mari Bridge generation listener must be a function");
      subscribers.add(listener);
      if (options.emitCurrent !== false) listener(snapshot(), Object.freeze({ source: "snapshot", detail: null }));
      return () => subscribers.delete(listener);
    },
  });
}

function createActiveChatLifecycle() {
  const subscribers = new Set();
  let chatId = null;
  try {
    chatId = globalThis.localStorage?.getItem("marinara-active-chat-id") || null;
  } catch {
    chatId = null;
  }

  function snapshot() {
    return Object.freeze({ chatId });
  }

  function onActiveChat(event) {
    chatId = String(event?.detail?.chatId ?? "").trim() || null;
    const current = snapshot();
    for (const subscriber of [...subscribers]) subscriber(current);
  }

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("marinara:active-chat", onActiveChat);
  }

  return Object.freeze({
    getSnapshot: snapshot,
    subscribe(listener, options = {}) {
      if (typeof listener !== "function") throw new TypeError("Mari Bridge active-chat listener must be a function");
      subscribers.add(listener);
      if (options.emitCurrent !== false) listener(snapshot());
      return () => subscribers.delete(listener);
    },
  });
}

function createRoleplayBackgroundService(activeChat) {
  let nativeStore = null;
  let live = null;

  function bindStore(store) {
    if (typeof store !== "function" || typeof store.getState !== "function") return false;
    nativeStore = store;
    return true;
  }

  function set(ownerId, input) {
    const chatId = String(input?.chatId ?? "").trim();
    if (!chatId || activeChat.getSnapshot().chatId !== chatId) return false;
    const url = typeof input?.url === "string" && input.url.trim() ? input.url.trim() : null;
    const blurPx = Math.max(0, Math.min(24, Math.round(Number(input?.blurPx) || 0)));
    const state = nativeStore?.getState?.();
    if (typeof state?.setChatBackground !== "function") return false;
    live = Object.freeze({ ownerId, chatId, url, blurPx });
    state.setChatBackground(url);
    return true;
  }

  function release(ownerId) {
    if (live?.ownerId === ownerId) live = null;
  }

  function resolve(metadataValue, url, blurPx) {
    const activeChatId = activeChat.getSnapshot().chatId;
    if (live?.chatId === activeChatId && live.url === url) {
      return Object.freeze({ url, blurPx: live.blurPx });
    }
    let metadata = metadataValue;
    if (typeof metadata === "string") {
      try { metadata = JSON.parse(metadata || "{}"); } catch { metadata = {}; }
    }
    const settings = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata.worldMapBackground
      : null;
    const owned = settings && typeof settings === "object" && settings.currentUrl === url;
    return Object.freeze({
      url,
      blurPx: owned ? Math.max(0, Math.min(24, Math.round(Number(settings.blur) || 0))) : blurPx,
    });
  }

  return Object.freeze({ bindStore, set, release, resolve });
}

function createClientRuntime(serverHealth) {
  const consumers = new Map();
  const generation = createGenerationLifecycle();
  const activeChat = createActiveChatLifecycle();
  const roleplayBackground = createRoleplayBackgroundService(activeChat);
  const commands = createCommandRegistry();
  const drafts = createDraftGenerationService();
  const ui = createUiRegistry(activeChat);
  const agentSuiteTrackerData = createAgentSuiteTrackerDataRegistry();
  const mountNativeSlot = createNativeSlotMounter();
  const renderNativeTrackerSections = createNativeTrackerSectionRenderer(ui);
  const capabilities = new Set([
    "client.bridge-first",
    "consumer.sessions",
    "diagnostics",
    "runtime.health",
  ]);
  if (NATIVE_PATCHES.has("client.active-chat")) capabilities.add("chat.active");
  if (NATIVE_PATCHES.has("client.roleplay-background")) capabilities.add("chat.background");
  if (NATIVE_PATCHES.has("client.agent-suite-tracker-data")) capabilities.add("agent-suite.tracker-data");
  if (NATIVE_PATCHES.has("client.command-drafts")) {
    capabilities.add("commands.draft-write");
    capabilities.add("generation.draft");
    capabilities.add("ui.composer.above-input");
  }
  if (NATIVE_PATCHES.has("client.commands") && NATIVE_PATCHES.has("client.command-drafts")) capabilities.add("commands");
  if (NATIVE_PATCHES.has("client.generation-lifecycle")) capabilities.add("generation.lifecycle");
  if (NATIVE_PATCHES.has("client.quick-replies")) capabilities.add("quick-replies.input-macro");
  if (NATIVE_PATCHES.has("client.native-agent-settings")) capabilities.add("ui.agent-settings");
  if (NATIVE_PATCHES.has("client.tracker-sections")) capabilities.add("ui.tracker-section");
  if (NATIVE_PATCHES.has("client.roleplay-hud")) capabilities.add("ui.roleplay-hud");
  return Object.freeze({
    apiVersion: API_VERSION,
    implementationVersion: "1.0.20",
    status: "ready",
    capabilities,
    serverHealth,
    registerConsumer(input) {
      const consumerId = String(input?.consumerId ?? "").trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(consumerId)) throw new TypeError("Invalid Mari Bridge consumerId");
      if (input?.api?.major !== API_VERSION.major || Number(input?.api?.minMinor ?? 0) > API_VERSION.minor) {
        throw new Error(`Mari Bridge client API is incompatible with ${consumerId}`);
      }
      const required = [...new Set(input?.require ?? [])];
      const missing = required.filter((capability) => !capabilities.has(capability));
      if (missing.length > 0) throw new Error(`Mari Bridge client is missing for ${consumerId}: ${missing.join(", ")}`);
      if (consumers.has(consumerId)) throw new Error(`Mari Bridge client consumer ${consumerId} is already active`);
      const controller = new AbortController();
      const cleanups = [];
      let closed = false;
      const session = Object.freeze({
        consumerId,
        capabilities: Object.freeze(required),
        signal: controller.signal,
        addCleanup(cleanup) {
          if (typeof cleanup !== "function") throw new TypeError("Mari Bridge cleanup must be a function");
          cleanups.push(cleanup);
        },
        generation: Object.freeze({
          getSnapshot: generation.getSnapshot,
          subscribe(listener, options) {
            const unsubscribe = generation.subscribe(listener, options);
            cleanups.push(unsubscribe);
            return unsubscribe;
          },
        }),
        chat: Object.freeze({
          active: Object.freeze({
            getSnapshot: activeChat.getSnapshot,
            subscribe(listener, options) {
              const unsubscribe = activeChat.subscribe(listener, options);
              cleanups.push(unsubscribe);
              return unsubscribe;
            },
          }),
          background: Object.freeze({
            set(input) {
              if (!required.includes("chat.background")) throw new Error(`${consumerId} did not require chat.background`);
              return roleplayBackground.set(consumerId, input);
            },
          }),
        }),
        commands: Object.freeze({
          register(input) {
            if (!required.includes("commands")) throw new Error(`${consumerId} did not require commands`);
            const cleanup = commands.register(consumerId, input);
            setClientDiagnostic("data-mari-bridge-command-count", String(commands.count()));
            const markedCleanup = () => {
              const removed = cleanup();
              setClientDiagnostic("data-mari-bridge-command-count", String(commands.count()));
              return removed;
            };
            cleanups.push(markedCleanup);
            return markedCleanup;
          },
        }),
        drafts: Object.freeze({
          generate(input) {
            if (!required.includes("generation.draft")) throw new Error(`${consumerId} did not require generation.draft`);
            return drafts.generate(consumerId, input);
          },
          abort(chatId) {
            if (!required.includes("generation.draft")) throw new Error(`${consumerId} did not require generation.draft`);
            return drafts.abort(consumerId, chatId);
          },
          getSnapshot(chatId) {
            if (!required.includes("generation.draft")) throw new Error(`${consumerId} did not require generation.draft`);
            return drafts.getSnapshot(chatId);
          },
          subscribe(listener, options) {
            if (!required.includes("generation.draft")) throw new Error(`${consumerId} did not require generation.draft`);
            const unsubscribe = drafts.subscribe(listener, options);
            cleanups.push(unsubscribe);
            return unsubscribe;
          },
        }),
        ui: Object.freeze({
          register(input) {
            const capability = ({
              "agent.settings": "ui.agent-settings",
              "composer.above-input": "ui.composer.above-input",
              "tracker.section": "ui.tracker-section",
              "roleplay.hud": "ui.roleplay-hud",
            })[input?.slot];
            if (!capability) throw new Error(`${consumerId} requested an unsupported Mari Bridge UI slot`);
            if (!required.includes(capability)) throw new Error(`${consumerId} did not require ${capability}`);
            const cleanup = ui.register(consumerId, input);
            cleanups.push(cleanup);
            return cleanup;
          },
        }),
        agentSuite: Object.freeze({
          registerTrackerData(input) {
            if (!required.includes("agent-suite.tracker-data")) {
              throw new Error(`${consumerId} did not require agent-suite.tracker-data`);
            }
            const cleanup = agentSuiteTrackerData.register(consumerId, input);
            cleanups.push(cleanup);
            return cleanup;
          },
        }),
        async close(reason = "Mari Bridge client consumer closed") {
          if (closed) return;
          closed = true;
          consumers.delete(consumerId);
          controller.abort(reason);
          drafts.abortOwner(consumerId);
          roleplayBackground.release(consumerId);
          for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
        },
      });
      consumers.set(consumerId, session);
      return session;
    },
    matchCommand(raw, context) {
      const match = commands.match(raw, context);
      setClientDiagnostic("data-mari-bridge-last-command", tokenizeCommand(raw)[0]?.toLowerCase() || "");
      setClientDiagnostic("data-mari-bridge-last-command-mode", String(context?.mode ?? ""));
      setClientDiagnostic("data-mari-bridge-last-command-owner", match?.command?.id ?? "none");
      return match;
    },
    listCommands(context) {
      return commands.list(context);
    },
    stopDraft(chatId) {
      return drafts.abortChat(chatId);
    },
    resolveQuickReply(template, input) {
      return String(template).replaceAll("{{input}}", String(input ?? ""));
    },
    resolveBackgroundProps(metadataValue, url, blurPx) {
      return roleplayBackground.resolve(metadataValue, url, blurPx);
    },
    bindRoleplayBackgroundStore(store) {
      return roleplayBackground.bindStore(store);
    },
    resolveAgentSuiteTrackerSlice(agentId) {
      return agentSuiteTrackerData.resolve(agentId);
    },
    notifyAgentSuiteTrackerSaved(agentId, detail) {
      return agentSuiteTrackerData.notifySaved(agentId, detail);
    },
    useAgentSuiteTrackerData(react) {
      if (!react?.useSyncExternalStore) return agentSuiteTrackerData.getVersion();
      return react.useSyncExternalStore(
        agentSuiteTrackerData.subscribe,
        agentSuiteTrackerData.getVersion,
        agentSuiteTrackerData.getVersion,
      );
    },
    ui,
    mountNativeSlot,
    renderNativeTrackerSections,
  });
}

if (!globalThis[CLIENT_SYMBOL]) {
  globalThis[CLIENT_SYMBOL] = createClientRuntime(Object.freeze({
    status: "injected",
    engineVersion: "2.4.3",
    implementationVersion: "1.0.20",
  }));
  defineNativeSlotElement(globalThis[CLIENT_SYMBOL].ui);
  defineAgentSettingsElement(globalThis[CLIENT_SYMBOL].ui);
}
document.documentElement.dataset.mariBridgeClient = "ready";
