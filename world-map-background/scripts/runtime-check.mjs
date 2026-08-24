import assert from "node:assert/strict";

import { activateClientWithMariBridge } from "../../_mari-bridge/sdk/client.js";
import { MARI_BRIDGE_CLIENT_SYMBOL } from "../../_mari-bridge/sdk/contracts.js";

const previous = new Map();
for (const key of ["activateClientWithMariBridge", "customElements", "document", "fetch", "HTMLElement", "HTMLInputElement", "window"]) {
  previous.set(key, globalThis[key]);
}
const previousBridge = globalThis[MARI_BRIDGE_CLIENT_SYMBOL];

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.isConnected = true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  replaceChildren() {}
}
class FakeInput extends FakeElement {
  matches() { return false; }
}

const elementRegistry = new Map();
const documentAttributes = new Map();
const windowTarget = new EventTarget();
const backgroundCalls = [];
const metadataPatches = [];
const cleanups = [];
let generationListener = null;
let spatialListener = null;
let currentLocationId = "location-a";
let chat = {
  id: "chat-1",
  mode: "roleplay",
  metadata: {
    enableAgents: true,
    activeAgentIds: ["hierarchical-maps", "world-map-background"],
    background: null,
  },
};

globalThis.HTMLElement = FakeElement;
globalThis.HTMLInputElement = FakeInput;
globalThis.activateClientWithMariBridge = activateClientWithMariBridge;
globalThis.customElements = {
  get(name) { return elementRegistry.get(name); },
  define(name, constructor) { elementRegistry.set(name, constructor); },
};
globalThis.document = {
  documentElement: {
    setAttribute(name, value) { documentAttributes.set(name, String(value)); },
    removeAttribute(name) { documentAttributes.delete(name); },
  },
};
globalThis.window = windowTarget;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  if (path === "/api/chats/chat-1") return json(chat);
  if (path === "/api/chats/chat-1/spatial-context") {
    return json(spatialResponse(currentLocationId));
  }
  if (path === "/api/gallery/chat-1") {
    return json([
      { id: "image-a", url: "/api/gallery/chat-1/image-a" },
      { id: "image-b", url: "/api/gallery/chat-1/image-b" },
    ]);
  }
  if (path === "/api/global-gallery") return json([]);
  if (path === "/api/chats/chat-1/metadata" && options.method === "PATCH") {
    const patch = JSON.parse(String(options.body ?? "{}"));
    metadataPatches.push(patch);
    chat = { ...chat, metadata: { ...chat.metadata, ...patch } };
    return json(chat.metadata);
  }
  return json({ error: `Unexpected request: ${path}` }, 404);
};

const session = {
  addCleanup(cleanup) { cleanups.push(cleanup); },
  close: async () => {},
  ui: { register: () => () => {} },
  generation: {
    subscribe(listener) {
      generationListener = listener;
      return () => { generationListener = null; };
    },
  },
  chat: {
    active: {
      getSnapshot: () => ({ chatId: "chat-1" }),
      subscribe(listener) {
        listener({ chatId: "chat-1" });
        return () => {};
      },
    },
    background: {
      set(input) {
        backgroundCalls.push({ ...input });
        return true;
      },
    },
    spatial: {
      getSnapshot: () => null,
      subscribe(listener) {
        spatialListener = listener;
        return () => { spatialListener = null; };
      },
    },
  },
};
globalThis[MARI_BRIDGE_CLIENT_SYMBOL] = {
  status: "ready",
  registerConsumer: () => session,
};

try {
  await import(`../src/client/runtime.js?runtime-check=${Date.now()}`);
  await waitFor(() => backgroundCalls.at(-1)?.url === "/api/gallery/chat-1/image-a");
  assert.equal(chat.metadata.background, "/api/gallery/chat-1/image-a");
  assert.equal(chat.metadata.worldMapBackground.currentUrl, "/api/gallery/chat-1/image-a");
  assert.equal(documentAttributes.get("data-mari-bridge-consumer-world-map-background"), "ready");

  spatialListener({ chatId: "chat-1", data: spatialResponse("location-b") }, { source: "query-cache:updated" });
  await waitFor(() => backgroundCalls.at(-1)?.url === "/api/gallery/chat-1/image-b");
  assert.equal(chat.metadata.background, "/api/gallery/chat-1/image-b");
  assert.equal(chat.metadata.worldMapBackground.currentUrl, "/api/gallery/chat-1/image-b");

  currentLocationId = "location-a";
  generationListener(
    { mainActive: true },
    { source: "marinara:generation-controller", detail: { chatId: "chat-1", active: true } },
  );
  await waitFor(() => backgroundCalls.at(-1)?.url === "/api/gallery/chat-1/image-a");
  assert.equal(chat.metadata.background, "/api/gallery/chat-1/image-a");

  currentLocationId = "location-b";
  windowTarget.dispatchEvent(new CustomEvent("marinara-capability-server-event", {
    detail: {
      packageId: "hierarchical-maps",
      type: "spatial_transition_committed",
      chatId: "chat-1",
    },
  }));
  await waitFor(() => backgroundCalls.at(-1)?.url === "/api/gallery/chat-1/image-b");
  assert.equal(chat.metadata.background, "/api/gallery/chat-1/image-b");
  assert.equal(chat.metadata.worldMapBackground.currentUrl, "/api/gallery/chat-1/image-b");
  assert.ok(metadataPatches.some((patch) => patch.background === "/api/gallery/chat-1/image-b"));

  currentLocationId = "location-a";
  windowTarget.dispatchEvent(new CustomEvent("marinara-capability-server-event", {
    detail: {
      packageId: "hierarchical-maps",
      type: "spatial_context_refresh",
      chatId: "chat-1",
    },
  }));
  await waitFor(() => backgroundCalls.at(-1)?.url === "/api/gallery/chat-1/image-a");
  assert.equal(chat.metadata.background, "/api/gallery/chat-1/image-a");
  console.log("World Map Background lifecycle runtime checks passed.");
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
  if (previousBridge === undefined) delete globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
  else globalThis[MARI_BRIDGE_CLIENT_SYMBOL] = previousBridge;
  for (const [key, value] of previous) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function spatialResponse(locationId) {
  return {
    currentLocationId: locationId,
    definition: {
      enabled: true,
      locations: [
        { id: "location-a", useReferenceImage: true, referenceImageId: "image-a" },
        { id: "location-b", useReferenceImage: true, referenceImageId: "image-b" },
      ],
    },
  };
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for World Map Background synchronization");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
