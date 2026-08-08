import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { claimBridgeSubsystem, getMariBridgeRuntime, warnBridgeRuntime } from "../src/runtime.js";

delete globalThis.__mariBridgeRuntime;

assert.equal(getMariBridgeRuntime().capabilities.has("ui-slots:chat-settings"), true, "chat settings bridge capability is advertised");
assert.equal(getMariBridgeRuntime().capabilities.has("capability-slots:register"), true, "generic capability slot registration is advertised");

const engineSchemaSource = await fs.readFile(
  new URL("../../../references/marinara-engine/packages/shared/src/schemas/capability-package.schema.ts", import.meta.url),
  "utf8",
);
assert.equal(
  engineSchemaSource.includes('"message-actions"') || engineSchemaSource.includes('"topbar-panel"'),
  false,
  "message/topbar bridge slots are not safe to put in package manifests yet",
);

let installCount = 0;
let cleanupCount = 0;

const initial = claimBridgeSubsystem("test-recursive-install", {
  version: "9.0.0",
  install() {
    installCount += 1;
    const nested = claimBridgeSubsystem("test-recursive-install", {
      version: "9.0.0",
      install() {
        installCount += 100;
      },
    });
    assert.equal(nested.active, false, "same-version recursive claim does not reinstall");
    return () => {
      cleanupCount += 1;
    };
  },
});

assert.equal(initial.active, true, "initial subsystem claim installs");
assert.equal(installCount, 1, "recursive claim did not re-enter install");
assert.equal(getMariBridgeRuntime().subsystems.get("test-recursive-install")?.installed, true, "subsystem is installed");
assert.equal(getMariBridgeRuntime().subsystems.get("test-recursive-install")?.installing, false, "subsystem is not stuck installing");

const older = claimBridgeSubsystem("test-recursive-install", {
  version: "8.9.9",
  install() {
    installCount += 1_000;
  },
});

assert.equal(older.active, false, "older subsystem claim is ignored");
assert.equal(installCount, 1, "older subsystem did not install");
assert.equal(
  getMariBridgeRuntime().warnings.filter((entry) => entry.message.includes("Ignoring older test-recursive-install bridge")).length,
  1,
  "older bridge warning is recorded once",
);

warnBridgeRuntime("dedupe probe");
warnBridgeRuntime("dedupe probe");
assert.equal(
  getMariBridgeRuntime().warnings.filter((entry) => entry.message === "dedupe probe").length,
  1,
  "duplicate bridge warnings are throttled",
);

const newer = claimBridgeSubsystem("test-recursive-install", {
  version: "9.0.1",
  install() {
    installCount += 1;
  },
});

assert.equal(newer.active, true, "newer subsystem claim replaces older owner");
assert.equal(cleanupCount, 1, "previous subsystem cleanup ran on replacement");
assert.equal(installCount, 2, "newer subsystem installed once");

assert.throws(
  () =>
    claimBridgeSubsystem("test-recursive-install", {
      version: "9.0.2",
      install() {
        throw new Error("boom");
      },
    }),
  /boom/u,
  "install errors surface to callers",
);

assert.equal(
  getMariBridgeRuntime().subsystems.get("test-recursive-install")?.version,
  "9.0.1",
  "failed install restores previous owner",
);

const generationLifecycleSource = await fs.readFile(new URL("../src/generation-lifecycle.js", import.meta.url), "utf8");
assert(
  generationLifecycleSource.includes("isNativeMainGenerationActive(entry.chatId)") &&
    generationLifecycleSource.includes("store.abortControllers"),
  "composer generation locks refuse to intercept native chat generation stop buttons",
);

const capabilitySlotsSource = await fs.readFile(new URL("../src/capability-slots.js", import.meta.url), "utf8");
assert(
  capabilitySlotsSource.includes("chat-settings-agent-menu-") &&
    capabilitySlotsSource.includes("data-mari-bridge-agent-settings-body") &&
    capabilitySlotsSource.includes("roleplay-agents") &&
    capabilitySlotsSource.includes("syncChatSettingsPanelWatcher") &&
    capabilitySlotsSource.includes("section.children[1]") &&
    capabilitySlotsSource.includes("[mari-bridge:slots]"),
  "chat settings slot bridge waits for the roleplay panel content before mounting package settings",
);

console.log("Mari bridge runtime checks passed.");
