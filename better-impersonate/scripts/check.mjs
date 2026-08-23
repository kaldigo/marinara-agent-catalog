import assert from "node:assert/strict";

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

console.log("Better Impersonate request checks passed.");
