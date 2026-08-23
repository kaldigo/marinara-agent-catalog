export function parseMessageRange(tokens, messages) {
  const list = Array.isArray(messages) ? messages : [];
  const parts = Array.isArray(tokens) ? tokens.map(String) : String(tokens ?? "").trim().split(/\s+/u);
  const joined = parts.join(" ").trim().toLowerCase();
  if (!joined) throw new Error("Range is required.");
  if (joined === "all") return list;
  if (parts[0]?.toLowerCase() === "last") {
    const count = Math.max(0, Math.floor(Number(parts[1])));
    if (!count) throw new Error("Use last <number>.");
    return list.slice(-count);
  }
  if (parts[0]?.toLowerCase() === "from" && parts[2]?.toLowerCase() === "to") {
    return selectIndexRange(list, Number(parts[1]), Number(parts[3]));
  }
  const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/u);
  if (dash) return selectIndexRange(list, Number(dash[1]), Number(dash[2]));
  const single = Number(joined);
  if (Number.isInteger(single) && single > 0) return selectIndexRange(list, single, single);
  throw new Error(`Unsupported range: ${parts.join(" ")}`);
}

function selectIndexRange(messages, start, end) {
  const left = Math.max(1, Math.min(start, end));
  const right = Math.min(messages.length, Math.max(start, end));
  if (!Number.isFinite(left) || !Number.isFinite(right) || left > messages.length) {
    throw new Error("Range is outside the loaded chat.");
  }
  return messages.slice(left - 1, right);
}

export function createHideCommandOwner() {
  return ({ tokens }) => {
    const value = String(tokens?.[0] ?? "").trim().toLowerCase();
    return Boolean(value) && !(
      value === "all" ||
      /^last\s+\d+$/u.test(value) ||
      /^from\s+\d+\s+to\s+\d+$/u.test(value) ||
      /^\d+(?:\s*-\s*\d+)?$/u.test(value)
    );
  };
}
