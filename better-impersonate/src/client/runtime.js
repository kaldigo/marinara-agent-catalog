import { createController } from "./controller.js";
import { readRecall } from "./recall.js";
import { styleQuickAction, followNativeMotion } from "./quick-actions.js";

const OWNER = Symbol.for("marinara.better-impersonate.runtime");
const TAG = "marinara-capability-better-impersonate";
if (!customElements.get(TAG)) customElements.define(TAG, class extends HTMLElement {});
window[OWNER]?.dispose();

function mountBetterImpersonate() {
  const selector = 'textarea[data-chat-composer="true"][data-chat-id]';
  const popupSelector = '[data-chat-input-popup="quick-reply"]';
  const owned = new Set();
  const restores = new Map();
  let disposed = false;
  let queued = false;
  let notice;
  let noticeTimer;
  function report(error) {
    notice?.remove();
    clearTimeout(noticeTimer);
    notice = document.createElement("div");
    notice.setAttribute("role", "status");
    notice.textContent = error?.message || String(error);
    Object.assign(notice.style, { position: "fixed", bottom: "1rem", left: "1rem", right: "1rem",
      zIndex: "10050", padding: "0.75rem", borderRadius: "0.75rem", pointerEvents: "none",
      background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" });
    document.body.append(notice);
    noticeTimer = setTimeout(() => notice?.remove(), 6000);
  }
  function context() {
    const textarea = [...document.querySelectorAll(selector)].find(node => node.getClientRects().length);
    const root = textarea?.closest(".mari-chat-input");
    const chatId = textarea?.dataset.chatId;
    const send = root?.querySelector(".mari-chat-send-btn");
    if (!root || !chatId || !send) return null;
    const isBusy = () => textarea.disabled || textarea.readOnly ||
      Boolean(root.querySelector('button[aria-haspopup="menu"]:disabled')) ||
      Boolean(send.querySelector('[class*="lucide-stop"],[class*="lucide-circle-stop"],[class*="lucide-loader"]'));
    const valid = () => textarea.isConnected && textarea.dataset.chatId === chatId;
    const write = value => {
      if (!valid()) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    return { chatId, read: () => textarea.value, write, valid, isBusy, busy: isBusy(),
      lock(cancel) {
        const priorReadOnly = textarea.readOnly;
        const priorDisplay = send.style.display;
        textarea.readOnly = true;
        // A package-owned Stop replaces the visible Send control only for this dry run.
        // Native handlers are never clicked or changed.
        send.style.display = "none";
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = send.className;
        stop.textContent = "■";
        stop.title = "Stop impersonation";
        stop.setAttribute("aria-label", stop.title);
        stop.dataset.betterImpersonateStop = "";
        stop.addEventListener("click", cancel);
        send.after(stop);
        const block = event => {
          if (event.type === "keydown" && event.key !== "Enter") return;
          if (event.target === stop || stop.contains(event.target)) return;
          if (event.type === "click" || event.type === "keydown") {
            event.preventDefault(); event.stopImmediatePropagation();
          }
        };
        root.addEventListener("click", block, true);
        root.addEventListener("keydown", block, true);
        return () => {
          root.removeEventListener("click", block, true);
          root.removeEventListener("keydown", block, true);
          stop.remove();
          textarea.readOnly = priorReadOnly;
          send.style.display = priorDisplay;
        };
      },
    };
  }
  const controller = createController({ context, changed: () => schedule() });
  const paths = {
    impersonate: '<path d="m16 11 2 2 4-4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
    continue: '<path d="M4 12h12m-4-4 4 4-4 4m7-11v14"/>',
    restore: '<path d="M3 4v6h6M3 10a9 9 0 1 1 0 6"/>',
  };
  const labels = { impersonate: "Impersonate", continue: "Continue impersonate", restore: "Restore previous" };
  const descriptions = { impersonate: "Generate as your persona", continue: "Continue your current draft", restore: "Restore your previous direction" };
  function disabledReason(mode, ctx = context()) {
    if (!ctx) return "Select or create a chat first.";
    if (controller.active || ctx.busy) return "Wait for generation to finish.";
    if (mode === "restore") return readRecall(localStorage, ctx.chatId).lastGuidance.trim() ? "" : "No previous direction saved for this chat.";
    return ctx.read().trim() ? "" : mode === "continue" ? "Type a draft first." : "Type a direction first.";
  }
  function closeMenu() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  function sync() {
    if (disposed) return;
    if (controller.active && !controller.active.valid()) controller.cancel();
    for (const button of owned) if (!button.isConnected) owned.delete(button);
    for (const [popup, restore] of restores) if (!popup.isConnected) { restore(); restores.delete(popup); }
    for (const popup of document.querySelectorAll(popupSelector)) {
      const menu = popup.querySelector('[role="menu"]');
      if (!menu || menu.querySelector("[data-better-impersonate]")) continue;
      const nativeButtons = [...menu.querySelectorAll('button[role="menuitem"]')];
      const sample = nativeButtons[0];
      if (!sample) continue;
      const style = popup.getAttribute("style");
      let stopMotion = () => {};
      restores.set(popup, () => {
        stopMotion();
        if (style === null) popup.removeAttribute("style"); else popup.setAttribute("style", style);
      });
      const added = [];
      for (const mode of ["impersonate", "continue", "restore"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.dataset.betterImpersonate = mode;
        button.innerHTML = '<span><svg width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[mode] + '</svg></span>';
        styleQuickAction(button, disabledReason(mode), labels[mode], descriptions[mode]);
        button.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation();
          if (disabledReason(mode)) { schedule(); return; }
          closeMenu();
          if (mode === "restore") {
            try { controller.restore(); } catch (error) { report(error); }
          } else void controller.start(mode).catch(report);
        });
        owned.add(button);
        added.push(button);
        menu.insertBefore(button, sample);
      }
      stopMotion = followNativeMotion(nativeButtons, added);
    }
    const ctx = context();
    for (const button of owned) {
      const mode = button.dataset.betterImpersonate;
      styleQuickAction(button, disabledReason(mode, ctx), labels[mode], descriptions[mode]);
    }
    clampMenus();
  }
  function clampMenus() {
    for (const popup of restores.keys()) {
      if (!popup.isConnected) continue;
      popup.style.maxHeight = Math.max(44, innerHeight - 16) + "px";
      popup.style.overflowY = popup.scrollHeight > innerHeight - 16 ? "auto" : "visible";
      const rect = popup.getBoundingClientRect();
      const menuId = popup.querySelector('[role="menu"]')?.id;
      const trigger = menuId && document.querySelector('.mari-chat-input button[aria-controls="' + CSS.escape(menuId) + '"]');
      const anchor = trigger?.getBoundingClientRect();
      const above = anchor ? anchor.top - 8 - rect.height : rect.top;
      const top = anchor && above < 8 ? anchor.bottom + 8 : above;
      const left = anchor ? anchor.left + anchor.width / 2 - rect.width / 2 : rect.left;
      popup.style.top = Math.max(8, Math.min(top, innerHeight - rect.height - 8)) + "px";
      popup.style.left = Math.max(8, Math.min(left, innerWidth - rect.width - 8)) + "px";
    }
  }
  function schedule() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  }
  // Observe structure, not message content/characterData. Inspect only changed subtrees
  // for composer or quick-action markers; never scan the chat history on each token.
  const relevant = node => node.nodeType === 1 && (
    node.matches(selector + "," + popupSelector) || node.querySelector(selector + "," + popupSelector)
  );
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === "attributes"
      ? record.target.matches(selector + ',.mari-chat-input button[aria-haspopup="menu"]')
      : [...record.addedNodes, ...record.removedNodes].some(relevant))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-chat-id", "disabled", "readonly"] });
  function input(event) { if (event.target.matches?.(selector)) schedule(); }
  document.addEventListener("input", input);
  function keyboard(event) {
    const menu = event.target.closest?.(popupSelector + ' [role="menu"]');
    if (!menu || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...menu.querySelectorAll('button[role="menuitem"]:not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const index = buttons.indexOf(event.target.closest("button"));
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  document.addEventListener("keydown", keyboard, true);
  window.addEventListener("resize", clampMenus);
  window.addEventListener("pagehide", controller.cancel);
  schedule();
  return { get running() { return controller.active !== null; }, stop: controller.cancel, dispose() {
    if (disposed) return;
    disposed = true;
    controller.cancel();
    observer.disconnect();
    document.removeEventListener("input", input);
    document.removeEventListener("keydown", keyboard, true);
    window.removeEventListener("resize", clampMenus);
    window.removeEventListener("pagehide", controller.cancel);
    for (const button of owned) button.remove();
    for (const restore of restores.values()) restore();
    owned.clear(); restores.clear();
    clearTimeout(noticeTimer); notice?.remove();
  }};
}
window[OWNER] = mountBetterImpersonate();
