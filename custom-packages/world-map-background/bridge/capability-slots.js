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
const AGENT_SETTINGS_SURFACE_CLASS = "border border-[var(--border)] bg-[var(--secondary)]/70";
const GENERATED_AGENT_CARD_SELECTOR = "[data-mari-bridge-generated-agent-card]";
const SLOT_LOG_PREFIX = "[mari-bridge:slots]";

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
  logCapabilitySlotState(state, `contribution:${normalized.key}`, "registered contribution", {
    slot: normalized.slot,
    packageId: normalized.packageId,
    id: normalized.id,
    view: normalized.view,
    match: normalized.match,
  });
  ensureCapabilitySlotBridge();
  scheduleCapabilitySlotRenderInternal(0);
  return () => {
    const current = state.contributions.get(normalized.key);
    if (current !== normalized) return;
    state.contributions.delete(normalized.key);
    logCapabilitySlotState(state, `contribution:${normalized.key}`, "removed contribution", {
      slot: normalized.slot,
      packageId: normalized.packageId,
      id: normalized.id,
    });
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
        disconnectChatSettingsPanelWatcher(state);
        state.scope?.destroy?.();
        state.scope = null;
        state.observer = null;
        state.chatSettingsPanel = null;
        state.renderTimerDueAt = 0;
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
      chatSettingsPanel: null,
      chatSettingsPanelScope: null,
      chatSettingsPanelObserver: null,
      debugValues: new Map(),
      renderTimer: 0,
      renderTimerDueAt: 0,
      renderDelayMs: 120,
      ownerToken: null,
      scheduleRender: null,
    };
  }
  const state = window[CAPABILITY_SLOT_STATE_KEY];
  if (!(state.contributions instanceof Map)) state.contributions = new Map();
  if (!(state.mounted instanceof Map)) state.mounted = new Map();
  if (!(state.debugValues instanceof Map)) state.debugValues = new Map();
  state.renderTimerDueAt = Number(state.renderTimerDueAt) || 0;
  return state;
}

function startCapabilitySlotObservation(state, token) {
  if (!isBridgeSubsystemOwner("capability-slots", token)) return;
  logCapabilitySlotState(state, "observer:body", "started outer slot observer", { bridgeVersion: MARI_BRIDGE_VERSION });
  state.scope.on(window, "focus", () => handleCapabilitySlotDomChange(state, token, 0));
  state.scope.on(window, "resize", () => scheduleCapabilitySlotRenderInternal());
  state.scope.on(window, "popstate", () => handleCapabilitySlotDomChange(state, token, 0));
  state.scope.cleanup(watchActiveChatId(() => handleCapabilitySlotDomChange(state, token, 0), { debounceMs: 80, intervalMs: 1_000 }));
  patchCapabilitySlotHistoryMethod("pushState");
  patchCapabilitySlotHistoryMethod("replaceState");
  if (document.body) {
    state.observer = state.scope.observe(document.body, (mutations) => {
      if (shouldIgnoreBridgeOwnedMutations(mutations)) return;
      handleCapabilitySlotDomChange(state, token);
    }, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-chat-agent-entry", "data-message-id", "data-message-role", "data-chat-floating-panel", "class", "style"],
    });
  }
  handleCapabilitySlotDomChange(state, token, 0);
}

function handleCapabilitySlotDomChange(state, token, delayMs) {
  if (!isBridgeSubsystemOwner("capability-slots", token)) return;
  syncChatSettingsPanelWatcher(state, token);
  scheduleCapabilitySlotRenderInternal(delayMs);
}

function syncChatSettingsPanelWatcher(state, token) {
  if (!isBridgeSubsystemOwner("capability-slots", token)) return;
  const panel = findChatSettingsPanel();
  if (panel === state.chatSettingsPanel) return;
  disconnectChatSettingsPanelWatcher(state);
  state.chatSettingsPanel = panel;
  if (!(panel instanceof HTMLElement)) {
    logCapabilitySlotState(state, "chat-settings:panel", "chat settings panel missing", {});
    unmountSlot(state, CAPABILITY_SLOT_CHAT_SETTINGS);
    return;
  }
  logCapabilitySlotState(state, "chat-settings:panel", "chat settings panel found", describeElement(panel));
  const panelScope = createDomScope();
  state.chatSettingsPanelScope = panelScope;
  state.scope?.cleanup?.(() => panelScope.destroy());
  state.chatSettingsPanelObserver = panelScope.observe(panel, (mutations) => {
    if (shouldIgnoreBridgeOwnedMutations(mutations)) return;
    if (!document.body?.contains(panel) || !isVisibleElement(panel)) {
      logCapabilitySlotState(state, "chat-settings:panel", "chat settings panel disappeared", describeElement(panel));
      syncChatSettingsPanelWatcher(state, token);
      scheduleCapabilitySlotRenderInternal(0);
      return;
    }
    scheduleCapabilitySlotRenderInternal();
  }, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-expanded", "data-chat-settings-section", "data-chat-agent-entry", "class", "style"],
  });
  logCapabilitySlotState(state, "chat-settings:panel-observer", "attached chat settings panel observer", describeElement(panel));
  scheduleCapabilitySlotRenderInternal(0);
}

function disconnectChatSettingsPanelWatcher(state) {
  if (state.chatSettingsPanel || state.chatSettingsPanelScope) {
    logCapabilitySlotState(state, "chat-settings:panel-observer", "detached chat settings panel observer", {});
  }
  state.chatSettingsPanelScope?.destroy?.();
  state.chatSettingsPanelScope = null;
  state.chatSettingsPanelObserver = null;
  state.chatSettingsPanel = null;
}

function scheduleCapabilitySlotRenderInternal(delayMs) {
  const state = getCapabilitySlotState();
  ensureCapabilitySlotBridge();
  if (typeof state.scheduleRender === "function") state.scheduleRender(delayMs);
}

function scheduleCapabilitySlotRenderForOwner(state, delayMs, token) {
  if (!isBridgeSubsystemOwner("capability-slots", token)) return;
  const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : state.renderDelayMs;
  const dueAt = Date.now() + delay;
  if (state.renderTimer) {
    if (delay > 0 && state.renderTimerDueAt > 0 && state.renderTimerDueAt <= dueAt) return;
    state.scope?.clearTimer?.(state.renderTimer);
  }
  state.renderTimerDueAt = dueAt;
  state.renderTimer = (state.scope || createDomScope()).timeout(() => {
    state.renderTimer = 0;
    state.renderTimerDueAt = 0;
    if (isBridgeSubsystemOwner("capability-slots", token)) renderCapabilitySlots(state);
  }, delay);
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
  const state = getCapabilitySlotState();
  const panel = findChatSettingsPanel();
  if (!panel) {
    if (contribution.slot === CAPABILITY_SLOT_CHAT_SETTINGS) {
      logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for chat settings panel", {
        sectionId: contribution.match.sectionId || "",
      });
    }
    return [];
  }
  const chatId = getActiveChatIdFromClient();
  const agentId = contribution.match.agentId || contribution.packageId;
  if (contribution.match.sectionId) {
    const section = findChatSettingsSection(panel, contribution.match.sectionId);
    const sectionStack = findChatSettingsSectionStack(section);
    if (!section) {
      logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for chat settings section", {
        chatId,
        sectionId: contribution.match.sectionId,
        panel: true,
      });
      return [];
    }
    if (!sectionStack) {
      logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for open chat settings section content", {
        chatId,
        sectionId: contribution.match.sectionId,
        sectionChildren: section.children.length,
        headerExpanded: section.firstElementChild?.getAttribute?.("aria-expanded") || "",
      });
      return [];
    }
    logCapabilitySlotState(state, `context:${contribution.key}`, "chat settings section content ready", {
      chatId,
      sectionId: contribution.match.sectionId,
      stackChildren: sectionStack.children.length,
    });
    const agentCard = findAgentSettingsCard(section, chatId, agentId);
    return [{ slot: contribution.slot, chatId, panel, section, sectionStack, agentId, agentCard, mountKey: "chat-settings" }];
  }
  const section = findChatSettingsSection(panel, contribution.match.sectionId);
  const agentEntry = findAgentEntry(panel, agentId);
  const agentCard = findAgentSettingsCard(panel, chatId, agentId);
  if (!section && !agentEntry && !agentCard) {
    logCapabilitySlotState(state, `context:${contribution.key}`, "waiting for generic chat settings target", {
      chatId,
      agentId,
    });
    return [];
  }
  return [{ slot: contribution.slot, chatId, panel, section, agentId, agentEntry, agentCard, mountKey: "chat-settings" }];
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
  if (context.slot === CAPABILITY_SLOT_CHAT_SETTINGS) return ensureChatSettingsHost(context, contribution);
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
    logCapabilitySlotState(state, `mounted:${mountKey}`, "mounted capability element", {
      packageId: contribution.packageId,
      id: contribution.id,
      slot: contribution.slot,
      view: contribution.view,
      chatId: context.chatId || "",
      sectionId: context.section?.dataset?.chatSettingsSection || "",
      host: describeElement(slotHost),
    });
  }
  setCapabilityProps(mounted.element, contribution, context);
}

function unmountContribution(state, key) {
  const mounted = state.mounted.get(key);
  state.mounted.delete(key);
  if (mounted?.element) {
    logCapabilitySlotState(state, `mounted:${key}`, "unmounted capability element", {
      slot: mounted.element.dataset.mariBridgeCapabilitySlot || "",
      packageId: mounted.element.dataset.mariBridgePackageId || "",
      id: mounted.element.dataset.mariBridgeContributionId || "",
    });
  }
  mounted?.element?.remove();
  cleanupEmptyHost(mounted?.slotHost);
}

function unmountAll(state) {
  for (const key of [...state.mounted.keys()]) unmountContribution(state, key);
}

function unmountSlot(state, slot) {
  for (const [key, mounted] of [...state.mounted.entries()]) {
    if (mounted?.element?.dataset?.mariBridgeCapabilitySlot === slot) unmountContribution(state, key);
  }
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
    document.querySelectorAll(
      ".mari-chat-settings-drawer[data-chat-floating-panel], [data-chat-floating-panel].mari-chat-settings-drawer, .mari-chat-settings-popover[data-chat-floating-panel], [data-chat-floating-panel].mari-chat-settings-popover",
    ),
  );
  return panels.find((panel) => panel instanceof HTMLElement && isVisibleElement(panel)) || null;
}

function findAgentEntry(panel, agentId) {
  if (!panel || !agentId) return null;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(agentId) : agentId.replaceAll('"', '\\"');
  const entry = panel.querySelector(`[data-chat-agent-entry="${escaped}"]`);
  return entry instanceof HTMLElement && isVisibleElement(entry) ? entry : null;
}

function findChatSettingsSection(panel, sectionId) {
  if (!panel || !sectionId) return null;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sectionId) : cssAttributeValue(sectionId);
  const section = panel.querySelector(`[data-chat-settings-section="${escaped}"]`);
  return section instanceof HTMLElement && isVisibleElement(section) ? section : null;
}

function findAgentSettingsCard(panel, chatId, agentId) {
  if (!panel || !agentId) return null;
  const cardId = getAgentSettingsCardId(chatId, agentId);
  if (cardId) {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(cardId) : cardId.replaceAll('"', '\\"');
    const existing = panel.querySelector(`#${escaped}`);
    if (existing instanceof HTMLElement) return existing;
  }
  const generated = panel.querySelector(`${GENERATED_AGENT_CARD_SELECTOR}[data-mari-bridge-agent-id="${cssAttributeValue(agentId)}"]`);
  return generated instanceof HTMLElement ? generated : null;
}

function ensureChatSettingsHost(context, contribution) {
  const state = getCapabilitySlotState();
  const card = context.agentCard || ensureGeneratedAgentSettingsCard(context.panel, context.agentId, contribution, context);
  if (card) {
    ensureGeneratedAgentSettingsCardPlacement(card, context, contribution);
    const body = ensureGeneratedAgentSettingsBody(card);
    if (body) return ensureContributionHost(body, contribution, "div", "mari-bridge-slot-host mari-bridge-chat-settings-host");
  }
  if (!context.agentEntry) {
    logCapabilitySlotState(state, `host:${contribution.key}`, "no chat settings host available", {
      sectionId: context.section?.dataset?.chatSettingsSection || "",
      agentId: context.agentId || "",
    });
    return null;
  }
  return ensureContributionHost(context.agentEntry, contribution, "div", "mari-bridge-slot-host mari-bridge-chat-settings-host");
}

function ensureGeneratedAgentSettingsCard(panel, agentId, contribution, context = null) {
  const state = getCapabilitySlotState();
  if (!panel || !agentId) return null;
  const existing = findAgentSettingsCard(panel, getActiveChatIdFromClient(), agentId);
  if (existing) {
    logCapabilitySlotState(state, `card:${contribution.key}`, "found existing settings card", {
      agentId,
      card: describeElement(existing),
    });
    return existing;
  }
  const parent = findAgentSettingsCardContainer(panel, context, contribution);
  if (!parent) {
    logCapabilitySlotState(state, `card:${contribution.key}`, "waiting for settings card parent", {
      agentId,
      sectionId: context?.section?.dataset?.chatSettingsSection || "",
    });
    return null;
  }
  const card = document.createElement("div");
  const cardId = getAgentSettingsCardId(getActiveChatIdFromClient(), agentId);
  if (cardId) {
    card.id = cardId;
    card.tabIndex = -1;
  }
  card.dataset.mariBridgeGeneratedAgentCard = contribution.key;
  card.dataset.mariBridgeAgentId = agentId;
  card.className = `scroll-mt-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/45 ${AGENT_SETTINGS_SURFACE_CLASS}`;
  if (Number.isFinite(contribution.order)) card.style.order = String(contribution.order);

  const header = document.createElement("div");
  header.className = "flex items-start p-3";
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "-m-1 flex min-w-0 flex-1 items-start gap-2 rounded-lg p-1 text-left transition-colors hover:bg-[var(--accent)]/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/60";
  button.setAttribute("aria-expanded", "true");
  const icon = document.createElement("span");
  icon.className = "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[0.5625rem] font-semibold text-[var(--primary)] ring-1 ring-[var(--primary)]/30";
  icon.textContent = contribution.iconText || contribution.title.charAt(0) || "P";
  const text = document.createElement("span");
  text.className = "min-w-0 flex-1";
  const title = document.createElement("span");
  title.className = "flex min-w-0 items-center gap-1.5 text-[0.6875rem] font-medium";
  const titleText = document.createElement("span");
  titleText.className = "min-w-0 truncate";
  titleText.textContent = contribution.title;
  title.appendChild(titleText);
  const description = document.createElement("span");
  description.className = "mt-1 block text-[0.625rem] text-[var(--muted-foreground)]";
  description.textContent = contribution.description;
  text.append(title, description);
  const chevron = document.createElement("span");
  chevron.className = "mt-0.5 shrink-0 text-[var(--muted-foreground)]";
  chevron.textContent = "›";
  chevron.style.transform = "rotate(90deg)";
  button.append(icon, text, chevron);
  header.appendChild(button);
  const body = document.createElement("div");
  body.className = "space-y-2 px-3 pb-2";
  body.dataset.mariBridgeAgentSettingsBody = "true";
  button.addEventListener("click", () => {
    const open = body.hidden === true;
    body.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    chevron.style.transform = open ? "rotate(90deg)" : "rotate(0deg)";
  });
  card.append(header, body);
  insertGeneratedAgentSettingsCard(parent, card, context, contribution);
  logCapabilitySlotState(state, `card:${contribution.key}`, "created generated settings card", {
    agentId,
    sectionId: context?.section?.dataset?.chatSettingsSection || "",
    parent: describeElement(parent),
  });
  return card;
}

function findAgentSettingsCardContainer(panel, context, contribution) {
  if (context?.sectionStack instanceof HTMLElement) return context.sectionStack;
  const generated = panel.querySelector(GENERATED_AGENT_CARD_SELECTOR);
  if (generated?.parentElement instanceof HTMLElement) return generated.parentElement;
  const existingCards = Array.from(panel.querySelectorAll('[id^="chat-settings-agent-menu-"]')).filter(
    (node) => node instanceof HTMLElement,
  );
  const lastCard = existingCards.at(-1);
  if (lastCard?.parentElement instanceof HTMLElement) return lastCard.parentElement;
  const agentEntries = Array.from(panel.querySelectorAll("[data-chat-agent-entry]")).filter((node) => node instanceof HTMLElement);
  const lastEntry = agentEntries.at(-1);
  return lastEntry?.parentElement instanceof HTMLElement ? lastEntry.parentElement : null;
}

function ensureGeneratedAgentSettingsCardPlacement(card, context, contribution) {
  const state = getCapabilitySlotState();
  if (!(card instanceof HTMLElement) || !card.matches(GENERATED_AGENT_CARD_SELECTOR)) return;
  const parent = findAgentSettingsCardContainer(context.panel, context, contribution);
  if (!parent) return;
  insertGeneratedAgentSettingsCard(parent, card, context, contribution);
  logCapabilitySlotState(state, `card-placement:${contribution.key}`, "placed generated settings card", {
    sectionId: context.section?.dataset?.chatSettingsSection || "",
    parent: describeElement(parent),
  });
}

function findChatSettingsSectionStack(section) {
  if (!(section instanceof HTMLElement)) return null;
  const content = section.children[1];
  if (!(content instanceof HTMLElement)) return null;
  const stack = content.firstElementChild;
  if (stack instanceof HTMLElement && stack.classList.contains("space-y-2")) return stack;
  return content;
}

function insertGeneratedAgentSettingsCard(parent, card, context, contribution) {
  const after = findChatSettingsSectionInsertionAnchor(parent, context, contribution);
  if (after?.parentElement === parent) {
    if (card.parentElement === parent && card.previousElementSibling === after) return;
    after.after(card);
    return;
  }
  if (card.parentElement === parent && parent.firstElementChild === card) return;
  parent.prepend(card);
}

function findChatSettingsSectionInsertionAnchor(parent, context) {
  if (context?.section?.dataset?.chatSettingsSection !== "roleplay-agents") return null;
  const directButtons = Array.from(parent.children).filter(
    (child) => child instanceof HTMLElement && child.tagName === "BUTTON",
  );
  return directButtons.at(-1) || null;
}

function ensureGeneratedAgentSettingsBody(card) {
  const body = card.querySelector(":scope > [data-mari-bridge-agent-settings-body]");
  if (body instanceof HTMLElement) return body;
  const nativeBody = Array.from(card.children).find(
    (child) =>
      child instanceof HTMLElement &&
      child.classList.contains("space-y-2") &&
      child.classList.contains("px-3") &&
      child.classList.contains("pb-2"),
  );
  if (nativeBody instanceof HTMLElement) return nativeBody;
  return card;
}

function ensureContributionHost(parent, contribution, tagName, className) {
  const state = getCapabilitySlotState();
  let host = parent.querySelector(`:scope > [data-mari-bridge-slot-host="${contribution.key}"]`);
  if (!(host instanceof HTMLElement)) {
    host = document.createElement(tagName);
    host.dataset.mariBridgeSlotHost = contribution.key;
    host.className = className;
    parent.appendChild(host);
    logCapabilitySlotState(state, `host:${contribution.key}`, "created contribution host", {
      slot: contribution.slot,
      parent: describeElement(parent),
    });
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

function shouldIgnoreBridgeOwnedMutations(mutations) {
  const list = Array.from(mutations || []);
  return list.length > 0 && list.every(isBridgeOwnedMutation);
}

function isBridgeOwnedMutation(mutation) {
  if (isBridgeOwnedNode(mutation.target)) return true;
  const changedNodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
  return changedNodes.length > 0 && changedNodes.every(isBridgeOwnedNode);
}

function isBridgeOwnedNode(node) {
  if (!(node instanceof Node)) return false;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  if (!(element instanceof HTMLElement)) return false;
  return Boolean(
    element.closest(
      `${GENERATED_AGENT_CARD_SELECTOR}, [data-mari-bridge-slot-host], [data-mari-bridge-capability-slot]`,
    ),
  );
}

function logCapabilitySlotState(state, key, message, details = {}) {
  if (!(state.debugValues instanceof Map)) state.debugValues = new Map();
  const signature = `${message}:${stableDebugSignature(details)}`;
  if (state.debugValues.get(key) === signature) return;
  state.debugValues.set(key, signature);
  globalThis.console?.info?.(SLOT_LOG_PREFIX, message, details);
}

function stableDebugSignature(value) {
  try {
    return JSON.stringify(value, Object.keys(value || {}).sort());
  } catch {
    return String(value);
  }
}

function describeElement(element) {
  if (!(element instanceof HTMLElement)) return {};
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || "",
    className: typeof element.className === "string" ? element.className : "",
    chatSettingsSection: element.dataset.chatSettingsSection || "",
    chatFloatingPanel: element.dataset.chatFloatingPanel || "",
    chatAgentEntry: element.dataset.chatAgentEntry || "",
    bridgeSlotHost: element.dataset.mariBridgeSlotHost || "",
  };
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
    order: Number.isFinite(Number(contribution.order)) ? Number(contribution.order) : null,
    title: String(contribution.title || contribution.packageId || packageId),
    description: String(contribution.description || ""),
    iconText: String(contribution.iconText || "").trim().slice(0, 2),
    props: typeof contribution.props === "function" ? contribution.props : normalizeObject(contribution.props),
    shouldShow: typeof contribution.shouldShow === "function" ? contribution.shouldShow : () => true,
  };
}

function getAgentSettingsCardId(chatId, agentId) {
  if (!chatId || !agentId) return "";
  return `chat-settings-agent-menu-${chatId}-${agentId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
