import assert from "node:assert/strict";

import { claimBridgeSubsystem, getMariBridgeRuntime } from "../src/runtime.js";

delete globalThis.__mariBridgeRuntime;

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

console.log("Mari bridge runtime checks passed.");
