import fs from "node:fs/promises";

const runtimeSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
assert(runtimeSource.includes("watchActiveChatId"), "client watches active chat changes");
assert(runtimeSource.includes("activeAgentIds"), "client checks chat active agent ids");
assert(runtimeSource.includes("enableAgents"), "client requires agents to be enabled");
assert(runtimeSource.includes("WORLD_MAPS_AGENT_ID"), "client keeps World Maps dependency explicit");
assert(runtimeSource.includes("/spatial-context"), "client reads World Maps spatial context");
assert(runtimeSource.includes("useReferenceImage"), "client respects location reference-image opt-in");
assert(runtimeSource.includes("/global-gallery"), "client resolves global gallery references");
assert(runtimeSource.includes("global-gallery:"), "client uses current World Maps global reference prefix");
assert(runtimeSource.includes("/metadata"), "client persists chat background metadata");
assert(runtimeSource.includes("x-marinara-csrf"), "client sends CSRF header for metadata writes");
assert(runtimeSource.includes("wmb-live-background"), "client installs live Roleplay background overlay");
assert(!runtimeSource.includes('type="checkbox"'), "client does not expose a toggle UI");

const buildSource = await fs.readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
assert(buildSource.includes('slots: ["chat-runtime"]'), "manifest declares chat-runtime contribution");
assert(buildSource.includes("runtimeDisabled: true"), "feature marker is runtime-disabled");
assert(buildSource.includes('modeAllowlist: ["roleplay"]'), "agent is Roleplay-only");
assert(buildSource.includes('"chat-write"'), "manifest declares chat-write permission");
assert(buildSource.includes("restartRequired: false"), "client-only package installs without restart gating");

function assert(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`);
}

console.log("World Map Background checks passed.");
