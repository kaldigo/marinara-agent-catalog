import { looksLikeNativeMessageRange, tokenizeCommandTail } from "./ranges.js";

export function createSlashCommandRouter() {
  const registrations = new Map();
  return {
    register(registration) {
      const normalized = normalizeRegistration(registration);
      registrations.set(normalized.id, normalized);
      return () => registrations.delete(normalized.id);
    },
    match(rawText) {
      return matchSlashCommand(rawText, [...registrations.values()]);
    },
    async run(rawText, context = {}) {
      const match = matchSlashCommand(rawText, [...registrations.values()]);
      if (!match) return { handled: false };
      const result = await match.registration.handler({ ...match, context });
      return { handled: true, result };
    },
  };
}

export function matchSlashCommand(rawText, registrations) {
  const raw = String(rawText || "").trim();
  if (!raw.startsWith("/")) return null;
  for (const registration of registrations || []) {
    const match = matchOne(raw, normalizeRegistration(registration));
    if (match) return match;
  }
  return null;
}

export function normalizeRegistration(registration) {
  if (!registration?.id) throw new Error("Slash command registration requires an id.");
  if (typeof registration.handler !== "function") {
    throw new Error(`Slash command ${registration.id} requires a handler.`);
  }
  return {
    id: String(registration.id),
    commands: normalizeCommandNames(registration.commands || registration.command || registration.name),
    hijacks: normalizeCommandNames(registration.hijacks || []),
    owns: typeof registration.owns === "function" ? registration.owns : () => true,
    handler: registration.handler,
  };
}

function normalizeCommandNames(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter(Boolean)
    .map((item) => String(item).trim().toLowerCase())
    .map((item) => (item.startsWith("/") ? item : `/${item}`));
}

function matchOne(raw, registration) {
  const lower = raw.toLowerCase();
  const direct = registration.commands.find((command) => lower === command || lower.startsWith(`${command} `));
  if (direct) {
    const tail = raw.slice(direct.length).trim();
    const tokens = tokenizeCommandTail(tail);
    if (!registration.owns({ raw, command: direct, tail, tokens, hijacked: false })) return null;
    return { registration, raw, command: direct, tail, tokens, hijacked: false };
  }

  for (const hijack of registration.hijacks) {
    if (lower !== hijack && !lower.startsWith(`${hijack} `)) continue;
    const tail = raw.slice(hijack.length).trim();
    const tokens = tokenizeCommandTail(tail);
    if (!tokens.length) continue;
    if (looksLikeNativeMessageRange(tail)) continue;
    if (!registration.owns({ raw, command: hijack, tail, tokens, hijacked: true })) continue;
    return { registration, raw, command: hijack, tail, tokens, hijacked: true };
  }

  return null;
}

export function createHideHijackOwner() {
  return ({ tokens }) => {
    const first = tokens[0] || "";
    return Boolean(first) && !looksLikeNativeMessageRange(first);
  };
}
