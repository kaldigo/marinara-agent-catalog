import assert from "node:assert/strict";
import { activateWithMariBridge } from "../sdk/server.js";
import { activateClientWithMariBridge } from "../sdk/client.js";
import {
  MARI_BRIDGE_CLIENT_SYMBOL,
  MARI_BRIDGE_SERVER_SYMBOL,
  MariBridgeUnavailableError,
} from "../sdk/contracts.js";
import {
  MARI_BRIDGE_SETTINGS_STYLE_ID,
  escapeMariBridgeSettingsHtml,
  renderMariBridgeNativeSettingsHtml,
} from "../sdk/settings.js";

assert.equal(MARI_BRIDGE_SETTINGS_STYLE_ID, "mari-bridge-sdk-settings-style");
assert.equal(escapeMariBridgeSettingsHtml('<tag a="b">&'), "&lt;tag a=&quot;b&quot;&gt;&amp;");
const nativeSettingsHtml = renderMariBridgeNativeSettingsHtml({
  surface: "detail",
  title: "SDK Test",
  iconText: "ST",
  sections: [
    {
      title: "Fields",
      fields: [
        { type: "textarea", settingAttribute: "data-test-setting", name: "prompt", value: "<unsafe>" },
        { type: "chips", optionAttribute: "data-test-option", options: [{ value: "a", label: "Alice", selected: true }] },
      ],
    },
  ],
  actions: [{ id: "save", label: "Save", variant: "primary" }],
});
assert(nativeSettingsHtml.includes("mari-editor-shell") || nativeSettingsHtml.includes("mari-editor-header"));
assert(nativeSettingsHtml.includes("mari-native-settings-card"));
assert(nativeSettingsHtml.includes('data-test-setting="prompt"'));
assert(nativeSettingsHtml.includes("&lt;unsafe&gt;"));
assert(nativeSettingsHtml.includes('data-test-option="a"'));

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

let clientSessionClosed = 0;
const delayedClientActivation = activateClientWithMariBridge(
  { consumerId: "sdk-test", api: { major: 1, minMinor: 0 }, require: [], waitForBridgeMs: 250 },
  async () => () => {},
);
setTimeout(() => {
  globalThis[MARI_BRIDGE_CLIENT_SYMBOL] = {
    status: "ready",
    registerConsumer() {
      return {
        addCleanup(cleanup) { this.cleanup = cleanup; },
        async close() {
          clientSessionClosed += 1;
          await this.cleanup?.();
        },
      };
    },
  };
}, 25);
const delayedClientCleanup = await delayedClientActivation;
await delayedClientCleanup();
assert.equal(clientSessionClosed, 1);
delete globalThis[MARI_BRIDGE_CLIENT_SYMBOL];

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
