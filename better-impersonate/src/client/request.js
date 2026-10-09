export function buildRequest(chatId, mode, input, settings = {}) {
  if (!["impersonate", "continue"].includes(mode)) throw new Error("Unknown impersonation action.");
  const direction = mode === "continue" && input.trim()
    ? ["Continue my current in-character draft below. Return only new continuation text.",
       "Do not repeat or restart the draft. Do not explain.", "", input].join("\n")
    : input;
  const body = { chatId, impersonate: true, streaming: true, userMessage: direction || null };
  for (const key of ["impersonatePromptTemplate", "impersonatePresetId", "impersonateConnectionId"]) {
    if (typeof settings[key] === "string" && settings[key].trim()) body[key] = settings[key];
  }
  body.impersonateBlockAgents = settings.impersonateBlockAgents === true;
  return body;
}

export function extractContinuationSuffix(original, generated) {
  if (!original || !generated) return generated;
  if (generated.startsWith(original)) return generated.slice(original.length);
  // During streaming, withhold an incomplete echo until it can be distinguished.
  if (original.startsWith(generated)) return "";
  const left = original.trim();
  const right = generated.trimStart();
  if (left && right.startsWith(left)) return right.slice(left.length);
  if (left && left.startsWith(right)) return "";
  return generated;
}

export function appendContinuation(original, suffix) {
  if (!suffix) return original;
  const separator = original && !/[\s"'([{]$/.test(original) && !/^[\s.,!?;:)"'\]}]/.test(suffix) ? " " : "";
  return original + separator + suffix;
}
