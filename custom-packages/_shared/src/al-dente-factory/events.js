import { FACTORY_ISSUE_EVENT } from "./constants.js";

export function eventType(type) {
  const text = String(type || "").trim();
  return text.startsWith("al-dente:") ? text : `al-dente:${text}`;
}

export function emit(type, detail) {
  window.dispatchEvent(new CustomEvent(eventType(type), { detail }));
}

export function notifyFactoryIssue(type, detail) {
  const payload = { type, ...detail };
  console.warn("[alDenteFactory]", type, detail);
  window.dispatchEvent(new CustomEvent(FACTORY_ISSUE_EVENT, { detail: payload }));
  document.documentElement?.setAttribute?.("data-al-dente-factory-issue", type);
}

export function createEventBus() {
  function on(type, handler, options) {
    if (typeof handler !== "function") return () => false;
    const wrapped = (event) => handler(event.detail, event);
    window.addEventListener(eventType(type), wrapped, options);
    return () => {
      window.removeEventListener(eventType(type), wrapped, options);
      return true;
    };
  }

  function once(type, handler, options) {
    if (typeof handler !== "function") return () => false;
    return on(type, handler, { ...(options || {}), once: true });
  }

  return Object.freeze({
    on,
    once,
    off: (type, wrapped, options) => {
      window.removeEventListener(eventType(type), wrapped, options);
      return true;
    },
    emit,
  });
}
