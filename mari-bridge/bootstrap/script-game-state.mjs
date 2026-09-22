const helpersUrl = new URL("../src/server/script-game-state.js", import.meta.url).href;

// Every seam is anchored to Engine 2.4.6 compiled output and participates in
// server preflight. A drifted worker, executor, storage, or save path fails closed.
export function patchScriptGameStateModule(url, input, replace) {
  let source = input;
  const edit = (anchor, replacement, id) => {
    source = replace(source, anchor, replacement, `script.game-state.${id}`);
  };
  if (url.endsWith("/services/tools/custom-tool-script.worker.js")) {
    edit('        `JSON.stringify((function() {`,', [
      '        `JSON.stringify((function() {`,',
      '        `const effects = [];`,',
      '        `const mari = Object.freeze({ gameState: Object.freeze({ patch(patch) {`,',
      '        `  if (effects.length >= 64) throw new Error("Too many GameState patches.");`,',
      '        `  const serialized = JSON.stringify(patch);`,',
      '        `  if (!serialized || serialized.length > 262144) throw new Error("Invalid GameState patch size.");`,',
      '        `  effects.push({ type: "game_state_patch", patch: JSON.parse(serialized) });`,',
      '        `} }) });`,',
      '        `const value = (function() {`,',
    ].join("\n"), "worker-api");
    edit('        `}).call(undefined));`,', [
      '        `}).call(undefined);`,',
      '        `return { value: value === undefined ? { result: "OK" } : value, effects };`,',
      '        `}).call(undefined));`,',
    ].join("\n"), "worker-envelope");
    edit('    parentPort?.postMessage({ ok: true, value });',
      '    parentPort?.postMessage({ ok: true, value: value.value, effects: value.effects });', "worker-result");
  }
  if (url.endsWith("/services/tools/tool-executor.js")) {
    edit('resolve(message.value);', 'resolve({ value: message.value, effects: message.effects });', "executor-envelope");
    edit('const result = await executeCustomToolScript(tool.scriptBody, args, hiddenContext, customToolTimeoutMs);\n                return classifyToolExecution(result ?? { result: "OK" });', `const envelope = await executeCustomToolScript(tool.scriptBody, args, hiddenContext, customToolTimeoutMs);
                const outcome = classifyToolExecution(envelope.value ?? { result: "OK" });
                if (!outcome.success) return outcome;
                const { mergeScriptGameStateEffects } = await import(${JSON.stringify(helpersUrl)});
                const patch = mergeScriptGameStateEffects(envelope.effects);
                if (!patch) return outcome;
                if (!context?.prepareScriptGameStatePatch) throw new Error("Game-state writes are not available in this context.");
                await context.prepareScriptGameStatePatch(patch);
                return { success: true, mariBridgeScriptPatch: patch, result: {
                    result: outcome.result,
                    gameState: { applied: false, pending: true, patch,
                        note: "Queued for this turn. The change is not applied until this response is saved." },
                } };`, "executor-effects");
    edit('success: outcome.success,', 'success: outcome.success,\n                ...(outcome.mariBridgeScriptPatch ? { mariBridgeScriptPatch: outcome.mariBridgeScriptPatch } : {}),', "executor-patch-result");
  }
  if (url.endsWith("/services/storage/game-state.storage.js")) {
    edit('export function createGameStateStorage(db) {', `import { prepareScriptGameStatePatch } from ${JSON.stringify(helpersUrl)};
export function createGameStateStorage(db) {`, "storage-import");
    edit('    return {\n        async getLatest(chatId) {', `    return {
        async updateFromScript(chatId, request, locationIsAuthoritative, target) {
            return db.transaction(async (tx) => {
                const store = createGameStateStorage(tx);
                const base = target.baseSnapshot ? await store.getById(target.baseSnapshot.id, chatId) : null;
                const row = await store.getByChatAndMessage(chatId, target.messageId, target.swipeIndex);
                const current = row ?? base;
                const patch = prepareScriptGameStatePatch(request, current ? buildLockMigrationState(current) : null,
                    locationIsAuthoritative, applyTrackerFieldLocksToGameStatePatch, normalizeWorldCustomFields);
                if (target.isAborted()) throw new Error("Generation was cancelled; no change was applied.");
                const stored = await store.updateByMessage(target.messageId, target.swipeIndex, chatId, patch, undefined, {
                    baseSnapshot: base,
                    ...(target.compatibilityLocation !== undefined ? { compatibilityLocation: target.compatibilityLocation } : {}),
                });
                if (!stored) throw new Error("The game-state update could not be stored.");
                return { ...buildLockMigrationState(stored), committed: stored.committed === 1,
                    manualOverrides: parseStoredManualOverrides(stored.manualOverrides) };
            });
        },
        async getLatest(chatId) {`, "storage-write");
    edit('if (fields.presentCharacters !== undefined)\n                baseState.presentCharacters = fields.presentCharacters;',
      'if (fields.recentEvents !== undefined) baseState.recentEvents = fields.recentEvents;\n            if (fields.presentCharacters !== undefined)\n                baseState.presentCharacters = fields.presentCharacters;', "storage-events-create");
    edit('if (fields.presentCharacters !== undefined)\n                updates.presentCharacters = JSON.stringify(fields.presentCharacters);',
      'if (fields.recentEvents !== undefined) updates.recentEvents = JSON.stringify(fields.recentEvents);\n            if (fields.presentCharacters !== undefined)\n                updates.presentCharacters = JSON.stringify(fields.presentCharacters);', "storage-events-update");
  }
  if (url.endsWith("/routes/generate.routes.js")) {
    edit('const pendingGameStateToolCalls = [];', `const pendingGameStateToolCalls = [];
                    const { prepareScriptGameStatePatch, executePendingScriptGameStateCalls } = await import(${JSON.stringify(helpersUrl)});
                    const { normalizeWorldCustomFields: mariNormalizeWorldFields } = await import("@marinara-engine/shared");`, "generation-helpers");
    edit('const results = await executeToolCalls(pendingGameStateToolCalls.splice(0), {', `const results = await executePendingScriptGameStateCalls(pendingGameStateToolCalls.splice(0), executeToolCalls, {
                            isAborted: () => abortController.signal.aborted,
                            applyScriptGameStatePatch: async (request) => {
                                const snapshot = await gameStateStore.updateFromScript(input.chatId, request,
                                    ownerSpatialProjection?.ownerMode === "game", {
                                        messageId, swipeIndex, baseSnapshot: toolBaseSnapshot,
                                        isAborted: () => abortController.signal.aborted,
                                        ...(ownerSpatialProjection?.ownerMode === "game"
                                            ? { compatibilityLocation: toolBaseSnapshot?.location ?? null } : {}),
                                    });
                                sendSseEvent(reply, { type: "game_state_patch", data: { ...snapshot, __mariBridgeScriptState: true } });
                            },`, "generation-commit");
    edit('const executedToolResults = await executeToolCalls(permittedToolCalls, {', `const executedToolResults = await executeToolCalls(permittedToolCalls, {
                                prepareScriptGameStatePatch: async (patch) => {
                                    if (input.impersonate || !["roleplay", "game"].includes(chatMode)) {
                                        throw new Error("Script GameState writes require a saved Roleplay or Game response.");
                                    }
                                    if (abortController.signal.aborted) throw new Error("Generation was cancelled.");
                                    return prepareScriptGameStatePatch(patch, gameState, ownerSpatialProjection?.ownerMode === "game",
                                        applyTrackerFieldLocksToGameStatePatch, mariNormalizeWorldFields);
                                },`, "generation-prepare");
    edit('if (tr.name === "update_game_state" && tr.success) {', `if (tr.mariBridgeScriptPatch && tr.success) {
                                    pendingGameStateToolCalls.push({ name: tr.name, mariBridgeScriptPatch: tr.mariBridgeScriptPatch });
                                }
                                if (tr.name === "update_game_state" && tr.success) {`, "generation-queue");
  }
  return source;
}
