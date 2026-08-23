import assert from "node:assert/strict";
import { activateWithMariBridge } from "../sdk/server.js";
import { activateClientWithMariBridge } from "../sdk/client.js";
import {
  MARI_BRIDGE_CLIENT_SYMBOL,
  MARI_BRIDGE_SERVER_SYMBOL,
  MariBridgeUnavailableError,
} from "../sdk/contracts.js";
await assert.rejects(
  activateWithMariBridge(
    { package: { id: "sdk-test" } },
    { consumerId: "sdk-test", api: { major: 1, minMinor: 0 }, require: [] },
    async () => {},
  ),
  (error) => error instanceof MariBridgeUnavailableError && error.reason === "missing",
);
await assert.rejects(
  activateClientWithMariBridge(
    { consumerId: "sdk-test", api: { major: 1, minMinor: 0 }, require: [], waitForBridgeMs: 0 },
    async () => {},
  ),
  (error) => error instanceof MariBridgeUnavailableError && error.reason === "missing",
);

let sessionClosed = 0;
globalThis[MARI_BRIDGE_SERVER_SYMBOL] = {
  registerConsumer(requirements) {
    assert.equal(requirements.consumerId, "sdk-test");
    return {
      addCleanup(cleanup) { this.cleanup = cleanup; },
      async close() {
        sessionClosed += 1;
        await this.cleanup?.();
      },
    };
  },
};
let consumerCleaned = 0;
const cleanup = await activateWithMariBridge(
  { package: { id: "sdk-test" } },
  { consumerId: "sdk-test", api: { major: 1, minMinor: 0 }, require: ["runtime.health"] },
  async () => () => { consumerCleaned += 1; },
);
await cleanup();
assert.equal(sessionClosed, 1);
assert.equal(consumerCleaned, 1);
delete globalThis[MARI_BRIDGE_SERVER_SYMBOL];
delete globalThis[MARI_BRIDGE_CLIENT_SYMBOL];
console.log("Mari Bridge SDK checks passed.");
