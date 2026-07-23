function pathnameOf(input) {
  try {
    const url = typeof input === "string" ? input : input?.url || "";
    return new URL(String(url || ""), window.location.origin).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
}

export function createRoutesSurface() {
  function isGenerateUrl(input) {
    return pathnameOf(input) === "/api/generate";
  }

  function isDryRunGenerateUrl(input) {
    return pathnameOf(input) === "/api/generate/dryRun";
  }

  function isRawGenerateUrl(input) {
    return pathnameOf(input) === "/api/generate/raw";
  }

  function parseCreateMessageUrl(input) {
    const match = pathnameOf(input).match(/^\/api\/chats\/([^/]+)\/messages$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function classify(input) {
    if (isGenerateUrl(input)) return { kind: "generate", route: "generate", pathname: pathnameOf(input) };
    if (isDryRunGenerateUrl(input)) return { kind: "generate", route: "generate:dry-run", pathname: pathnameOf(input) };
    if (isRawGenerateUrl(input)) return { kind: "generate", route: "generate:raw", pathname: pathnameOf(input) };
    const createMessageChatId = parseCreateMessageUrl(input);
    if (createMessageChatId) return { kind: "message:create", route: "message:create", chatId: createMessageChatId, pathname: pathnameOf(input) };
    return { kind: "other", route: "other", pathname: pathnameOf(input) };
  }

  return Object.freeze({
    pathnameOf,
    isGenerateUrl,
    isDryRunGenerateUrl,
    isRawGenerateUrl,
    parseCreateMessageUrl,
    classify,
  });
}
