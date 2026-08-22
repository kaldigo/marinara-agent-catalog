const API_VERSION = Object.freeze({ major: 1, minor: 1 });
const CLIENT_SYMBOL = Symbol.for("marinara.mari-bridge.client.v1");
const NATIVE_SLOT_TAG = "marinara-mari-bridge-slot";

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
    const run = { ownerId, chatId, runId: "", status: "starting", content: "", controller };
    activeByChat.set(chatId, run);
    publish(run);
    try {
      const response = await fetch("/api/generate/dryRun", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        credentials: "same-origin",
        body: JSON.stringify({ ...(input.body ?? {}), chatId, streaming: true }),
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
        else if (event.type === "token") run.content += String(event.data ?? "");
        else if (event.type === "result") run.content = String(event.data?.content ?? run.content);
        else if (event.type === "content_replace") run.content = String(event.data ?? "");
        else if (event.type === "text_rewrite" && event.data?.editedText != null) {
          run.content = String(event.data.editedText);
        } else if (event.type === "error") {
          throw new Error(String(event.data?.error ?? event.data ?? "Draft generation failed"));
        }
        input.onUpdate?.(run.content, Object.freeze({ type: event.type, runId: run.runId }));
        publish(run);
      });
      run.status = "complete";
      input.onUpdate?.(run.content, Object.freeze({ type: "complete", runId: run.runId }));
      return run.content;
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

  function publish() {
    for (const subscriber of [...subscribers]) subscriber();
  }
  activeChat.subscribe(publish, { emitCurrent: false });

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const slot = String(input.slot ?? "").trim();
      if (!id || !["chat.settings", "composer.above-input", "tracker.panel", "roleplay.hud"].includes(slot)) {
        throw new TypeError("Mari Bridge UI registration requires a supported slot and stable id");
      }
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge UI contribution ${key}`);
      registrations.set(key, Object.freeze({
        ownerId,
        id,
        slot,
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        view: String(input.view ?? (slot === "chat.settings" ? "settings" : "surface")),
        props: typeof input.props === "function" ? input.props : null,
      }));
      publish();
      return () => {
        if (registrations.delete(key)) publish();
      };
    },
    list(slot) {
      const chat = activeChat.getSnapshot();
      return [...registrations.values()]
        .filter((item) => item.slot === slot)
        .sort((left, right) => right.priority - left.priority || left.ownerId.localeCompare(right.ownerId))
        .map((item) => Object.freeze({ ...item, capabilityProps: Object.freeze({ chatId: chat.chatId, ...(item.props?.(chat) ?? {}) }) }));
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
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

function createClientRuntime(serverHealth) {
  const consumers = new Map();
  const generation = createGenerationLifecycle();
  const activeChat = createActiveChatLifecycle();
  const commands = createCommandRegistry();
  const drafts = createDraftGenerationService();
  const ui = createUiRegistry(activeChat);
  const mountNativeSlot = createNativeSlotMounter();
  const capabilities = new Set([
    "chat.active",
    "client.bridge-first",
    "commands",
    "commands.draft-write",
    "consumer.sessions",
    "diagnostics",
    "generation.draft",
    "generation.lifecycle",
    "quick-replies.input-macro",
    "runtime.health",
    "ui.chat-settings",
    "ui.composer.above-input",
    "ui.tracker-panel",
    "ui.roleplay-hud",
  ]);
  return Object.freeze({
    apiVersion: API_VERSION,
    implementationVersion: "1.0.9",
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
              "chat.settings": "ui.chat-settings",
              "composer.above-input": "ui.composer.above-input",
              "tracker.panel": "ui.tracker-panel",
              "roleplay.hud": "ui.roleplay-hud",
            })[input?.slot];
            if (!capability) throw new Error(`${consumerId} requested an unsupported Mari Bridge UI slot`);
            if (!required.includes(capability)) throw new Error(`${consumerId} did not require ${capability}`);
            const cleanup = ui.register(consumerId, input);
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
    ui,
    mountNativeSlot,
  });
}

async function readServerHealth() {
  const response = await fetch("/api/health", {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Marinara health check failed while loading Mari Bridge (${response.status})`);
  const health = await response.json();
  const bridge = health?.capabilityPackages?.packages?.find((item) => item?.id === "mari-bridge");
  if (!bridge?.ready || bridge?.readiness !== "ready") {
    throw new Error(`Mari Bridge server package is ${bridge?.readiness ?? bridge?.status ?? "unavailable"}`);
  }
  return Object.freeze({
    status: "ready",
    engineVersion: health?.version ?? null,
    packageVersion: bridge?.version ?? null,
  });
}

if (!globalThis[CLIENT_SYMBOL]) {
  const serverHealth = await readServerHealth();
  globalThis[CLIENT_SYMBOL] = createClientRuntime(serverHealth);
  defineNativeSlotElement(globalThis[CLIENT_SYMBOL].ui);
}
document.documentElement.dataset.mariBridgeClient = "ready";

if (!customElements.get("marinara-capability-mari-bridge")) {
  customElements.define(
    "marinara-capability-mari-bridge",
    class MariBridgeRuntimeElement extends HTMLElement {
      connectedCallback() {
        this.hidden = true;
        this.setAttribute("aria-hidden", "true");
        this.dataset.mariBridgeStatus = "ready";
      }
    },
  );
}
