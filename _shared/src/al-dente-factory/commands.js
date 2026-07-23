import { emit } from "./events.js";
import { normalizeId } from "./strings.js";

function commandNameFromText(text) {
  const match = String(text || "").trim().match(/^\/([A-Za-z][\w:-]*)(?:\s|$)/);
  return match ? match[1].toLowerCase() : "";
}

function parseTokens(text) {
  const tokens = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(text || "")))) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1"));
  }
  return tokens;
}

function findInputRoot() {
  return Array.from(document.querySelectorAll(".mari-chat-input.chat-input-container, .mari-chat-input"))
    .filter((el) => el instanceof HTMLElement && el.querySelector("textarea.mari-chat-input-textarea, textarea"))
    .find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || null;
}

function findTextarea() {
  return findInputRoot()?.querySelector("textarea.mari-chat-input-textarea, textarea") || null;
}

function isSendButton(target) {
  return Boolean(
    target instanceof Element &&
      target.closest("button.mari-chat-send-btn, button[title='Send'], button[aria-label='Send']"),
  );
}

function setTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  try {
    textarea.style.height = "auto";
  } catch {}
  try {
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
  } catch {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function publicCommandRecord(record) {
  return {
    id: record.id,
    names: [...record.names],
    source: record.source,
    description: record.description,
    registeredAt: record.registeredAt,
  };
}

function removeCommandListeners(state) {
  const cleanups = Array.isArray(state.commandCleanups) ? state.commandCleanups.splice(0) : [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {}
  }
  state.commandsInstalled = false;
}

export function createCommandSurface(state) {
  if (state.commandsInstalled) removeCommandListeners(state);

  function orderedCommands() {
    return Array.from(state.commands.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  function findCommand(name) {
    const normalized = String(name || "").toLowerCase();
    return orderedCommands().find((record) => record.names.has(normalized)) || null;
  }

  function clearInput(textarea) {
    if (textarea instanceof HTMLTextAreaElement) setTextareaValue(textarea, "");
  }

  async function run(raw, context = {}) {
    const trimmed = String(raw || "").trim();
    const name = commandNameFromText(trimmed);
    if (!name) return false;
    const record = findCommand(name);
    if (!record) return false;

    const argText = trimmed.replace(/^\/[A-Za-z][\w:-]*(?:\s|$)/, "").trim();
    const detail = {
      id: record.id,
      name,
      raw: trimmed,
      argText,
      tokens: parseTokens(argText),
      context,
    };
    emit("command:start", detail);
    try {
      await record.handler(detail);
      emit("command:finish", detail);
    } catch (error) {
      emit("command:error", { ...detail, error });
      throw error;
    }
    return true;
  }

  function consume(textarea, event, source) {
    const raw = textarea?.value || "";
    if (!commandNameFromText(raw)) return false;
    if (!findCommand(commandNameFromText(raw))) return false;

    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    const commandText = String(raw || "").trim();
    clearInput(textarea);
    run(commandText, { textarea, event, source, clearInput }).catch((error) => {
      console.warn("[alDenteFactory commands] command failed", error);
    });
    return true;
  }

  function install() {
    if (state.commandsInstalled) return;
    const keyHandler = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      consume(target, event, "keyboard");
    };
    const clickHandler = (event) => {
      if (!isSendButton(event.target)) return;
      const textarea = findTextarea();
      if (textarea) consume(textarea, event, "send-button");
    };
    document.addEventListener("keydown", keyHandler, true);
    document.addEventListener("click", clickHandler, true);
    state.commandCleanups.push(() => document.removeEventListener("keydown", keyHandler, true));
    state.commandCleanups.push(() => document.removeEventListener("click", clickHandler, true));
    state.commandsInstalled = true;
    emit("commands:installed", {});
  }

  function register(definition = {}) {
    const id = normalizeId(definition.id, "");
    if (!id) throw new Error("alDenteFactory.marinara.commands.register requires an id.");
    if (typeof definition.handler !== "function") throw new Error(`Command "${id}" requires a handler.`);

    const names = new Set(
      [definition.name, ...(Array.isArray(definition.names) ? definition.names : [])]
        .map((name) => String(name || "").replace(/^\//, "").toLowerCase().trim())
        .filter(Boolean),
    );
    if (!names.size) throw new Error(`Command "${id}" requires at least one name.`);

    const record = {
      id,
      names,
      source: String(definition.source || ""),
      description: String(definition.description || ""),
      handler: definition.handler,
      registeredAt: new Date().toISOString(),
    };
    state.commands.set(id, record);
    install();
    emit("command:registered", { command: publicCommandRecord(record) });

    return Object.freeze({
      id,
      unregister: () => unregister(id, definition.handler),
    });
  }

  function unregister(id, expectedHandler) {
    const key = normalizeId(id, "");
    const record = state.commands.get(key);
    if (!record) return false;
    if (expectedHandler && record.handler !== expectedHandler) return false;
    state.commands.delete(key);
    emit("command:unregistered", { id: key });
    return true;
  }

  if (state.commands.size > 0) install();

  return Object.freeze({
    register,
    unregister,
    run,
    parseTokens,
    list: () => orderedCommands().map(publicCommandRecord),
    has: (name) => Boolean(findCommand(name)),
  });
}
