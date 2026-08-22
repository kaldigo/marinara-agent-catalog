export function createPresenceCommandRouter({ runPresenceCommand, runScopedHideCommand }) {
  return {
    async run(raw, context = {}) {
      const tokens = tokenize(raw);
      const command = tokens.shift()?.toLowerCase();
      if (command === "/presence") {
        return { handled: true, result: await runPresenceCommand({ raw, tokens, context }) };
      }
      if ((command === "/hide" || command === "/unhide") && tokens.length > 0) {
        return {
          handled: true,
          result: await runScopedHideCommand({ raw, tokens, hidden: command === "/hide", context }),
        };
      }
      return { handled: false };
    },
  };
}

function tokenize(text) {
  const tokens = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/gu;
  for (const match of String(text ?? "").trim().matchAll(pattern)) {
    tokens.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\([\\"'])/gu, "$1"));
  }
  return tokens;
}
