import { apiRequest, streamJsonSse } from "./generation-stream.js";
import { findActiveComposerContext } from "./ui-slots.js";
import { MARI_BRIDGE_VERSION, claimBridgeSubsystem, isBridgeSubsystemOwner } from "./runtime.js";

// Upstream gap MB-011: packages do not yet have stable generation lifecycle hooks.

const GENERATION_STATE_KEY = "__mariBridgeGenerationState";
const NATIVE_MAIN_SOURCE_ID = "marinara:native-main";

export const GENERATION_KIND_MAIN = "main";
export const GENERATION_KIND_AGENT = "agent";
export const GENERATION_STATE_EVENT = "mari-bridge:generation-state";
export const GENERATING_MAIN_EVENT = "mari-bridge:generating-main";
export const GENERATING_AGENT_EVENT = "mari-bridge:generating-agent";

// Starts native generation tracking and bridge event emission.
export function ensureGenerationLifecycleBridge(options = {}) {
  const state = getGenerationState();
  state.nativeTracking = options.nativeTracking !== false;
  claimBridgeSubsystem("generation-lifecycle", {
    version: MARI_BRIDGE_VERSION,
    ownerId: "mari-bridge:generation-lifecycle",
    install: ({ token }) => {
      state.ownerToken = token;
      state.emitGenerationSnapshot = (entry, active, status, detail) =>
        emitGenerationSnapshotForOwner(state, entry, active, status, detail, token);
      const start = () => startGenerationObservation(state, token);
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
        return () => document.removeEventListener("DOMContentLoaded", start);
      }
      start();
      return () => stopGenerationObservation(state, token);
    },
  });
  return state;
}

// Declares package-owned generation activity; callers must call end(), error(), or abort().
export function declarePackageGeneration(input = {}) {
  ensureGenerationLifecycleBridge();
  const state = getGenerationState();
  const entry = normalizeGenerationEntry(input);
  state.active.set(entry.key, entry);
  let lock = null;
  if (entry.lockComposer) {
    lock = createComposerGenerationLock({
      packageId: entry.packageId,
      chatId: entry.chatId,
      runId: entry.runId,
      reason: entry.reason,
      abort: () => controller.abort(),
    });
  }
  const controller = {
    runId: entry.runId,
    end: (detail = {}) => finishDeclaredGeneration(entry.key, "complete", detail, lock),
    error: (error) => finishDeclaredGeneration(entry.key, "error", { error: errorMessage(error) }, lock),
    abort: () => {
      try {
        entry.abort?.();
      } catch {}
      finishDeclaredGeneration(entry.key, "aborted", {}, lock);
    },
  };
  emitGenerationSnapshot(state, entry, true, "started");
  return controller;
}

// Streams /api/generate/dryRun with bridge generation events and optional composer locking.
export async function streamBridgeDryRunGeneration(input = {}) {
  const declaration = declarePackageGeneration({
    packageId: input.packageId,
    id: input.id || "dry-run",
    kind: input.kind || GENERATION_KIND_AGENT,
    chatId: input.chatId || input.body?.chatId || "",
    reason: input.reason || "dry-run",
    lockComposer: input.lockComposer === true,
    abort: input.abort,
  });
  try {
    const result = await streamJsonSse(input.path || "/api/generate/dryRun", input.body || {}, input.handlers || {}, {
      signal: input.signal,
      headers: input.headers,
    });
    declaration.end();
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") declaration.abort();
    else declaration.error(error);
    throw error;
  }
}

// Calls /api/generate/raw with bridge generation events and optional composer locking.
export async function callBridgeRawGeneration(input = {}) {
  const declaration = declarePackageGeneration({
    packageId: input.packageId,
    id: input.id || "raw",
    kind: input.kind || GENERATION_KIND_AGENT,
    chatId: input.chatId || input.body?.chatId || "",
    reason: input.reason || "raw",
    lockComposer: input.lockComposer === true,
    abort: input.abort,
  });
  try {
    const result = await apiRequest(input.path || "/generate/raw", {
      method: input.method || "POST",
      headers: input.headers,
      body: JSON.stringify(input.body || {}),
      signal: input.signal,
    });
    declaration.end();
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") declaration.abort();
    else declaration.error(error);
    throw error;
  }
}

// Temporarily disables the composer and turns the send button into a Stop control.
export function createComposerGenerationLock(input = {}) {
  const context = findActiveComposerContext();
  const textarea = context.textarea;
  const sendButton = context.sendButton;
  const original = {
    textareaDisabled: textarea?.disabled,
    sendDisabled: sendButton?.disabled,
    sendAriaDisabled: sendButton?.getAttribute("aria-disabled"),
    sendTitle: sendButton?.getAttribute("title"),
    sendAriaLabel: sendButton?.getAttribute("aria-label"),
  };
  const onStop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    input.abort?.();
  };

  if (textarea) textarea.disabled = true;
  if (sendButton) {
    sendButton.disabled = false;
    sendButton.removeAttribute("aria-disabled");
    sendButton.setAttribute("title", "Stop generating");
    sendButton.setAttribute("aria-label", "Stop generating");
    sendButton.classList.add("mari-bridge-generation-stop");
    sendButton.addEventListener("click", onStop, true);
  }

  return () => {
    if (textarea && original.textareaDisabled !== undefined) textarea.disabled = original.textareaDisabled;
    if (sendButton) {
      sendButton.disabled = original.sendDisabled ?? false;
      restoreAttribute(sendButton, "aria-disabled", original.sendAriaDisabled);
      restoreAttribute(sendButton, "title", original.sendTitle);
      restoreAttribute(sendButton, "aria-label", original.sendAriaLabel);
      sendButton.classList.remove("mari-bridge-generation-stop");
      sendButton.removeEventListener("click", onStop, true);
    }
  };
}

// Lets listeners query the current bridge generation snapshot.
export function getBridgeGenerationSnapshot() {
  const state = getGenerationState();
  return buildSnapshot(state);
}

function getGenerationState() {
  if (!window[GENERATION_STATE_KEY]) {
    window[GENERATION_STATE_KEY] = {
      started: false,
      nativeTracking: true,
      active: new Map(),
      nativeActive: false,
      observer: null,
      syncTimer: 0,
      ownerToken: null,
      nativeHandlers: null,
      emitGenerationSnapshot: null,
    };
  }
  const state = window[GENERATION_STATE_KEY];
  if (!(state.active instanceof Map)) state.active = new Map();
  if (!("ownerToken" in state)) state.ownerToken = null;
  if (!("nativeHandlers" in state)) state.nativeHandlers = null;
  if (!("emitGenerationSnapshot" in state)) state.emitGenerationSnapshot = null;
  return state;
}

function startGenerationObservation(state, token) {
  if (!isBridgeSubsystemOwner("generation-lifecycle", token)) return;
  if (state.nativeTracking) {
    const handlers = {
      click: () => scheduleNativeGenerationSync(state, token),
      focus: () => scheduleNativeGenerationSync(state, token),
      pageshow: () => scheduleNativeGenerationSync(state, token),
      complete: () => setNativeMainActive(state, false, "complete"),
      error: () => setNativeMainActive(state, false, "error"),
    };
    state.nativeHandlers = handlers;
    document.addEventListener("click", handlers.click, true);
    window.addEventListener("focus", handlers.focus);
    window.addEventListener("pageshow", handlers.pageshow);
    window.addEventListener("marinara:generation-complete", handlers.complete);
    window.addEventListener("marinara:generation-error", handlers.error);
    if (document.body) {
      state.observer = new MutationObserver(() => scheduleNativeGenerationSync(state, token));
      state.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label", "title", "class", "disabled"],
      });
    }
    scheduleNativeGenerationSync(state, token, 0);
  }
}

function stopGenerationObservation(state, token) {
  if (state.ownerToken !== token) return;
  const handlers = state.nativeHandlers;
  if (handlers) {
    document.removeEventListener("click", handlers.click, true);
    window.removeEventListener("focus", handlers.focus);
    window.removeEventListener("pageshow", handlers.pageshow);
    window.removeEventListener("marinara:generation-complete", handlers.complete);
    window.removeEventListener("marinara:generation-error", handlers.error);
  }
  state.observer?.disconnect?.();
  if (state.syncTimer) window.clearTimeout(state.syncTimer);
  state.nativeHandlers = null;
  state.observer = null;
  state.syncTimer = 0;
  state.emitGenerationSnapshot = null;
  state.ownerToken = null;
}

function scheduleNativeGenerationSync(state, token, delay = 80) {
  if (!isBridgeSubsystemOwner("generation-lifecycle", token)) return;
  if (state.syncTimer) window.clearTimeout(state.syncTimer);
  state.syncTimer = window.setTimeout(() => {
    state.syncTimer = 0;
    if (!isBridgeSubsystemOwner("generation-lifecycle", token)) return;
    setNativeMainActive(state, detectNativeMainGenerationActive(), "detected");
  }, delay);
}

function setNativeMainActive(state, active, reason) {
  if (state.nativeActive === active) return;
  state.nativeActive = active;
  const entry = {
    key: NATIVE_MAIN_SOURCE_ID,
    packageId: "marinara",
    id: "native-main",
    kind: GENERATION_KIND_MAIN,
    chatId: "",
    runId: NATIVE_MAIN_SOURCE_ID,
    reason,
  };
  if (active) state.active.set(entry.key, entry);
  else state.active.delete(entry.key);
  emitGenerationSnapshot(state, entry, active, reason);
}

function detectNativeMainGenerationActive() {
  return collectCandidateButtons().some(isGenerationStopButton);
}

function collectCandidateButtons() {
  const buttons = new Set();
  document
    .querySelectorAll(".mari-chat-input button, .chat-input-container button, button.mari-chat-send-btn")
    .forEach((button) => buttons.add(button));
  document
    .querySelectorAll("button[title*='Stop' i], button[aria-label*='Stop' i]")
    .forEach((button) => buttons.add(button));
  return [...buttons];
}

function isGenerationStopButton(button) {
  if (!(button instanceof HTMLButtonElement) || !button.isConnected) return false;
  const label = [button.getAttribute("title"), button.getAttribute("aria-label"), button.textContent]
    .filter(Boolean)
    .join(" ");
  if (/\bstop\s+generat(?:e|ing|ion)\b/i.test(label)) return true;
  const inChatInput = Boolean(button.closest(".mari-chat-input, .chat-input-container"));
  if (!inChatInput && !button.classList.contains("mari-chat-send-btn")) return false;
  const svg = button.querySelector("svg");
  if (!svg) return false;
  const className = svg.getAttribute("class") || "";
  return /\b(lucide-)?(circle-stop|stop-circle)\b/i.test(className) || Boolean(svg.querySelector("circle") && svg.querySelector("rect"));
}

function finishDeclaredGeneration(key, status, detail, lock) {
  const state = getGenerationState();
  const entry = state.active.get(key);
  if (!entry) return;
  state.active.delete(key);
  try {
    lock?.();
  } catch {}
  emitGenerationSnapshot(state, entry, false, status, detail);
}

function emitGenerationSnapshot(state, entry, active, status, detail = {}) {
  if (typeof state.emitGenerationSnapshot === "function") {
    state.emitGenerationSnapshot(entry, active, status, detail);
    return;
  }
  emitGenerationSnapshotForOwner(state, entry, active, status, detail, state.ownerToken);
}

function emitGenerationSnapshotForOwner(state, entry, active, status, detail = {}, token = null) {
  if (token && !isBridgeSubsystemOwner("generation-lifecycle", token)) return;
  const snapshot = buildSnapshot(state);
  const eventDetail = {
    active,
    status,
    source: entry,
    snapshot,
    ...detail,
  };
  window.dispatchEvent(new CustomEvent(GENERATION_STATE_EVENT, { detail: eventDetail }));
  window.dispatchEvent(
    new CustomEvent(entry.kind === GENERATION_KIND_MAIN ? GENERATING_MAIN_EVENT : GENERATING_AGENT_EVENT, {
      detail: eventDetail,
    }),
  );
}

function buildSnapshot(state) {
  const active = [...state.active.values()];
  return {
    active,
    mainActive: active.some((entry) => entry.kind === GENERATION_KIND_MAIN),
    agentActive: active.some((entry) => entry.kind === GENERATION_KIND_AGENT),
  };
}

function normalizeGenerationEntry(input) {
  const packageId = String(input.packageId || "").trim();
  const id = String(input.id || "").trim();
  if (!packageId) throw new Error("Generation declaration requires packageId.");
  if (!id) throw new Error("Generation declaration requires id.");
  const runId = String(input.runId || `${packageId}:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
  const kind = input.kind === GENERATION_KIND_MAIN ? GENERATION_KIND_MAIN : GENERATION_KIND_AGENT;
  return {
    key: `${packageId}:${id}:${runId}`,
    packageId,
    id,
    kind,
    chatId: typeof input.chatId === "string" ? input.chatId : "",
    runId,
    reason: typeof input.reason === "string" ? input.reason : "",
    lockComposer: input.lockComposer === true,
    abort: typeof input.abort === "function" ? input.abort : null,
  };
}

function restoreAttribute(element, name, value) {
  if (value == null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
