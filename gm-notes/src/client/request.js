const ADMIN_SECRET_STORAGE_KEY = "marinara_admin_secret";
const CSRF_HEADER = "x-marinara-csrf";
const CSRF_HEADER_VALUE = "1";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function buildNativeJsonHeaders(options = {}, adminSecret = "") {
  const headers = new Headers(options.headers ?? {});
  headers.set("Accept", "application/json");
  if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (UNSAFE_METHODS.has(String(options.method ?? "GET").toUpperCase())) {
    headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  }
  if (typeof adminSecret === "string" && adminSecret.trim()) {
    headers.set("X-Admin-Secret", adminSecret.trim());
  }
  return headers;
}

function readAdminSecret() {
  try {
    return globalThis.window?.localStorage?.getItem(ADMIN_SECRET_STORAGE_KEY)?.trim() ?? "";
  } catch {
    // Storage can be unavailable in hardened browser contexts. The server will
    // still allow privileged requests made from an authorized local origin.
    return "";
  }
}

export async function nativeJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: buildNativeJsonHeaders(options, readAdminSecret()),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error || `Native request failed (${response.status})`;
    if (response.status === 403) {
      throw new Error(`Backfill needs Admin Access. Check Settings → Advanced → Admin Access. (${detail})`);
    }
    throw new Error(detail);
  }
  return data;
}
