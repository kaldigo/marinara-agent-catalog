import fs from "node:fs/promises";

const runtimeSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
assert(runtimeSource.includes("bridgeSession.chat.active.subscribe"), "client subscribes to bridge active-chat state");
assert(!runtimeSource.includes("watchActiveChatId"), "client does not use the legacy active-chat watcher");
assert(runtimeSource.includes("activeAgentIds"), "client checks chat active agent ids");
assert(runtimeSource.includes("enableAgents"), "client requires agents to be enabled");
assert(runtimeSource.includes("WORLD_MAPS_AGENT_ID"), "client keeps World Maps dependency explicit");
assert(runtimeSource.includes("/spatial-context"), "client reads World Maps spatial context");
assert(runtimeSource.includes("useReferenceImage"), "client respects location reference-image opt-in");
assert(runtimeSource.includes("/global-gallery"), "client resolves global gallery references");
assert(runtimeSource.includes("global-gallery:"), "client uses current World Maps global reference prefix");
assert(runtimeSource.includes("/metadata"), "client persists chat background metadata");
assert(runtimeSource.includes("x-marinara-csrf"), "client sends CSRF header for metadata writes");
assert(runtimeSource.includes("marinara-capability-server-event"), "client listens for World Maps response reconciliation");
assert(runtimeSource.includes("spatial_transition_committed"), "client reacts to committed spatial transitions");
assert(runtimeSource.includes("spatial_context_refresh"), "client reacts to missed-transition reconciliation");
assert(runtimeSource.includes("state.syncRequested = true"), "urgent response sync survives an in-flight poll");
assert(runtimeSource.includes("state.syncDueAt <= dueAt"), "routine polling cannot replace an earlier response sync");
assert(runtimeSource.includes("...options,\n        headers,"), "computed JSON headers are not replaced by request options");
assert(runtimeSource.includes("API_TIMEOUT_MS"), "stalled API requests cannot stop synchronization permanently");
assert(runtimeSource.includes("image.naturalWidth > 0"), "client verifies the background image loaded before persisting it");
assert(runtimeSource.includes('image.addEventListener("error"'), "failed background images are detected");
assert(runtimeSource.includes("image.remove();\n        scheduleSync(1000)"), "failed background images are removed and retried");
assert(runtimeSource.includes("findRoleplayRoot"), "client retains a fallback for the stable Roleplay root contract");
assert(runtimeSource.includes("wmb-live-background"), "client installs live Roleplay background overlay");
assert(!runtimeSource.includes('data-wmb-setting="enabled"'), "client relies on native agent activation instead of duplicating an enable toggle");

const buildSource = await fs.readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
assert(buildSource.includes('slots: ["chat-runtime", "chat-settings"]'), "manifest declares runtime and chat-settings contributions");
assert(runtimeSource.includes('slot: "chat.settings"'), "client contributes native chat settings");
assert(runtimeSource.includes("data-wmb-setting"), "client exposes background display controls");
assert(buildSource.includes("runtimeDisabled: true"), "feature marker is runtime-disabled");
assert(buildSource.includes('modeAllowlist: ["roleplay"]'), "agent is Roleplay-only");
assert(buildSource.includes('"chat-write"'), "manifest declares chat-write permission");
assert(buildSource.includes("restartRequired: false"), "client-only package installs without restart gating");

function assert(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

console.log("World Map Background checks passed.");
