import { buildRequest, extractContinuationSuffix, appendContinuation } from "./request.js";
import { createInlineThinkingStreamFilter } from "./thinking-tags.js";
import { readRecall, rememberGeneratedDraft, rememberImpersonateRequest } from "./recall.js";
import { readSettings, api, preflight, consumeDryRun } from "./transport.js";

export function createController(host, storage = localStorage) {
  let active = null;
  const notify = () => host.changed?.();
  function cancel() {
    const run = active;
    if (!run) return;
    active = null;
    run.controller.abort();
    if (run.serverId) void api("/generate/dryRun/abort", {
      body: { chatId: run.chatId, runId: run.serverId },
    }).catch(() => {});
    run.release?.();
    notify();
  }
  async function start(mode) {
    if (active) throw new Error("An impersonation is already running.");
    const context = host.context();
    if (!context || context.busy) throw new Error("Select an idle chat composer first.");
    const original = context.read();
    const settings = readSettings(storage);
    const run = { ...context, controller: new AbortController(), original, last: original };
    active = run;
    notify();
    const current = () => active === run && !run.controller.signal.aborted && context.valid();
    try {
      const tags = await preflight(context.chatId, settings, run.controller.signal);
      if (!current() || context.read() !== original || context.isBusy()) return;
      // All native dependencies resolved before changing the composer or saved guidance.
      run.release = context.lock(cancel);
      if (mode === "impersonate") rememberImpersonateRequest(storage, context.chatId, original);
      let filter = createInlineThinkingStreamFilter(tags);
      let visible = "";
      const render = () => {
        if (!current()) { cancel(); return; }
        if (context.read() !== run.last) { cancel(); return; }
        const output = mode === "continue"
          ? appendContinuation(original, extractContinuationSuffix(original, visible))
          : visible;
        if (!output) return; // Preserve guidance when output is reasoning-only or empty.
        context.write(output);
        run.last = output;
      };
      const response = await api("/generate/dryRun", {
        body: buildRequest(context.chatId, mode, original, settings),
        signal: run.controller.signal, raw: true,
      });
      await consumeDryRun(response, event => {
        if (event.type === "dryrun_started") {
          run.serverId = event.data?.runId;
          if (!current() && run.serverId) void api("/generate/dryRun/abort", {
            body: { chatId: run.chatId, runId: run.serverId },
          }).catch(() => {});
        }
        if (!current()) return;
        if (event.type === "token") {
          visible += filter.push(String(event.data ?? "")).visible;
          render();
        } else if (event.type === "result") {
          // Final content replaces the stream, never appends a second copy.
          filter = createInlineThinkingStreamFilter(tags);
          visible = filter.push(String(event.data?.content ?? "")).visible + filter.flush().visible;
          render();
        } else if (event.type === "aborted") cancel();
      });
      if (current()) {
        visible += filter.flush().visible;
        render();
        if (run.last !== original) rememberGeneratedDraft(storage, context.chatId, run.last);
      }
    } catch (error) {
      if (!run.controller.signal.aborted) throw error;
    } finally {
      if (active === run) {
        active = null;
        run.release?.();
        notify();
      }
    }
  }
  return {
    start, cancel,
    get active() { return active; },
    restore() {
      if (active) throw new Error("Stop impersonation before restoring guidance.");
      const context = host.context();
      if (!context || context.busy) throw new Error("Select an idle chat composer first.");
      const guidance = readRecall(storage, context.chatId).lastGuidance;
      if (!guidance) throw new Error("No previous guidance saved for this chat.");
      context.write(guidance);
    },
  };
}
