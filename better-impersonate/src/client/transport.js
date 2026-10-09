export function readSettings(storage) {
  const stored = JSON.parse(storage.getItem("marinara-engine-ui") || "{}");
  return stored.state ?? stored;
}

export async function api(path, { body, signal, raw = false } = {}) {
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
export async function preflight(chatId, settings, signal) {
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

export async function consumeDryRun(response, onEvent) {
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
