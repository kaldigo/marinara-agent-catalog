import { createDomScope, getActiveChatIdFromClient, isVisibleElement, watchActiveChatId } from "./composer-dom.js";
import { MARI_BRIDGE_VERSION, claimBridgeSubsystem, isBridgeSubsystemOwner, registerBridgeCapabilities } from "./runtime.js";

// Upstream gap MB-011: some declared or desired capability package slots are
// not yet mounted by the Marinara host. Bridge mounts package custom elements
// with upstream-style `view` and `capabilityProps` so packages can move to the
// native slot renderer later without changing their element contract.

const CAPABILITY_SLOT_STATE_KEY = "__mariBridgeCapabilitySlotState";

export const CAPABILITY_SLOT_CHAT_SETTINGS = "chat-settings";
export const CAPABILITY_SLOT_MESSAGE_ACTIONS = "message-actions";
export const CAPABILITY_SLOT_TOPBAR_PANEL = "topbar-panel";

const KNOWN_CAPABILITY_SLOTS = new Set([
  CAPABILITY_SLOT_CHAT_SETTINGS,
  CAPABILITY_SLOT_MESSAGE_ACTIONS,
  CAPABILITY_SLOT_TOPBAR_PANEL,
]);

registerBridgeCapabilities([
  "ui-slots:chat-settings",
  "ui-slots:message-actions",
  "ui-slots:topbar-panel",
  "capability-slots:register",
]);

export function registerCapabilitySlotContribution(contribution) {
  const normalized = normalizeCapabilitySlotContribution(contribution);
  const state = getCapabilitySlotState();
  state.contributions.set(normalized.key, normalized);
  ensureCapabilitySlotBridge();
  scheduleCapabilitySlotRenderInternal(0);
  return () => {
    const current = state.contributions.get(normalized.key);
    if (current !== normalized) return;
    state.contributions.delete(normalized.key);
    unmountContributionFamily(state, normalized.key);
    scheduleCapabilitySlotRenderInternal(0);
  };
}

export function ensureCapabilitySlotBridge(options = {}) {
  const state = getCapabilitySlotState();
  state.renderDelayMs = Number.isFinite(Number(options.renderDelayMs)) ? Number(options.renderDelayMs) : 120;
  claimBridgeSubsystem("capability-slots", {
    version: MARI_BRIDGE_VERSION,
    ownerId: "mari-bridge:capability-slots",
    install: ({ token }) => {
      state.ownerToken = token;
      state.scope = createDomScope();
      state.scheduleRender = (delayMs) => scheduleCapabilitySlotRenderForOwner(state, delayMs, token);
      if (document.readyState === "loading") {
        state.scope.on(document, "DOMContentLoaded", () => startCapabilitySlotObservation(state, token), { once: true });
      } else {
        startCapabilitySlotObservation(state, token);
      }
      return () => {
        unmountAll(state);
        state.scope?.destroy?.();
        state.scope = null;
        state.observer = null;
        state.ownerToken = null;
        state.scheduleRender = null;
      };
    },
  });
  return state;
}

export function scheduleCapabilitySlotRender(delayMs) {
  scheduleCapabilitySlotRenderInternal(delayMs);
}

function getCapabilitySlotState() {
  if (!window[CAPABILITY_SLOT_STATE_KEY]) {
    window[CAPABILITY_SLOT_STATE_KEY] = {
      contributions: new Map(),
      mounted: new Map(),
      scope: null,
      observer: null,
      renderTimer: 0,
      renderDelayMs: 120,
      ownerToken: null,
      scheduleRender: null,
    };
  }
  const state = window[CAPABILITY_SLOT_STATE_KEY];
  if (!(state.contributions instanceof Map)) state.contributions = new Map();
  if (!(state.mounted instanceof Map)) state.mounted = new Map();
  return state;
}

function startCapabilitySlotObservation(state, token) {
  if (!isBridgeSubsystemOwner("capability-slots", token)) return;
  state.scope.on(window, "focus", () => scheduleCapabilitySlotRenderInternal(0));
  state.scope.on(window, "resize", () => scheduleCapabilitySlotRenderInternal());
  state.scope.on(window, "popstate", () => scheduleCapabilitySlotRenderInternal(0));
  state.scope.cleanup(watchActiveChatId(() => scheduleCapabilitySlotRenderInternal(0), { debounceMs: 80, intervalMs: 1_000 }));
  patchCapabilitySlotHistoryMethod("pushState");
  patchCapabilitySlotHistoryMethod("replaceState");
  if (document.body) {
    state.observer = state.scope.observe(document.body, () => scheduleCapabilitySlotRenderInternal(), {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-chat-agent-entry", "data-message-id", "data-message-role", "class", "style"],
    });
  }
  scheduleCapabilitySlotRenderInternal(0);
}

function scheduleCapabilitySlotRenderInternal(delayMs) {
  const state = getCapabilitySlotState();
  ensureCapabilitySlotBridge();
  if (typeof state.scheduleRender === "function") state.scheduleRender(delayMs);
}

function scheduleCapabilitySlotRenderForOwner(state, delayMs, token) {
  if (!isBridgeSubsystemOwner("capability-slots", token)) return;
  if (state.renderTimer) state.scope?.clearTimer?.(state.renderTimer);
  state.renderTimer = (state.scope || createDomScope()).timeout(() => {
    state.renderTimer = 0;
    if (isBridgeSubsystemOwner("capability-slots", token)) renderCapabilitySlots(state);
  }, Number.isFinite(Number(delayMs)) ? Number(delayMs) : state.renderDelayMs);
}

function renderCapabilitySlots(state) {
  const visible = new Set();
  const contributions = [...state.contributions.values()].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  for (const contribution of contributions) {
    for (const context of findSlotContexts(contribution)) {
      if (contribution.shouldShow(context) === false) continue;
      const slotHost = ensureSlotContributionHost(contribution, context);
      if (!slotHost) continue;
      const mountKey = context.mountKey ? `${contribution.key}:${context.mountKey}` : contribution.key;
      visible.add(mountKey);
      mountOrUpdateContribution(state, mountKey, contribution, slotHost, context);
    }
  }
  for (const key of [...state.mounted.keys()]) {
    if (!visible.has(key)) unmountContribution(state, key);
  }
}

function findSlotContexts(contribution) {
  if (contribution.slot === CAPABILITY_SLOT_CHAT_SETTINGS) return findChatSettingsContexts(contribution);
  if (contribution.slot === CAPABILITY_SLOT_MESSAGE_ACTIONS) return findMessageActionContexts(contribution);
  if (contribution.slot === CAPABILITY_SLOT_TOPBAR_PANEL) return findTopbarPanelContexts(contribution);
  return [];
}

function findChatSettingsContexts(contribution) {
  const panel = findChatSettingsPanel();
  const chatId = getActiveChatIdFromClient();
  const agentId = contribution.match.agentId || contribution.packageId;
  const agentEntry = findAgentEntry(panel, agentId);
  if (!panel || !chatId || !agentEntry) return [];
  return [{ slot: contribution.slot, chatId, panel, agentId, agentEntry, mountKey: "chat-settings" }];
}

function findMessageActionContexts(contribution) {
  const chatId = getActiveChatIdFromClient();
  const nodes = Array.from(document.querySelectorAll("[data-message-id]")).filter(
    (node) => node instanceof HTMLElement && isVisibleElement(node),
  );
  return nodes.flatMap((node) => {
    const messageId = node.getAttribute("data-message-id") || "";
    if (!messageId) return [];
    const role = node.getAttribute("data-message-role") || "";
    return [{ slot: contribution.slot, chatId, messageId, role, node, mountKey: messageId }];
  });
}

function findTopbarPanelContexts(contribution) {
  const host = findTopbarHost();
  if (!host) return [];
  return [{ slot: contribution.slot, chatId: getActiveChatIdFromClient(), topbarHost: host, mountKey: "topbar" }];
}

function ensureSlotContributionHost(contribution, context) {
  if (context.slot === CAPABILITY_SLOT_CHAT_SETTINGS) return ensureChatSettingsHost(context.agentEntry, contribution);
  if (context.slot === CAPABILITY_SLOT_MESSAGE_ACTIONS) return ensureMessageActionHost(context.node, contribution);
  if (context.slot === CAPABILITY_SLOT_TOPBAR_PANEL) return ensureTopbarPanelHost(context.topbarHost, contribution);
  return null;
}

function mountOrUpdateContribution(state, mountKey, contribution, slotHost, context) {
  let mounted = state.mounted.get(mountKey);
  if (!mounted || mounted.slotHost !== slotHost) {
    unmountContribution(state, mountKey);
    const element = document.createElement(`marinara-capability-${contribution.packageId}`);
    element.setAttribute("view", contribution.view);
    if (contribution.className) element.className = contribution.className;
    element.dataset.mariBridgeCapabilitySlot = contribution.slot;
    element.dataset.mariBridgePackageId = contribution.packageId;
    element.dataset.mariBridgeContributionId = contribution.id;
    slotHost.appendChild(element);
    mounted = { element, slotHost };
    state.mounted.set(mountKey, mounted);
  }
  setCapabilityProps(mounted.element, contribution, context);
}

function unmountContribution(state, key) {
  const mounted = state.mounted.get(key);
  state.mounted.delete(key);
  mounted?.element?.remove();
  cleanupEmptyHost(mounted?.slotHost);
}

function unmountAll(state) {
  for (const key of [...state.mounted.keys()]) unmountContribution(state, key);
}

function unmountContributionFamily(state, contributionKey) {
  for (const key of [...state.mounted.keys()]) {
    if (key === contributionKey || key.startsWith(`${contributionKey}:`)) unmountContribution(state, key);
  }
}

function setCapabilityProps(element, contribution, context) {
  const extraProps = typeof contribution.props === "function" ? normalizeObject(contribution.props(context)) : contribution.props;
  element.capabilityProps = {
    ...extraProps,
    chatId: context.chatId || extraProps.chatId || "",
    slot: contribution.slot,
    packageId: contribution.packageId,
    contributionId: contribution.id,
    messageId: context.messageId,
    role: context.role,
    agentId: context.agentId,
  };
  element.dispatchEvent(new CustomEvent("marinara-capability-props"));
}

function findChatSettingsPanel() {
  const panels = Array.from(
    document.querySelectorAll(".mari-chat-settings-drawer[data-chat-floating-panel], [data-chat-floating-panel].mari-chat-settings-drawer"),
  );
  return panels.find((panel) => panel instanceof HTMLElement && isVisibleElement(panel)) || null;
}

function findAgentEntry(panel, agentId) {
  if (!panel || !agentId) return null;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(agentId) : agentId.replaceAll('"', '\\"');
  const entry = panel.querySelector(`[data-chat-agent-entry="${escaped}"]`);
  return entry instanceof HTMLElement && isVisibleElement(entry) ? entry : null;
}

function ensureChatSettingsHost(agentEntry, contribution) {
  let host = agentEntry.querySelector(`:scope > [data-mari-bridge-slot-host="${contribution.key}"]`);
  if (!(host instanceof HTMLElement)) {
    host = document.createElement("div");
    host.dataset.mariBridgeSlotHost = contribution.key;
    host.className = "mari-bridge-slot-host mari-bridge-chat-settings-host";
    agentEntry.appendChild(host);
  }
  return host;
}

function ensureMessageActionHost(node, contribution) {
  const actionBar = node.querySelector(":scope .mari-message-actions") || node;
  let host = actionBar.querySelector(`:scope > [data-mari-bridge-slot-host="${contribution.key}"]`);
  if (!(host instanceof HTMLElement)) {
    host = document.createElement("span");
    host.dataset.mariBridgeSlotHost = contribution.key;
    host.className = "mari-bridge-slot-host mari-bridge-message-action-host";
    actionBar.appendChild(host);
  }
  return host;
}

function findTopbarHost() {
  const hosts = Array.from(document.querySelectorAll(".mari-topbar-panel-nav, .mari-topbar-left-controls, .mari-topbar"));
  return hosts.find((host) => host instanceof HTMLElement && isVisibleElement(host)) || null;
}

function ensureTopbarPanelHost(topbarHost, contribution) {
  let host = topbarHost.querySelector(`:scope > [data-mari-bridge-slot-host="${contribution.key}"]`);
  if (!(host instanceof HTMLElement)) {
    host = document.createElement("span");
    host.dataset.mariBridgeSlotHost = contribution.key;
    host.className = "mari-bridge-slot-host mari-bridge-topbar-panel-host";
    topbarHost.appendChild(host);
  }
  return host;
}

function cleanupEmptyHost(host) {
  if (host instanceof HTMLElement && host.childElementCount === 0) host.remove();
}

function normalizeCapabilitySlotContribution(contribution) {
  const packageId = String(contribution?.packageId || "").trim();
  const id = String(contribution?.id || "").trim();
  const slot = String(contribution?.slot || "").trim();
  const view = String(contribution?.view || defaultViewForSlot(slot)).trim();
  if (!packageId) throw new Error("Capability slot contribution requires packageId.");
  if (!id) throw new Error("Capability slot contribution requires id.");
  if (!KNOWN_CAPABILITY_SLOTS.has(slot)) throw new Error(`Unknown capability slot: ${slot || "(missing)"}.`);
  if (!view) throw new Error(`Capability slot contribution ${packageId}:${id} requires view.`);
  return {
    packageId,
    id,
    slot,
    view,
    key: `${packageId}:${id}`,
    match: normalizeObject(contribution.match),
    className: String(contribution.className || ""),
    priority: Number.isFinite(Number(contribution.priority)) ? Number(contribution.priority) : 100,
    props: typeof contribution.props === "function" ? contribution.props : normalizeObject(contribution.props),
    shouldShow: typeof contribution.shouldShow === "function" ? contribution.shouldShow : () => true,
  };
}

function defaultViewForSlot(slot) {
  if (slot === CAPABILITY_SLOT_CHAT_SETTINGS) return "settings";
  if (slot === CAPABILITY_SLOT_MESSAGE_ACTIONS) return "message-actions";
  if (slot === CAPABILITY_SLOT_TOPBAR_PANEL) return "toolbar";
  return "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function patchCapabilitySlotHistoryMethod(method) {
  const state = getCapabilitySlotHistoryState();
  state.watchers[method].add(scheduleCapabilitySlotRenderInternal);
  const original = history[method];
  if (original && !state.patched[method]) {
    state.original[method] = original;
    history[method] = function patchedHistoryMethod(...args) {
      const result = state.original[method].apply(this, args);
      for (const watcher of [...state.watchers[method]]) watcher(0);
      return result;
    };
    state.patched[method] = true;
  }
}

function getCapabilitySlotHistoryState() {
  const key = "__mariBridgeCapabilitySlotHistoryState";
  if (!window[key]) {
    window[key] = {
      original: {},
      patched: {},
      watchers: {
        pushState: new Set(),
        replaceState: new Set(),
      },
    };
  }
  return window[key];
}
