export const FACTORY_KEY = "alDenteFactory";
export const READY_EVENT = "al-dente:factory-ready";
export const FACTORY_ISSUE_EVENT = "al-dente:factory-issue";
export const WAKE_HOLD_EVENT = "al-dente:wake-lock:hold";
export const WAKE_RELEASE_EVENT = "al-dente:wake-lock:release";
export const VERSION = "1.0.1";
export const MAJOR_VERSION = Number(VERSION.split(".")[0]) || 0;
export const REQUEST_BACKOFF_MS = 5000;
