import assert from "node:assert/strict";
import fs from "node:fs/promises";

const element = (chatId) => ({
  getAttribute(name) {
    return name === "data-chat-id" ? chatId : "";
  },
});

globalThis.window = {};
globalThis.localStorage = {
  value: "",
  getItem(key) {
    return key === "marinara-active-chat-id" ? this.value : null;
  },
};
globalThis.document = {
  selected: null,
  first: null,
  querySelector(selector) {
    if (selector.includes("sidebar-accent") || selector.includes("aria-current")) return this.selected;
    if (selector === "[data-chat-id]") return this.first;
    return null;
  },
};

const { getActiveChatIdFromClient } = await import("../src/composer-dom.js");

document.first = element("first-sidebar-chat");
localStorage.value = "active-from-storage";
assert.equal(
  getActiveChatIdFromClient(),
  "active-from-storage",
  "stored active chat wins over the first sidebar data-chat-id row",
);

window.useChatStore = {
  getState() {
    return { activeChatId: "active-from-store" };
  },
};
assert.equal(
  getActiveChatIdFromClient(),
  "active-from-store",
  "known chat store wins over localStorage and sidebar fallbacks",
);

window.useChatStore = null;
localStorage.value = "";
document.selected = element("selected-sidebar-chat");
assert.equal(getActiveChatIdFromClient(), "selected-sidebar-chat", "selected data-chat-id row is used as DOM fallback");

document.selected = null;
assert.equal(getActiveChatIdFromClient(), "first-sidebar-chat", "first data-chat-id row is only a final fallback");

localStorage.getItem = () => {
  throw new Error("storage blocked");
};
assert.equal(getActiveChatIdFromClient(), "first-sidebar-chat", "blocked localStorage falls through to DOM fallback");

const uiSlotsSource = await fs.readFile(new URL("../src/ui-slots.js", import.meta.url), "utf8");
assert(uiSlotsSource.includes("watchActiveChatId"), "UI slots subscribe to active chat changes");
assert(
  uiSlotsSource.includes("watchActiveChatId(() => scheduleComposerSlotRender(0)"),
  "active chat changes schedule a composer slot render",
);

console.log("Mari bridge composer DOM checks passed.");
