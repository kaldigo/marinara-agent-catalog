(() => {
"use strict";
// thinking-tags.js
// Upstream Marinara Engine c56501495, AGPL-3.0. See THIRD-PARTY.md.
// ──────────────────────────────────────────────
// Inline Thinking Tags
// ──────────────────────────────────────────────


















const BUILT_IN_THINKING_TAG_PAIRS                    = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<think>", close: "</think>" },
  { open: "<thought>", close: "</thought>" },
  { open: "<|think|>", close: "<|/think|>" },
  { open: "<|channel>thought", close: "<channel|>" },
  { open: "[thinking]", close: "[/thinking]" },
  { open: "[think]", close: "[/think]" },
  { open: "[thought]", close: "[/thought]" },
];

const MAX_CUSTOM_THINKING_TAGS = 20;
const MAX_THINKING_TAG_LENGTH = 120;

function normalizeThinkingTagPairs(value         )                    {
  if (!Array.isArray(value)) return [];

  const out                    = [];
  const seen = new Set        ();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item                                       ;
    const open = typeof raw.open === "string" ? raw.open.trim() : "";
    const close = typeof raw.close === "string" ? raw.close.trim() : "";
    if (!open || !close) continue;
    if (open.length > MAX_THINKING_TAG_LENGTH || close.length > MAX_THINKING_TAG_LENGTH) continue;
    const key = `${open.toLocaleLowerCase()}\u0000${close.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ open, close });
    if (out.length >= MAX_CUSTOM_THINKING_TAGS) break;
  }
  return out;
}

function toInternalThinkingTagPairs(customTags          )                            {
  const pairs = [...BUILT_IN_THINKING_TAG_PAIRS, ...normalizeThinkingTagPairs(customTags)];
  const seen = new Set        ();
  return pairs
    .map((pair) => ({
      ...pair,
      openLower: pair.open.toLocaleLowerCase(),
      closeLower: pair.close.toLocaleLowerCase(),
      boundaryAfterOpen: pair.open.toLocaleLowerCase() === "<|channel>thought",
    }))
    .filter((pair) => {
      const key = `${pair.openLower}\u0000${pair.closeLower}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.open.length - a.open.length);
}

function countLeadingWhitespace(value        )         {
  let index = 0;
  while (index < value.length && /\s/.test(value[index] )) index++;
  return index;
}

function hasOpeningBoundary(value        , endIndex        )          {
  const next = value[endIndex];
  return !next || !/[A-Za-z0-9_]/.test(next);
}

function findLeadingOpening(value        , pairs                           ) {
  const start = countLeadingWhitespace(value);
  const lower = value.toLocaleLowerCase();
  for (const pair of pairs) {
    if (!lower.startsWith(pair.openLower, start)) continue;
    const end = start + pair.open.length;
    if (pair.boundaryAfterOpen && !hasOpeningBoundary(value, end)) continue;
    return { pair, start, end };
  }
  return null;
}

function isPotentialLeadingOpening(value        , pairs                           )          {
  const start = countLeadingWhitespace(value);
  if (start >= value.length) return true;
  const lower = value.slice(start).toLocaleLowerCase();
  return pairs.some((pair) => pair.openLower.startsWith(lower));
}

function indexOfInsensitive(value        , needleLower        , fromIndex = 0)         {
  return value.toLocaleLowerCase().indexOf(needleLower, fromIndex);
}

/**
 * Extract leading inline reasoning blocks that some models emit instead of
 * returning provider-native thinking channels.
 */
function extractLeadingThinkingBlocks(text        , customTags          )                            {
  let remaining = text;
  let stripped = false;
  const chunks           = [];
  const pairs = toInternalThinkingTagPairs(customTags);

  while (true) {
    const opening = findLeadingOpening(remaining, pairs);
    if (!opening) break;

    const closeIndex = indexOfInsensitive(remaining, opening.pair.closeLower, opening.end);
    if (closeIndex < 0) break;

    stripped = true;
    const thinking = remaining.slice(opening.end, closeIndex).trim();
    if (thinking) chunks.push(thinking);
    remaining = remaining.slice(closeIndex + opening.pair.close.length).trimStart();
  }

  return {
    content: remaining,
    thinking: chunks.join("\n\n"),
    stripped,
  };
}












function createInlineThinkingStreamFilter(customTags          )                             {
  const pairs = toInternalThinkingTagPairs(customTags);
  const maxDetectBuffer = Math.max(32, ...pairs.map((pair) => pair.open.length + 64));
  let state                               = "detect";
  let buffer = "";
  let activePair                                 = null;

  const drain = ()                                   => {
    let visible = "";
    let thinking = "";

    while (true) {
      if (state === "done") {
        visible += buffer;
        buffer = "";
        break;
      }

      if (state === "detect") {
        const opening = findLeadingOpening(buffer, pairs);
        if (opening) {
          activePair = opening.pair;
          buffer = buffer.slice(opening.end);
          state = "inside";
          continue;
        }
        if (buffer.length <= maxDetectBuffer && isPotentialLeadingOpening(buffer, pairs)) break;
        state = "done";
        continue;
      }

      if (!activePair) {
        state = "done";
        continue;
      }

      const closeIndex = indexOfInsensitive(buffer, activePair.closeLower);
      if (closeIndex >= 0) {
        thinking += buffer.slice(0, closeIndex);
        buffer = buffer.slice(closeIndex + activePair.close.length).trimStart();
        activePair = null;
        state = "detect";
        continue;
      }

      const holdback = Math.max(0, activePair.close.length - 1);
      const emitLength = Math.max(0, buffer.length - holdback);
      if (emitLength > 0) {
        thinking += buffer.slice(0, emitLength);
        buffer = buffer.slice(emitLength);
      }
      break;
    }

    return { visible, thinking };
  };

  return {
    push(chunk        ) {
      if (!chunk) return { visible: "", thinking: "" };
      buffer += chunk;
      return drain();
    },
    flush() {
      if (state === "detect") {
        state = "done";
      }
      return drain();
    },
    reset() {
      state = "detect";
      buffer = "";
      activePair = null;
    },
  };
}

// recall.js
const RECALL_PREFIX = "mari-better-impersonate:recall:";

function emptyRecall() {
  return { lastGuidance: "", lastGeneratedDraft: "" };
}

function readRecall(storage, chatId) {
  const id = String(chatId ?? "").trim();
  if (!storage || !id) return emptyRecall();
  try {
    const raw = storage.getItem(`${RECALL_PREFIX}${id}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        lastGuidance: typeof parsed?.lastGuidance === "string" ? parsed.lastGuidance : "",
        lastGeneratedDraft: typeof parsed?.lastGeneratedDraft === "string" ? parsed.lastGeneratedDraft : "",
      };
    }
    return emptyRecall();
  } catch {
    return emptyRecall();
  }
}

function writeRecall(storage, chatId, recall) {
  const id = String(chatId ?? "").trim();
  if (!storage || !id) return;
  try {
    storage.setItem(`${RECALL_PREFIX}${id}`, JSON.stringify({
      version: 1,
      lastGuidance: recall.lastGuidance,
      lastGeneratedDraft: recall.lastGeneratedDraft,
    }));
  } catch {
    // Recall is optional and must never block draft generation.
  }
}

function rememberImpersonateRequest(storage, chatId, input) {
  const guidance = String(input ?? "");
  const recall = readRecall(storage, chatId);
  if (!guidance || guidance === recall.lastGeneratedDraft) return recall;
  const next = { ...recall, lastGuidance: guidance };
  writeRecall(storage, chatId, next);
  return next;
}

function rememberGeneratedDraft(storage, chatId, output) {
  const recall = readRecall(storage, chatId);
  const next = { ...recall, lastGeneratedDraft: String(output ?? "") };
  writeRecall(storage, chatId, next);
  return next;
}

const __test = Object.freeze({ RECALL_PREFIX });

// request.js
function buildRequest(chatId, mode, input, settings = {}) {
  if (!["impersonate", "continue"].includes(mode)) throw new Error("Unknown impersonation action.");
  const direction = mode === "continue" && input.trim()
    ? ["Continue my current in-character draft below. Return only new continuation text.",
       "Do not repeat or restart the draft. Do not explain.", "", input].join("\n")
    : input;
  const body = { chatId, impersonate: true, streaming: true, userMessage: direction || null };
  for (const key of ["impersonatePromptTemplate", "impersonatePresetId", "impersonateConnectionId"]) {
    if (typeof settings[key] === "string" && settings[key].trim()) body[key] = settings[key];
  }
  body.impersonateBlockAgents = settings.impersonateBlockAgents === true;
  return body;
}

function extractContinuationSuffix(original, generated) {
  if (!original || !generated) return generated;
  if (generated.startsWith(original)) return generated.slice(original.length);
  // During streaming, withhold an incomplete echo until it can be distinguished.
  if (original.startsWith(generated)) return "";
  const left = original.trim();
  const right = generated.trimStart();
  if (left && right.startsWith(left)) return right.slice(left.length);
  if (left && left.startsWith(right)) return "";
  return generated;
}

function appendContinuation(original, suffix) {
  if (!suffix) return original;
  const separator = original && !/[\s"'([{]$/.test(original) && !/^[\s.,!?;:)"'\]}]/.test(suffix) ? " " : "";
  return original + separator + suffix;
}

// transport.js
function readSettings(storage) {
  const stored = JSON.parse(storage.getItem("marinara-engine-ui") || "{}");
  return stored.state ?? stored;
}

async function api(path, { body, signal, raw = false } = {}) {
  const headers = { "x-marinara-csrf": "1" };
  const secret = localStorage.getItem("marinara_admin_secret")?.trim();
  if (secret) headers["X-Admin-Secret"] = secret;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(typeof detail.error === "string" ? detail.error : "Marinara request failed (" + response.status + ").");
    error.status = response.status;
    throw error;
  }
  return raw ? response : response.json();
}

// Only resolve output-filter configuration here. Native dryRun owns model selection.
async function preflight(chatId, settings, signal) {
  const [installed, chat] = await Promise.all([
    api("/capability-packages/installed", { signal }),
    api("/chats/" + encodeURIComponent(chatId), { signal }),
  ]);
  if (!installed.some(item => item.id === "better-impersonate" && item.status === "active")) {
    throw new Error("Better Impersonate is no longer installed and active. Reload Marinara.");
  }
  if (chat.mode === "game") throw new Error("Better Impersonate supports the chat composer, not Game Mode.");
  let connectionId = settings.impersonateConnectionId || chat.connectionId;
  let connection = null;
  if (connectionId && connectionId !== "random" && connectionId !== "local-sidecar") {
    try { connection = await api("/connections/" + encodeURIComponent(connectionId), { signal }); }
    catch (error) {
      if (signal.aborted || error.status !== 404 || !settings.impersonateConnectionId || !chat.connectionId) throw error;
      connectionId = chat.connectionId;
      if (connectionId !== "random" && connectionId !== "local-sidecar") {
        connection = await api("/connections/" + encodeURIComponent(connectionId), { signal });
      }
    }
  }
  const candidates = [settings.impersonatePresetId,
    ...(chat.mode === "roleplay" ? [connectionId === "random" ? "__random_connection_preset__" : connection?.promptPresetId] : []), chat.promptPresetId].filter(Boolean);
  for (const id of new Set(candidates)) {
    // dryRun does not report its randomly selected connection/preset. Require an
    // explicit native preset so we can filter reasoning correctly before writing.
    if (id === "__random_connection_preset__") {
      throw new Error("Select an impersonation preset in Marinara before using a random connection, so reasoning tags can be filtered correctly.");
    }
    let preset;
    try { preset = await api("/prompts/" + encodeURIComponent(id), { signal }); }
    catch (error) { if (error.status === 404) continue; throw error; }
    const parameters = typeof preset.parameters === "string" ? JSON.parse(preset.parameters || "{}") : preset.parameters;
    return parameters?.customThinkingTags ?? [];
  }
  return [];
}

async function consumeDryRun(response, onEvent) {
  if (!response.body) throw new Error("Dry run returned no stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let complete = false;
  function deliver(block) {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const event = JSON.parse(data);
    if (event.type === "error") throw new Error(typeof event.data === "string" ? event.data : "Dry run failed.");
    onEvent(event);
    if (event.type === "done" || event.type === "aborted") complete = true;
  }
  try {
    while (!complete) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let match;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const block = pending.slice(0, match.index);
        pending = pending.slice(match.index + match[0].length);
        deliver(block);
      }
      if (done) {
        if (pending.trim()) deliver(pending);
        if (!complete) throw new Error("Dry-run stream disconnected before completion.");
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// controller.js

function createController(host, storage = localStorage) {
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

// runtime.js

const OWNER = Symbol.for("marinara.better-impersonate.runtime");
const TAG = "marinara-capability-better-impersonate";
if (!customElements.get(TAG)) customElements.define(TAG, class extends HTMLElement {});
window[OWNER]?.dispose();

function mountBetterImpersonate() {
  const selector = 'textarea[data-chat-composer="true"][data-chat-id]';
  const popupSelector = '[data-chat-input-popup="quick-reply"]';
  const owned = new Set();
  const restores = new Map();
  let disposed = false;
  let queued = false;
  let notice;
  let noticeTimer;
  function report(error) {
    notice?.remove();
    clearTimeout(noticeTimer);
    notice = document.createElement("div");
    notice.setAttribute("role", "status");
    notice.textContent = error?.message || String(error);
    Object.assign(notice.style, { position: "fixed", bottom: "1rem", left: "1rem", right: "1rem",
      zIndex: "10050", padding: "0.75rem", borderRadius: "0.75rem", pointerEvents: "none",
      background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" });
    document.body.append(notice);
    noticeTimer = setTimeout(() => notice?.remove(), 6000);
  }
  function context() {
    const textarea = [...document.querySelectorAll(selector)].find(node => node.getClientRects().length);
    const root = textarea?.closest(".mari-chat-input");
    const chatId = textarea?.dataset.chatId;
    const send = root?.querySelector(".mari-chat-send-btn");
    if (!root || !chatId || !send) return null;
    const isBusy = () => textarea.disabled || textarea.readOnly ||
      Boolean(send.querySelector('[class*="lucide-stop"],[class*="lucide-circle-stop"],[class*="lucide-loader"]'));
    const valid = () => textarea.isConnected && textarea.dataset.chatId === chatId;
    const write = value => {
      if (!valid()) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    return { chatId, read: () => textarea.value, write, valid, isBusy, busy: isBusy(),
      lock(cancel) {
        const priorReadOnly = textarea.readOnly;
        const priorDisplay = send.style.display;
        textarea.readOnly = true;
        // A package-owned Stop replaces the visible Send control only for this dry run.
        // Native handlers are never clicked or changed.
        send.style.display = "none";
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = send.className;
        stop.textContent = "■";
        stop.title = "Stop impersonation";
        stop.setAttribute("aria-label", stop.title);
        stop.dataset.betterImpersonateStop = "";
        stop.addEventListener("click", cancel);
        send.after(stop);
        const block = event => {
          if (event.type === "keydown" && event.key !== "Enter") return;
          if (event.target === stop || stop.contains(event.target)) return;
          if (event.type === "click" || event.type === "keydown") {
            event.preventDefault(); event.stopImmediatePropagation();
          }
        };
        root.addEventListener("click", block, true);
        root.addEventListener("keydown", block, true);
        return () => {
          root.removeEventListener("click", block, true);
          root.removeEventListener("keydown", block, true);
          stop.remove();
          textarea.readOnly = priorReadOnly;
          send.style.display = priorDisplay;
        };
      },
    };
  }
  const controller = createController({ context, changed: () => schedule() });
  const paths = {
    impersonate: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-10 2 2 4-4"/>',
    continue: '<path d="M4 12h12m-4-4 4 4-4 4m7-11v14"/>',
    restore: '<path d="M3 4v6h6M3 10a9 9 0 1 1 0 6"/>',
  };
  const labels = { impersonate: "Impersonate", continue: "Continue impersonate", restore: "Restore previous" };
  function closeMenu() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  function sync() {
    if (disposed) return;
    if (controller.active && !controller.active.valid()) controller.cancel();
    for (const button of owned) if (!button.isConnected) owned.delete(button);
    for (const [popup, restore] of restores) if (!popup.isConnected) { restore(); restores.delete(popup); }
    for (const popup of document.querySelectorAll(popupSelector)) {
      const menu = popup.querySelector('[role="menu"]');
      if (!menu || menu.querySelector("[data-better-impersonate]")) continue;
      const sample = menu.querySelector('button[role="menuitem"]');
      if (!sample) continue;
      const style = popup.getAttribute("style");
      restores.set(popup, () => {
        if (style === null) popup.removeAttribute("style"); else popup.setAttribute("style", style);
      });
      for (const mode of ["impersonate", "continue", "restore"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.className = sample.className.replace(/\b(cursor-not-allowed|opacity-45)\b/g, "");
        button.style.background = "var(--card)";
        button.style.color = "var(--foreground)";
        button.dataset.betterImpersonate = mode;
        button.title = labels[mode];
        button.setAttribute("aria-label", labels[mode]);
        button.innerHTML = '<span style="display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' + paths[mode] + '</svg></span>';
        button.addEventListener("click", event => {
          event.preventDefault(); event.stopPropagation();
          closeMenu();
          if (mode === "restore") {
            try { controller.restore(); } catch (error) { report(error); }
          } else void controller.start(mode).catch(report);
        });
        owned.add(button);
        menu.append(button);
      }
    }
    const ctx = context();
    for (const button of owned) button.disabled = Boolean(controller.active) || !ctx || ctx.busy;
    clampMenus();
  }
  function clampMenus() {
    for (const popup of restores.keys()) {
      if (!popup.isConnected) continue;
      popup.style.maxHeight = Math.max(44, innerHeight - 16) + "px";
      popup.style.overflowY = "auto";
      const rect = popup.getBoundingClientRect();
      const menuId = popup.querySelector('[role="menu"]')?.id;
      const trigger = menuId && document.querySelector('.mari-chat-input button[aria-controls="' + CSS.escape(menuId) + '"]');
      const anchor = trigger?.getBoundingClientRect();
      const above = anchor ? anchor.top - 8 - rect.height : rect.top;
      const top = anchor && above < 8 ? anchor.bottom + 8 : above;
      const left = anchor ? anchor.left + anchor.width / 2 - rect.width / 2 : rect.left;
      popup.style.top = Math.max(8, Math.min(top, innerHeight - rect.height - 8)) + "px";
      popup.style.left = Math.max(8, Math.min(left, innerWidth - rect.width - 8)) + "px";
    }
  }
  function schedule() {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  }
  // Observe structure, not message content/characterData. Inspect only changed subtrees
  // for composer or quick-action markers; never scan the chat history on each token.
  const relevant = node => node.nodeType === 1 && (
    node.matches(selector + "," + popupSelector) || node.querySelector(selector + "," + popupSelector)
  );
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === "attributes"
      ? record.target.matches(selector)
      : [...record.addedNodes, ...record.removedNodes].some(relevant))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-chat-id", "disabled"] });
  function keyboard(event) {
    const menu = event.target.closest?.(popupSelector + ' [role="menu"]');
    if (!menu || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...menu.querySelectorAll('button[role="menuitem"]:not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const index = buttons.indexOf(event.target.closest("button"));
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  document.addEventListener("keydown", keyboard, true);
  window.addEventListener("resize", clampMenus);
  window.addEventListener("pagehide", controller.cancel);
  schedule();
  return { get running() { return controller.active !== null; }, stop: controller.cancel, dispose() {
    if (disposed) return;
    disposed = true;
    controller.cancel();
    observer.disconnect();
    document.removeEventListener("keydown", keyboard, true);
    window.removeEventListener("resize", clampMenus);
    window.removeEventListener("pagehide", controller.cancel);
    for (const button of owned) button.remove();
    for (const restore of restores.values()) restore();
    owned.clear(); restores.clear();
    clearTimeout(noticeTimer); notice?.remove();
  }};
}
window[OWNER] = mountBetterImpersonate();

})();
