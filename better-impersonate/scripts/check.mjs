import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildImpersonateDraftRequest } from "../src/client/request.js";

assert.deepEqual(buildImpersonateDraftRequest("impersonate", "answer cautiously"), {
  impersonate: true,
  generationGuide: "answer cautiously",
  generationGuideSource: "guide",
});
assert.deepEqual(buildImpersonateDraftRequest("impersonate", ""), {
  impersonate: true,
});
assert.deepEqual(buildImpersonateDraftRequest("continue", "Existing draft"), {
  impersonate: true,
  impersonateContinuation: "Existing draft",
});
assert.deepEqual(buildImpersonateDraftRequest("inner_state", "I do not trust them"), {
  impersonate: true,
  generationGuide:
    "Private inner state for {{user}}: I do not trust them\nUse this as quiet emotional context, not dialogue or a required outcome.",
  generationGuideSource: "guide",
});

const runtimeSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
const beginGeneration = runtimeSource.indexOf("const generation = bridgeSession.drafts.generate(");
const showStop = runtimeSource.indexOf("context.setDraftGenerating?.(true)", beginGeneration);
const awaitGeneration = runtimeSource.indexOf("const content = await generation", showStop);
assert.ok(beginGeneration >= 0 && showStop > beginGeneration && awaitGeneration > showStop);

console.log("Better Impersonate request checks passed.");
