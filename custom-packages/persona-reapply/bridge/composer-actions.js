import { isVisibleElement } from "./composer-dom.js";

// Upstream gap MB-010: packages do not yet have stable native composer action
// APIs, so bridge exposes reusable probes for existing Marinara quick actions.

// Finds Marinara's native "Trigger character response" composer action.
export function findComposerTriggerResponseButton(root) {
  return (
    Array.from(root?.querySelectorAll("button[title^='Trigger character response']") || []).find(isVisibleElement) ||
    null
  );
}

// Finds the native quick-reply control or an active quick-reply action button.
export function findComposerQuickReplyControl(root, options = {}) {
  const excludeSelector = typeof options.excludeSelector === "string" ? options.excludeSelector : "";
  const actionPrefixes = Array.isArray(options.actionPrefixes) ? options.actionPrefixes : ["Post only", "Guide reply", "Impersonate"];
  const selectors = [
    "button[aria-label='Quick replies']",
    "button[title='Quick replies']",
    ...actionPrefixes.flatMap((prefix) => [
      `button[aria-label^='${cssEscapeForSelector(prefix)}:']`,
      `button[title^='${cssEscapeForSelector(prefix)}:']`,
    ]),
  ];
  return (
    Array.from(root?.querySelectorAll(selectors.join(",")) || []).find((button) =>
      excludeSelector ? !button.closest(excludeSelector) : true,
    ) || null
  );
}

// Returns the element packages should align against for a native quick-reply action.
export function getComposerQuickReplyShell(button) {
  if (!button) return null;
  const label = button.getAttribute("aria-label") || "";
  const title = button.getAttribute("title") || "";
  if (label === "Quick replies" || title === "Quick replies") return button.parentElement || button;
  return button;
}

// Finds the native quick-reply menu trigger in a composer root.
export function findComposerQuickReplyTrigger(root) {
  return root?.querySelector("button[aria-label='Quick replies'], button[title='Quick replies']") || null;
}

// Finds an open native quick-reply action by label prefix.
export function findComposerQuickReplyActionButton(label, options = {}) {
  const excludeSelector = typeof options.excludeSelector === "string" ? options.excludeSelector : "";
  const prefix = `${label}:`;
  return (
    Array.from(document.querySelectorAll("button[aria-label], button[title]")).find((button) => {
      if (excludeSelector && button.closest(excludeSelector)) return false;
      const aria = button.getAttribute("aria-label") || "";
      const title = button.getAttribute("title") || "";
      return aria.startsWith(prefix) || title.startsWith(prefix);
    }) || null
  );
}

// Opens the native quick-reply menu when needed, then clicks the requested action.
export async function clickComposerQuickReplyAction({ root, label, excludeSelector = "", waitMs = 70 }) {
  const trigger = findComposerQuickReplyTrigger(root);
  let action = findComposerQuickReplyActionButton(label, { excludeSelector });

  if (!action && trigger && !trigger.disabled) {
    trigger.click();
    await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    action = findComposerQuickReplyActionButton(label, { excludeSelector });
  }

  if (!action) return { ok: false, reason: "missing" };
  if (action.disabled || action.getAttribute("aria-disabled") === "true") {
    return { ok: false, reason: "disabled", title: action.getAttribute("title") || "" };
  }
  action.click();
  return { ok: true };
}

function cssEscapeForSelector(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(String(value));
  return String(value).replace(/['\\]/gu, "\\$&");
}
