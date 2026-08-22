const DEFAULT_IMPERSONATE_DRAFT_TEMPLATE = [
  "{{base_prompt}}",
  "",
    "Guidance for {{user}}'s next in-character response:",
    "{{impersonate_direction}}",
    "",
    "Use this as a suggestion for the generated response, not as dialogue or chat history.",
    "Do not quote or rush to fulfill the suggestion; let it guide you naturally.",
].join("\n").trim();

const DEFAULT_IMPERSONATE_THINKING_TEMPLATE = [
  "{{base_prompt}}",
  "",
    "Private inner state for {{user}}:",
    "{{impersonate_direction}}",
    "",
    "Use this as quiet context for {{user}}'s current thoughts and feelings. Do not treat it as dialogue, chat history, or an instruction for what must happen next.",
    "Let this ground the response in {{user}}'s feelings rather than force an outcome.",
].join("\n").trim();

const DEFAULT_IMPERSONATE_CONTINUE_TEMPLATE = [
  "{{base_prompt}}",
  "",
    "Continue {{user}}'s current in-character draft.",
    "The draft so far is:",
    "{{impersonate_direction}}",
    "",
    "Return only the continuation text.",
    "Do not restart the draft.",
    "Do not repeat any part of the draft.",
    "Do not explain.",
].join("\n").trim();

function applyImpersonateModeTemplate(template, baseTemplate) {
  const base = String(baseTemplate || "").trim();
  const source = String(template || "").trim();
  return source.includes("{{base_prompt}}")
    ? source.replaceAll("{{base_prompt}}", base).trim()
    : [base, source].filter(Boolean).join("\n\n");
}
