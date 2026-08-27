export function buildImpersonateDraftRequest(mode, guidance) {
  if (mode === "continue") {
    return {
      impersonate: true,
      impersonateContinuation: guidance,
    };
  }
  return {
    impersonate: true,
    ...(guidance
      ? {
          generationGuide: guidance,
          generationGuideSource: "guide",
        }
      : {}),
  };
}

export function extractContinuationSuffix(original, generated) {
  const draft = String(original ?? "");
  const content = String(generated ?? "");
  if (!draft || !content) return content;
  if (content.startsWith(draft)) return content.slice(draft.length);
  if (draft.startsWith(content)) return "";
  return content;
}
