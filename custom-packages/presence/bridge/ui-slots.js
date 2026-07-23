import { createDomScope, getActiveChatIdFromClient, isVisibleElement } from "./composer-dom.js";

// Upstream gap MB-010: packages do not yet have stable composer UI slots.

const UI_SLOT_STATE_KEY = "__mariBridgeUiSlotState";

export const COMPOSER_SLOT_ABOVE_INPUT = "composer:above-input";
export const COMPOSER_SLOT_QUICK_ACTIONS = "composer:quick-actions";

const KNOWN_COMPOSER_SLOTS = new Set([COMPOSER_SLOT_ABOVE_INPUT, COMPOSER_SLOT_QUICK_ACTIONS]);

// Registers package-owned UI with a bridge-managed composer slot.
export function registerComposerSlotContribution(contribution) {
  const normalized = normalizeSlotContribution(contribution);
  const state = getUiSlotState();
  state.contributions.set(normalized.key, normalized);
  ensureComposerSlotBridge();
  scheduleComposerSlotRender();
  return () => {
    const current = state.contributions.get(normalized.key);
    if (current !== normalized) return;
    state.contributions.delete(normalized.key);
    unmountContribution(state, normalized.key);
    scheduleComposerSlotRender();
  };
}

// Starts DOM observation for composer slots. Registration calls this automatically.
export function ensureComposerSlotBridge(options = {}) {
  const state = getUiSlotState();
  if (state.started) return state;
  state.started = true;
  state.scope = createDomScope();
  state.renderDelayMs = Number.isFinite(Number(options.renderDelayMs)) ? Number(options.renderDelayMs) : 80;
  if (document.readyState === "loading") {
    state.scope.on(document, "DOMContentLoaded", () => startComposerSlotObservation(state), { once: true });
  } else {
    startComposerSlotObservation(state);
  }
  return state;
}

// Forces a bridge slot render pass after a package changes its own state.
export function scheduleComposerSlotRender(delayMs) {
  const state = getUiSlotState();
  if (state.renderTimer) state.scope?.clearTimer?.(state.renderTimer);
  const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : state.renderDelayMs;
  state.renderTimer = (state.scope || createDomScope()).timeout(() => {
    state.renderTimer = 0;
    renderComposerSlots(state);
  }, delay);
}

// Returns the active composer pieces that bridge slot renderers receive.
export function findActiveComposerContext() {
  const root = findActiveChatComposer();
  const textarea = root?.querySelector("textarea.mari-chat-input-textarea, textarea") || null;
  const sendButton = root?.querySelector("button.mari-chat-send-btn, button[title='Send'], button[aria-label='Send']") || null;
  return {
    root,
    textarea,
    sendButton,
    chatId: getActiveChatIdFromClient(),
  };
}

function getUiSlotState() {
  if (!window[UI_SLOT_STATE_KEY]) {
    window[UI_SLOT_STATE_KEY] = {
      started: false,
      scope: null,
      observer: null,
      renderTimer: 0,
      renderDelayMs: 80,
      activeRoot: null,
      contributions: new Map(),
      mounted: new Map(),
    };
  }
  return window[UI_SLOT_STATE_KEY];
}

function startComposerSlotObservation(state) {
  state.scope.on(window, "focus", () => scheduleComposerSlotRender(0));
  state.scope.on(window, "resize", () => scheduleComposerSlotRender());
  state.scope.on(window, "popstate", () => scheduleComposerSlotRender(0));
  state.scope.on(window, "mari-bridge:generation-state", () => scheduleComposerSlotRender());
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");
  if (document.body) {
    state.observer = state.scope.observe(
      document.body,
      () => scheduleComposerSlotRender(),
      { childList: true, subtree: true },
    );
  }
  scheduleComposerSlotRender(0);
}

function renderComposerSlots(state) {
  const context = findActiveComposerContext();
  if (!context.root) {
    unmountAll(state);
    state.activeRoot = null;
    return;
  }
  if (state.activeRoot && state.activeRoot !== context.root) unmountAll(state);
  state.activeRoot = context.root;

  const slotHosts = ensureSlotHosts(context);
  const contributions = [...state.contributions.values()]
    .filter((entry) => KNOWN_COMPOSER_SLOTS.has(entry.slot))
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  const visibleKeys = new Set();

  for (const contribution of contributions) {
    const slotHost = slotHosts[contribution.slot];
    if (!slotHost || contribution.shouldShow(context) === false) {
      unmountContribution(state, contribution.key);
      continue;
    }
    visibleKeys.add(contribution.key);
    mountOrUpdateContribution(state, contribution, slotHost, context);
  }

  for (const key of [...state.mounted.keys()]) {
    if (!visibleKeys.has(key)) unmountContribution(state, key);
  }
}

function ensureSlotHosts(context) {
  return {
    [COMPOSER_SLOT_ABOVE_INPUT]: ensureAboveInputHost(context.root),
    [COMPOSER_SLOT_QUICK_ACTIONS]: ensureQuickActionsHost(context.root, context.sendButton),
  };
}

function ensureAboveInputHost(root) {
  let host = root.querySelector(":scope > [data-mari-bridge-slot='composer:above-input']");
  if (!(host instanceof HTMLElement)) {
    host = document.createElement("div");
    host.dataset.mariBridgeSlot = COMPOSER_SLOT_ABOVE_INPUT;
    host.className = "mari-bridge-slot mari-bridge-slot-above-input";
    root.insertBefore(host, root.firstChild);
  }
  return host;
}

function ensureQuickActionsHost(root, sendButton) {
  let host = root.querySelector(":scope [data-mari-bridge-slot='composer:quick-actions']");
  if (!(host instanceof HTMLElement)) {
    host = document.createElement("span");
    host.dataset.mariBridgeSlot = COMPOSER_SLOT_QUICK_ACTIONS;
    host.className = "mari-bridge-slot mari-bridge-slot-quick-actions";
  }
  const targetParent = sendButton?.parentElement || root;
  if (host.parentElement !== targetParent) {
    targetParent.insertBefore(host, sendButton || null);
  } else if (sendButton && host.nextElementSibling !== sendButton) {
    targetParent.insertBefore(host, sendButton);
  }
  return host;
}

function mountOrUpdateContribution(state, contribution, slotHost, context) {
  let mounted = state.mounted.get(contribution.key);
  const needsRender = !mounted || mounted.slotHost !== slotHost;
  if (needsRender) {
    unmountContribution(state, contribution.key);
    const host = document.createElement("span");
    host.dataset.mariBridgeContribution = contribution.key;
    host.dataset.mariBridgePackageId = contribution.packageId;
    host.dataset.mariBridgeContributionId = contribution.id;
    host.className = "mari-bridge-slot-contribution";
    const rendered = contribution.render({ ...context, slot: contribution.slot, host, slotHost });
    const node = rendered instanceof Node ? rendered : host;
    if (node !== host) host.appendChild(node);
    slotHost.appendChild(host);
    mounted = { host, node, slotHost, cleanup: null };
    state.mounted.set(contribution.key, mounted);
  }
  const cleanup = contribution.update?.({ ...context, slot: contribution.slot, host: mounted.host, node: mounted.node, slotHost });
  if (typeof cleanup === "function") mounted.cleanup = cleanup;
}

function unmountContribution(state, key) {
  const mounted = state.mounted.get(key);
  if (!mounted) return;
  state.mounted.delete(key);
  try {
    mounted.cleanup?.();
  } catch {}
  mounted.host?.remove();
}

function unmountAll(state) {
  for (const key of [...state.mounted.keys()]) unmountContribution(state, key);
}

function normalizeSlotContribution(contribution) {
  const packageId = String(contribution?.packageId || "").trim();
  const id = String(contribution?.id || "").trim();
  const slot = String(contribution?.slot || "").trim();
  if (!packageId) throw new Error("Composer slot contribution requires packageId.");
  if (!id) throw new Error("Composer slot contribution requires id.");
  if (!KNOWN_COMPOSER_SLOTS.has(slot)) throw new Error(`Unknown composer slot: ${slot || "(missing)"}`);
  if (typeof contribution.render !== "function") throw new Error(`Composer slot contribution ${packageId}:${id} requires render().`);
  return {
    packageId,
    id,
    key: `${packageId}:${id}`,
    slot,
    priority: Number.isFinite(Number(contribution.priority)) ? Number(contribution.priority) : 100,
    shouldShow: typeof contribution.shouldShow === "function" ? contribution.shouldShow : () => true,
    render: contribution.render,
    update: typeof contribution.update === "function" ? contribution.update : null,
  };
}

function findActiveChatComposer() {
  const candidates = Array.from(
    document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input, .chat-input-container"),
  );
  return candidates.find((root) => root instanceof HTMLElement && root.querySelector("textarea") && isVisibleElement(root)) || null;
}

function patchHistoryMethod(method) {
  const original = history[method];
  if (!original || original.__mariBridgeUiSlotPatched) return;
  const patched = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);
    scheduleComposerSlotRender(0);
    return result;
  };
  patched.__mariBridgeUiSlotPatched = true;
  history[method] = patched;
}
