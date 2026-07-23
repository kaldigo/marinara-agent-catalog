function savedGuidanceKey(chatId) {
  return STORAGE_PREFIX + chatId;
}

function saveGuidance(chatId, text) {
  const value = String(text || "").trim();
  if (!chatId || !value) return;
  try {
    localStorage.setItem(savedGuidanceKey(chatId), text);
  } catch {}
}

function loadGuidance(chatId) {
  if (!chatId) return "";
  try {
    return localStorage.getItem(savedGuidanceKey(chatId)) || "";
  } catch {
    return "";
  }
}

function normalizeImpersonatePromptTemplate(value) {
  const template = String(value || "").trim();
  return {
    template,
    trimOnly: TRIM_ONLY_PROMPT_RE.test(template),
  };
}

function buildModeGenerationGuide(mode, originalInput) {
  const input = String(originalInput || "").trim();
  if (!input) return "";
  if (mode === "inner_state") {
    return [
      "Private inner state for {{user}}:",
      input,
      "",
      "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
      "Let this ground the response in {{user}}'s feelings rather than force an outcome.",
    ].join("\n");
  }
  if (mode !== "continue") {
    return [
      "Guidance for {{user}}'s next in-character response:",
      input,
      "",
      "Use this as a suggestion for the generated response, not as dialogue or chat history.",
      "Do not quote or rush to fulfill the suggestion; let it guide you naturally.",
    ].join("\n");
  }
  return [
    "Continue the current in-character draft.",
    "The draft so far is:",
    input,
    "",
    "Treat the draft as text to continue, not as dialogue or chat history to answer.",
    "Return only the continuation text.",
    "Do not restart the draft.",
    "Do not repeat any part of the draft.",
    "Do not explain.",
  ].join("\n");
}

function buildInnerStateTemplate(baseTemplate) {
  const base = String(baseTemplate || "").trim();
  const innerStateBlock = [
    "Private inner state for {{user}}:",
    "{{impersonate_direction}}",
    "",
    "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
    "Let this ground the response in {{user}}'s feelings rather than force an outcome.",
  ].join("\n");
  return base ? `${base}\n\n${innerStateBlock}` : innerStateBlock;
}

function buildContinueTemplate(baseTemplate) {
  const base = String(baseTemplate || "").trim();
  const continueBlock = [
    "Continue {{user}}'s current in-character draft.",
    "The draft so far is:",
    "{{impersonate_direction}}",
    "",
    "Return only the continuation text.",
    "Do not restart the draft.",
    "Do not repeat any part of the draft.",
    "Do not explain.",
  ].join("\n");
  return base ? `${base}\n\n${continueBlock}` : continueBlock;
}
