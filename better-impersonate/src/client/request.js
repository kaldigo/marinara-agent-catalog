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
          generationGuide: mode === "inner_state"
            ? `Private inner state for {{user}}: ${guidance}\nUse this as quiet emotional context, not dialogue or a required outcome.`
            : guidance,
          generationGuideSource: "guide",
        }
      : {}),
  };
}
