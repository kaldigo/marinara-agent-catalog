const cleanupSmokeClient = await activateClientWithMariBridge(
  {
    consumerId: "mari-bridge-smoke",
    api: { major: 1, minMinor: 0 },
    require: ["chat.active", "client.bridge-first", "consumer.sessions", "generation.lifecycle", "runtime.health"],
  },
  async (session) => {
    globalThis.__MARI_BRIDGE_SMOKE_CLIENT__ = Object.freeze({ active: true, signal: session.signal });
    document.documentElement.dataset.mariBridgeSmoke = "ready";
    return () => {
      delete globalThis.__MARI_BRIDGE_SMOKE_CLIENT__;
      delete document.documentElement.dataset.mariBridgeSmoke;
    };
  },
);

if (!customElements.get("marinara-capability-mari-bridge-smoke")) {
  customElements.define(
    "marinara-capability-mari-bridge-smoke",
    class MariBridgeSmokeElement extends HTMLElement {
      connectedCallback() {
        this.hidden = true;
        this.dataset.mariBridgeSmoke = "ready";
      }
    },
  );
}
