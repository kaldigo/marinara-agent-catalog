import { looksLikeNativeMessageRange, tokenizeCommandTail } from "./ranges.js";
import { getActiveChatIdFromClient, setTextControlValue } from "./composer-dom.js";
import { MARI_BRIDGE_VERSION, claimBridgeSubsystem, isBridgeSubsystemOwner } from "./runtime.js";

// Upstream gap MB-001: packages cannot register Roleplay/Conversation slash commands.

const COMMAND_BRIDGE_STATE_KEY = "__mariBridgeSlashCommandState";

export function createSlashCommandRouter() {
  const registrations = new Map();
  return {
    register(registration) {
      const normalized = normalizeRegistration(registration);
      registrations.set(normalized.id, normalized);
      return () => registrations.delete(normalized.id);
    },
    match(rawText) {
      return matchSlashCommand(rawText, [...registrations.values()]);
    },
    async run(rawText, context = {}) {
      const match = matchSlashCommand(rawText, [...registrations.values()]);
      if (!match) return { handled: false };
      const result = await match.registration.handler({ ...match, context });
      return { handled: true, result };
    },
  };
}

// Registers a browser-side package slash command or native-command augment.
export function registerBridgeSlashCommand(registration) {
  const normalized = normalizeBridgeCommandRegistration(registration);
  const state = getCommandBridgeState();
  state.registrations.set(normalized.key, normalized);
  ensureSlashCommandBridge();
  return () => {
    const current = state.registrations.get(normalized.key);
    if (current === normalized) state.registrations.delete(normalized.key);
  };
}

// Installs the bridge-owned composer interception runtime.
export function ensureSlashCommandBridge(options = {}) {
  const state = getCommandBridgeState();
  if (typeof options.resolveContext === "function") state.resolveContext = options.resolveContext;
  if (typeof options.onFeedback === "function") state.onFeedback = options.onFeedback;
  claimBridgeSubsystem("slash-commands", {
    version: MARI_BRIDGE_VERSION,
    ownerId: "mari-bridge:slash-commands",
    install: ({ token }) => {
      state.ownerToken = token;
      const start = () => installSlashCommandListeners(token);
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
        return () => document.removeEventListener("DOMContentLoaded", start);
      }
      return start();
    },
  });
  return state;
}

// Pure helper for tests and packages that want to inspect registered commands.
export function listBridgeSlashCommands() {
  return sortedBridgeRegistrations(getCommandBridgeState());
}

export function matchSlashCommand(rawText, registrations) {
  const raw = String(rawText || "").trim();
  if (!raw.startsWith("/")) return null;
  for (const registration of registrations || []) {
    const match = matchOne(raw, normalizeRegistration(registration));
    if (match) return match;
  }
  return null;
}

export function normalizeRegistration(registration) {
  if (!registration?.id) throw new Error("Slash command registration requires an id.");
  if (typeof registration.handler !== "function") {
    throw new Error(`Slash command ${registration.id} requires a handler.`);
  }
  return {
    id: String(registration.id),
    commands: normalizeCommandNames(registration.commands || registration.command || registration.name),
    hijacks: normalizeCommandNames(registration.hijacks || []),
    owns: typeof registration.owns === "function" ? registration.owns : () => true,
    handler: registration.handler,
  };
}

function normalizeCommandNames(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter(Boolean)
    .map((item) => String(item).trim().toLowerCase())
    .map((item) => (item.startsWith("/") ? item : `/${item}`));
}

function matchOne(raw, registration) {
  const lower = raw.toLowerCase();
  const direct = registration.commands.find((command) => lower === command || lower.startsWith(`${command} `));
  if (direct) {
    const tail = raw.slice(direct.length).trim();
    const tokens = tokenizeCommandTail(tail);
    if (!registration.owns({ raw, command: direct, tail, tokens, hijacked: false })) return null;
    return { registration, raw, command: direct, tail, tokens, hijacked: false };
  }

  for (const hijack of registration.hijacks) {
    if (lower !== hijack && !lower.startsWith(`${hijack} `)) continue;
    const tail = raw.slice(hijack.length).trim();
    const tokens = tokenizeCommandTail(tail);
    if (!tokens.length) continue;
    if (looksLikeNativeMessageRange(tail)) continue;
    if (!registration.owns({ raw, command: hijack, tail, tokens, hijacked: true })) continue;
    return { registration, raw, command: hijack, tail, tokens, hijacked: true };
  }

  return null;
}

export function createHideHijackOwner() {
  return ({ tokens }) => {
    const first = tokens[0] || "";
    return Boolean(first) && !looksLikeNativeMessageRange(first);
  };
}

function getCommandBridgeState() {
  if (!window[COMMAND_BRIDGE_STATE_KEY]) {
    window[COMMAND_BRIDGE_STATE_KEY] = {
      started: false,
      registrations: new Map(),
      resolveContext: null,
      onFeedback: null,
      ownerToken: null,
    };
  }
  const state = window[COMMAND_BRIDGE_STATE_KEY];
  if (!(state.registrations instanceof Map)) state.registrations = new Map();
  if (!("ownerToken" in state)) state.ownerToken = null;
  return state;
}

function installSlashCommandListeners(token) {
  const onKeyDown = (event) => {
    if (isBridgeSubsystemOwner("slash-commands", token)) onComposerKeyDownCapture(event);
  };
  const onSubmit = (event) => {
    if (isBridgeSubsystemOwner("slash-commands", token)) onComposerSubmitCapture(event);
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("submit", onSubmit, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("submit", onSubmit, true);
  };
}

async function onComposerKeyDownCapture(event) {
  if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement)) return;
  await maybeHandleBridgeSlashCommand(event, target);
}

async function onComposerSubmitCapture(event) {
  if (event.defaultPrevented) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const field = form.querySelector("textarea, input[type='text']");
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
    await maybeHandleBridgeSlashCommand(event, field);
  }
}

async function maybeHandleBridgeSlashCommand(event, field) {
  const raw = String(field.value || "").trim();
  if (!raw.startsWith("/")) return;
  const state = getCommandBridgeState();
  const match = matchSlashCommand(raw, sortedBridgeRegistrations(state));
  if (!match) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  const context = await resolveCommandContext(state, { raw, field, match });
  try {
    const result = await match.registration.handler({ ...match, context });
    if (result?.clearInput !== false) setTextControlValue(field, "");
    publishCommandFeedback(state, {
      ok: true,
      packageId: match.registration.packageId,
      id: match.registration.id,
      command: match.command,
      result,
    });
  } catch (error) {
    publishCommandFeedback(state, {
      ok: false,
      packageId: match.registration.packageId,
      id: match.registration.id,
      command: match.command,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function resolveCommandContext(state, base) {
  const context = {
    chatId: getActiveChatIdFromClient(),
    field: base.field,
    raw: base.raw,
    match: base.match,
  };
  if (typeof state.resolveContext !== "function") return context;
  const extra = await state.resolveContext(context);
  return extra && typeof extra === "object" ? { ...context, ...extra } : context;
}

function publishCommandFeedback(state, detail) {
  state.onFeedback?.(detail);
  window.dispatchEvent(new CustomEvent("mari-bridge:slash-command-feedback", { detail }));
}

function sortedBridgeRegistrations(state) {
  return [...state.registrations.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

function normalizeBridgeCommandRegistration(registration) {
  const packageId = String(registration?.packageId || "").trim();
  if (!packageId) throw new Error("Bridge slash command registration requires packageId.");
  const normalized = normalizeRegistration(registration);
  const localId = String(registration.id || normalized.id).trim();
  return {
    ...normalized,
    id: localId,
    key: `${packageId}:${localId}`,
    packageId,
    kind: registration.kind === "augment" ? "augment" : "command",
    priority: Number.isFinite(Number(registration.priority)) ? Number(registration.priority) : 100,
  };
}
