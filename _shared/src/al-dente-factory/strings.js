export function toCleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function normalizeId(value, fallback = "") {
  return toCleanString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
