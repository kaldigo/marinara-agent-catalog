import assert from "node:assert/strict";
import { activate } from "../src/server/index.js";
import { MariBridgeUnavailableError } from "../../_mari-bridge/sdk/contracts.js";

await assert.rejects(
  activate({
    package: { id: "mari-bridge-smoke" },
    api: { registerPrivilegedRoutes() { throw new Error("Feature code ran without Mari Bridge"); } },
  }),
  (error) => error instanceof MariBridgeUnavailableError && error.reason === "missing",
);
console.log("Mari Bridge smoke fail-closed check passed.");
