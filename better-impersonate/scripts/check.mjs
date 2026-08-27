import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { buildImpersonateDraftRequest, extractContinuationSuffix } from "../src/client/request.js";
import {
  __test as recallTest,
  readRecall,
  rememberGeneratedDraft,
  rememberImpersonateRequest,
} from "../src/client/recall.js";

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
assert.equal(extractContinuationSuffix("Hello", " world"), " world");
assert.equal(extractContinuationSuffix("Hello", "Hello world"), " world");
assert.equal(extractContinuationSuffix("Hello", "Hel"), "");
assert.equal(extractContinuationSuffix("Hello", " again"), " again");

const values = new Map([[`${recallTest.LEGACY_GUIDANCE_PREFIX}chat-1`, "legacy guidance"]]);
const storage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
assert.equal(readRecall(storage, "chat-1").lastGuidance, "legacy guidance");
rememberGeneratedDraft(storage, "chat-1", "Generated persona draft");
rememberImpersonateRequest(storage, "chat-1", "new guidance");
assert.deepEqual(readRecall(storage, "chat-1"), {
  lastGuidance: "new guidance",
  lastGeneratedDraft: "Generated persona draft",
});
rememberImpersonateRequest(storage, "chat-1", "Generated persona draft");
assert.equal(readRecall(storage, "chat-1").lastGuidance, "new guidance");
rememberGeneratedDraft(storage, "chat-1", "Generated persona draft plus continuation");
assert.equal(readRecall(storage, "chat-1").lastGuidance, "new guidance");

const runtimeSource = await fs.readFile(new URL("../src/client/runtime.js", import.meta.url), "utf8");
const beginGeneration = runtimeSource.indexOf("const generation = bridgeSession.drafts.generate(");
const showStop = runtimeSource.indexOf("context.setDraftGenerating?.(true)", beginGeneration);
const awaitGeneration = runtimeSource.indexOf("const content = await generation", showStop);
assert.ok(beginGeneration >= 0 && showStop > beginGeneration && awaitGeneration > showStop);
assert.doesNotMatch(runtimeSource, /impersonate_thinking|inner_state/u);

console.log("Better Impersonate request checks passed.");
