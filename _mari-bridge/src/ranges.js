export function parseMessageRange(tokens, messages) {
  const list = Array.isArray(messages) ? messages : [];
  const parts = Array.isArray(tokens) ? tokens.map(String) : tokenizeCommandTail(String(tokens || ""));
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

  const dash = joined.match(/^(\d+)\s*-\s*(\d+)$/);
  if (dash) return selectIndexRange(list, Number(dash[1]), Number(dash[2]));

  const single = Number(joined);
  if (Number.isInteger(single) && single > 0) return selectIndexRange(list, single, single);

  throw new Error(`Unsupported range: ${parts.join(" ")}`);
}

export function selectIndexRange(messages, start, end) {
  const list = Array.isArray(messages) ? messages : [];
  const left = Math.max(1, Math.min(start, end));
  const right = Math.min(list.length, Math.max(start, end));
  if (!Number.isFinite(left) || !Number.isFinite(right) || left > list.length) {
    throw new Error("Range is outside the loaded chat.");
  }
  return list.slice(left - 1, right);
}

export function tokenizeCommandTail(text) {
  const tokens = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(text || "")))) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(["'\\])/g, "$1"));
  }
  return tokens;
}

export function looksLikeNativeMessageRange(value) {
  const text = String(value || "").trim().toLowerCase();
  return (
    text === "all" ||
    /^last\s+\d+$/u.test(text) ||
    /^from\s+\d+\s+to\s+\d+$/u.test(text) ||
    /^\d+(?:\s*-\s*\d+)?$/u.test(text)
  );
}
