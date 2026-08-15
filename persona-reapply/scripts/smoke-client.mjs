import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..", "dist", "package");
const clientSource = fs.readFileSync(path.join(packageRoot, "client.js"), "utf8");

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return !event.defaultPrevented;
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  values() {
    return new Set(String(this.owner.className || "").split(/\s+/u).filter(Boolean));
  }

  write(values) {
    this.owner.className = [...values].join(" ");
  }

  add(...names) {
    const values = this.values();
    for (const name of names) values.add(name);
    this.write(values);
  }

  remove(...names) {
    const values = this.values();
    for (const name of names) values.delete(name);
    this.write(values);
  }

  contains(name) {
    return this.values().has(name);
  }

  toggle(name, force) {
    const values = this.values();
    const enabled = force === undefined ? !values.has(name) : Boolean(force);
    if (enabled) values.add(name);
    else values.delete(name);
    this.write(values);
    return enabled;
  }
}

class FakeStyle {
  setProperty(name, value) {
    this[name] = String(value);
  }

  removeProperty(name) {
    delete this[name];
  }
}

function dataKey(name) {
  return name
    .slice(5)
    .replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

class FakeElement extends FakeEventTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = new FakeStyle();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.id = "";
    this.textContent = "";
    this.isConnected = false;
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === "id") this.id = normalized;
    else if (name === "class") this.className = normalized;
    else if (name.startsWith("data-")) this.dataset[dataKey(name)] = normalized;
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name.startsWith("data-")) return this.dataset[dataKey(name)] ?? null;
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    if (child.parentElement) child.remove();
    child.parentElement = this;
    this.children.push(child);
    if (this.isConnected) connectTree(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  prepend(child) {
    if (child.parentElement) child.remove();
    child.parentElement = this;
    this.children.unshift(child);
    if (this.isConnected) connectTree(child);
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentElement = null;
      child.isConnected = false;
    }
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
    this.isConnected = false;
    this.disconnectedCallback?.();
  }

  contains(candidate) {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  after(candidate) {
    if (!this.parentElement) return;
    if (candidate.parentElement) candidate.remove();
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    candidate.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, candidate);
    if (this.isConnected) connectTree(candidate);
  }

  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector === "[data-mari-bridge-generated-agent-card]") {
      return this.dataset.mariBridgeGeneratedAgentCard !== undefined;
    }
    return false;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector.startsWith(".") && current.classList.contains(selector.slice(1))) return current;
      if (selector === "[data-chat-mode]" && current.dataset.chatMode !== undefined) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector.startsWith(":scope > [data-mari-bridge-slot-host=\"")) {
      const key = selector.match(/"([^"]+)"/u)?.[1];
      return this.children.filter((child) => child.dataset.mariBridgeSlotHost === key);
    }
    if (selector === ":scope > span[style]") {
      return this.children.filter((child) => child.tagName === "SPAN" && Object.keys(child.style).length > 0);
    }
    if (selector === ":scope .mari-message-actions") {
      return descendants(this).filter((child) => child.classList.contains("mari-message-actions"));
    }
    if (selector === ".mari-message-content strong, .mari-message-content span") {
      const content = descendants(this).filter((child) => child.classList.contains("mari-message-content"));
      return content.flatMap((root) => descendants(root).filter((child) => ["STRONG", "SPAN"].includes(child.tagName)));
    }
    if (selector.includes(",")) {
      return [...new Set(selector.split(",").flatMap((part) => this.querySelectorAll(part.trim())))];
    }
    const all = descendants(this);
    if (selector === "button") return all.filter((child) => child.tagName === "BUTTON");
    if (selector.startsWith(".")) return all.filter((child) => child.classList.contains(selector.slice(1)));
    if (selector === "[data-message-id]") return all.filter((child) => child.dataset.messageId);
    const messageId = selector.match(/^\[data-message-id="(.*)"\]$/u)?.[1];
    if (messageId !== undefined) return all.filter((child) => child.dataset.messageId === messageId);
    if (selector === "[data-chat-id]") return all.filter((child) => child.dataset.chatId);
    return [];
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get childElementCount() {
    return this.children.length;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }

  getBoundingClientRect() {
    return { width: 200, height: 40 };
  }
}

class FakeHTMLElement extends FakeElement {}
class FakeHTMLButtonElement extends FakeHTMLElement {
  constructor() {
    super("button");
  }
}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLTextAreaElement extends FakeHTMLElement {}
class FakeHTMLFormElement extends FakeHTMLElement {}

function descendants(root) {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function connectTree(element) {
  const wasConnected = element.isConnected;
  element.isConnected = true;
  if (!wasConnected) element.connectedCallback?.();
  for (const child of element.children) connectTree(child);
}

const registry = new Map();
const customElements = {
  define(name, constructor) {
    registry.set(name, constructor);
  },
  get(name) {
    return registry.get(name);
  },
};

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.readyState = "complete";
    this.hidden = false;
    this.head = new FakeHTMLElement("head");
    this.body = new FakeHTMLElement("body");
    connectTree(this.head);
    connectTree(this.body);
  }

  createElement(tagName) {
    const constructor = customElements.get(tagName);
    if (constructor) {
      const element = new constructor();
      element.tagName = tagName.toUpperCase();
      return element;
    }
    if (tagName === "button") return new FakeHTMLButtonElement();
    if (tagName === "input") return new FakeHTMLInputElement(tagName);
    if (tagName === "textarea") return new FakeHTMLTextAreaElement(tagName);
    if (tagName === "form") return new FakeHTMLFormElement(tagName);
    return new FakeHTMLElement(tagName);
  }

  getElementById(id) {
    return [...descendants(this.head), ...descendants(this.body)].find((element) => element.id === id) || null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (selector.includes("mari-chat-settings") || selector.includes("mari-topbar")) return [];
    return this.body.querySelectorAll(selector);
  }
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.defaultPrevented = false;
    this.target = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeCustomEvent extends FakeEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail;
  }
}

class FakeMutationObserver {
  observe() {}
  disconnect() {}
}

const timers = new Map();
let nextTimerId = 1;
const requests = [];
const windowEvents = new FakeEventTarget();
const document = new FakeDocument();
const history = { pushState() {}, replaceState() {} };
const localStorage = { getItem() { return null; }, setItem() {} };

const chatSurface = document.createElement("main");
chatSurface.dataset.chatMode = "roleplay";
const message = document.createElement("article");
message.dataset.messageId = "message-1";
message.dataset.messageRole = "user";
const name = document.createElement("div");
name.className = "mari-message-name";
const bubble = document.createElement("div");
bubble.className = "mari-message-bubble mari-rp-bubble";
const content = document.createElement("div");
content.className = "mari-message-content";
const dialogue = document.createElement("span");
dialogue.textContent = '"Hello"';
dialogue.style.color = "#222222";
content.appendChild(dialogue);
const actionBar = document.createElement("div");
actionBar.className = "mari-message-actions";
message.append(name, bubble, content, actionBar);
chatSurface.appendChild(message);
document.body.appendChild(chatSurface);

const sandbox = {
  URL,
  Map,
  Set,
  Symbol,
  Date,
  Promise,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  TypeError,
  JSON,
  Math,
  encodeURIComponent,
  decodeURIComponent,
  console: { info() {}, warn() {}, error() {} },
  document,
  history,
  localStorage,
  customElements,
  HTMLElement: FakeHTMLElement,
  HTMLButtonElement: FakeHTMLButtonElement,
  HTMLInputElement: FakeHTMLInputElement,
  HTMLTextAreaElement: FakeHTMLTextAreaElement,
  HTMLFormElement: FakeHTMLFormElement,
  Node: FakeElement,
  Event: FakeEvent,
  CustomEvent: FakeCustomEvent,
  MutationObserver: FakeMutationObserver,
  CSS: { escape: (value) => String(value) },
  location: { href: "https://marinara.test/chat/chat-1" },
  navigator: {},
  confirm: () => true,
  addEventListener: windowEvents.addEventListener.bind(windowEvents),
  removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
  dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
  setTimeout(handler) {
    const id = nextTimerId++;
    timers.set(id, handler);
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
  setInterval() {
    return nextTimerId++;
  },
  clearInterval() {},
  async fetch(url, options = {}) {
    requests.push({ url, options });
    const update = {
      messageId: "message-1",
      previousSnapshot: { nameColor: "#111111", dialogueColor: "#222222", boxColor: "#333333" },
      personaSnapshot: { personaId: "persona-1", nameColor: "#aaaaaa", dialogueColor: "#bbbbbb", boxColor: "#cccccc" },
    };
    const data = String(url).endsWith("/all")
      ? { updated: 1, skipped: 0, updates: [update] }
      : { updated: 1, skipped: 0, update };
    return { ok: true, status: 200, statusText: "OK", async json() { return data; } };
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.runInNewContext(clientSource, sandbox, { filename: "persona-reapply/client.js" });
flushTimers();

assert(customElements.get("marinara-capability-persona-reapply"), "custom element is registered");
assert(document.getElementById("persona-reapply-styles"), "styles are installed during startup");
assert(
  sandbox.__mariBridgeCapabilitySlotState?.contributions?.has("persona-reapply:reapply-colours"),
  "message action contribution is registered",
);
assert(
  sandbox.__mariBridgeSlashCommandState?.registrations?.has("persona-reapply:reapply-persona"),
  "slash command is registered",
);

const actionHost = actionBar.children.find(
  (child) => child.dataset.mariBridgeSlotHost === "persona-reapply:reapply-colours",
);
assert(actionHost, "message action host is mounted into the Marinara action bar");
const capability = actionHost.querySelector("marinara-capability-persona-reapply") || actionHost.children[0];
assert.equal(capability?.capabilityProps?.messageId, "message-1");
const button = capability?.querySelector("button");
assert(button instanceof FakeHTMLButtonElement, "message action renders a real button");
assert.equal(button.getAttribute("aria-label"), "Reapply this message's persona colours");

await capability.reapply();
flushTimers();
assert(requests.some((request) => String(request.url).endsWith("/chat/chat-1/messages/message-1")));
assert.equal(name.style.color, "#aaaaaa");
assert.equal(bubble.style.backgroundColor, "#cccccc");
assert.equal(dialogue.style.color, "#bbbbbb");

const command = sandbox.__mariBridgeSlashCommandState.registrations.get("persona-reapply:reapply-persona");
await command.handler({ context: { chatId: "chat-1" } });
flushTimers();
assert(requests.some((request) => String(request.url).endsWith("/chat/chat-1/all")));

console.log("Persona Reapply client startup and UI smoke checks passed.");

function flushTimers() {
  let iterations = 0;
  while (timers.size > 0) {
    if (iterations++ > 100) throw new Error("Client startup timer queue did not settle.");
    const pending = [...timers.entries()];
    timers.clear();
    for (const [, handler] of pending) handler();
  }
}
