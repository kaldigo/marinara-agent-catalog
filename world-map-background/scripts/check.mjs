import fs from "node:fs/promises";

const runtimeSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
assert(runtimeSource.includes("bridgeSession.chat.active.subscribe"), "client follows the native active-chat event");
assert(runtimeSource.includes('"chat.background"'), "client requires the native live-background service");
assert(runtimeSource.includes("bridgeSession.chat.background.set"), "client updates Marinara's native background store after persistence");
assert(runtimeSource.includes("bridgeSession.generation.subscribe"), "client refreshes after the native generation lifecycle settles");
assert(runtimeSource.includes("marinara-capability-server-event"), "client listens for committed World Maps changes");
assert(runtimeSource.includes("spatial_transition_committed"), "client reacts to committed spatial transitions");
assert(runtimeSource.includes("spatial_context_refresh"), "client reacts to reconciled spatial context");
assert(runtimeSource.includes("existing.pending = true"), "location events arriving during synchronization receive a trailing reconciliation");
assert(runtimeSource.includes("/spatial-context"), "client reads the native World Maps spatial context");
assert(runtimeSource.includes("/global-gallery"), "client resolves native World Maps gallery references");
assert(runtimeSource.includes("useReferenceImage"), "client respects the location reference-image flag");
assert(runtimeSource.includes("worldMapBackground"), "package ownership is recorded in chat metadata");
assert(runtimeSource.includes("previousBackground"), "the prior native background is restored when disabled");
assert(runtimeSource.includes('slot: "agent.settings"'), "blur control is inserted inside the native agent card");
assert(runtimeSource.includes("data-wmb-blur"), "only the package-specific blur control is contributed");
assert(!runtimeSource.includes("setInterval"), "client does not poll");
assert(!runtimeSource.includes("MutationObserver"), "client does not observe the DOM");
assert(!runtimeSource.includes("querySelector"), "client does not locate or replace the Roleplay surface");
assert(!runtimeSource.includes("new Image"), "client leaves image rendering and loading to Marinara");
assert(!runtimeSource.includes("wmb-live-background"), "client does not install a competing background overlay");

const buildSource = await fs.readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
assert(buildSource.includes('slots: ["chat-runtime"]'), "manifest declares only its runtime contribution");
assert(buildSource.includes("runtimeDisabled: true"), "feature marker is not executed as a model agent");
assert(buildSource.includes('modeAllowlist: ["roleplay"]'), "feature remains Roleplay-only");
assert(buildSource.includes('permissions: ["chat-read", "chat-write", "ui"]'), "permissions match metadata synchronization and inline UI");

function assert(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

console.log("World Map Background native integration checks passed.");
