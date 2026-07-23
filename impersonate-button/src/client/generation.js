function normalizeMode(requestedMode, input) {
  const mode = requestedMode === "continue" ? "continue" : requestedMode === "inner_state" ? "inner_state" : "impersonate";
  if (mode === "continue" && !String(input || "").trim()) return "impersonate";
  return mode;
}

function joiner(left, right) {
  if (!left || !right) return "";
  if (/[\s"'([{]$/u.test(left)) return "";
  if (/^[\s.,!?;:)"'\]}]/u.test(right)) return "";
  return " ";
}

async function buildDryRunParams({ chatId, mode, originalInput, settings }) {
  const promptTemplate = normalizeImpersonatePromptTemplate(settings.impersonatePromptTemplate);
  const useRegularPresetDryRun = promptTemplate.trimOnly && !!settings.impersonatePresetId;
  const params = useRegularPresetDryRun
    ? {
        chatId,
        presetId: settings.impersonatePresetId,
        streaming: true,
      }
    : {
        chatId,
        userMessage: mode === "continue" || mode === "inner_state" ? originalInput.trim() : originalInput.trim() || null,
        impersonate: true,
        streaming: true,
        impersonateBlockAgents: settings.impersonateBlockAgents,
      };

  if (useRegularPresetDryRun) {
    if (settings.impersonateConnectionId) params.connectionId = settings.impersonateConnectionId;
    const generationGuide = buildModeGenerationGuide(mode, originalInput);
    if (generationGuide) {
      params.generationGuide = generationGuide;
      params.generationGuideSource = "guide";
    }
    return params;
  }

  if (settings.impersonatePresetId) params.impersonatePresetId = settings.impersonatePresetId;
  if (settings.impersonateConnectionId) params.impersonateConnectionId = settings.impersonateConnectionId;

  if (mode === "continue") {
    const baseTemplate = promptTemplate.template || (await readChatImpersonatePrompt(chatId));
    params.impersonatePromptTemplate = buildContinueTemplate(baseTemplate);
  } else if (mode === "inner_state") {
    const baseTemplate = promptTemplate.trimOnly ? "" : promptTemplate.template || (await readChatImpersonatePrompt(chatId));
    params.impersonatePromptTemplate = buildInnerStateTemplate(baseTemplate);
  } else if (promptTemplate.template) {
    params.impersonatePromptTemplate = promptTemplate.template;
  }

  return params;
}

async function startDryRun(runtime, requestedMode) {
  if (runtime.activeRun) {
    stopRun(runtime);
    return;
  }

  const context = findActiveComposerContext();
  const textarea = context.textarea;
  const chatId = context.chatId;
  if (!context.root || !textarea || !context.sendButton || !chatId) {
    showToast(runtime, "No active chat detected.", false);
    return;
  }
  if (textarea.disabled) return;

  const originalInput = textarea.value || "";
  const mode = normalizeMode(requestedMode, originalInput);
  if (mode === "impersonate" || mode === "inner_state") saveGuidance(chatId, originalInput);

  const run = {
    clientRunId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    serverRunId: "",
    abortController: new AbortController(),
    chatId,
    mode,
    originalInput,
    hasStartedText: false,
    aborted: false,
  };
  runtime.activeRun = run;
  scheduleComposerSlotRender(0);

  let buffer = "";
  let continuation = "";
  if (mode === "impersonate" || mode === "inner_state") setTextControlValue(textarea, "Generating...");

  const settings = readImpersonateSettings();
  const chat = await readChat(chatId);
  const personaName = await readPersonaName(chatId);
  const regexContext = await readRegexContext(chat, personaName);
  const params = await buildDryRunParams({ chatId, mode, originalInput, settings });
  const renderContinuation = (value) => {
    const cleanedValue = renderGeneratedText(value, personaName, regexContext);
    setTextControlValue(textarea, originalInput + joiner(originalInput, cleanedValue) + cleanedValue);
  };

  try {
    await streamBridgeDryRunGeneration({
      packageId: PACKAGE_ID,
      id: mode,
      kind: GENERATION_KIND_AGENT,
      chatId,
      reason: "dry-run-generation",
      body: params,
      signal: run.abortController.signal,
      lockComposer: true,
      abort: () => abortRun(runtime, run),
      handlers: {
        onEvent: (event) => {
          if (!isCurrentRun(runtime, run)) return;
          if (event.type === "dryrun_started") {
            run.serverRunId = event.data?.runId || "";
          } else if (event.type === "token") {
            run.hasStartedText = true;
            if (mode === "continue") {
              continuation += String(event.data || "");
              renderContinuation(continuation);
            } else {
              buffer += String(event.data || "");
              setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
            }
          } else if (event.type === "result") {
            run.hasStartedText = true;
            const cleaned = String(event.data?.content || "").trimEnd();
            if (mode === "continue") {
              continuation = cleaned;
              renderContinuation(continuation);
            } else {
              buffer = cleaned;
              setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
            }
          } else if (event.type === "content_replace") {
            run.hasStartedText = true;
            buffer = String(event.data || "").trimEnd();
            setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
          } else if (event.type === "text_rewrite" && event.data?.editedText) {
            run.hasStartedText = true;
            buffer = String(event.data.editedText).trimEnd();
            setTextControlValue(textarea, renderGeneratedText(buffer, personaName, regexContext));
          } else if (event.type === "error") {
            throw new Error(String(event.data || "Dry run failed."));
          }
        },
      },
    });
  } catch (error) {
    if (isCurrentRun(runtime, run)) {
      if (!run.hasStartedText && (mode === "impersonate" || mode === "inner_state")) setTextControlValue(textarea, originalInput);
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showToast(runtime, error?.message || "Silent impersonate failed.", false);
      }
    }
  } finally {
    if (runtime.activeRun === run) runtime.activeRun = null;
    scheduleComposerSlotRender(0);
  }
}

function isCurrentRun(runtime, run) {
  return !!runtime.activeRun && !!run && runtime.activeRun.clientRunId === run.clientRunId;
}

function stopRun(runtime) {
  const run = runtime.activeRun;
  if (!run) return;
  abortRun(runtime, run);
}

function abortRun(runtime, run) {
  if (!run || run.aborted) return;
  run.aborted = true;
  if (!run.hasStartedText && (run.mode === "impersonate" || run.mode === "inner_state")) {
    const textarea = findActiveComposerContext().textarea;
    if (textarea) setTextControlValue(textarea, run.originalInput);
  }
  try {
    run.abortController?.abort();
  } catch {}
  void abortPackageDryRunGeneration(run.chatId, run.serverRunId);
  if (runtime.activeRun === run) runtime.activeRun = null;
  scheduleComposerSlotRender(0);
}

function abortPackageDryRunGeneration(chatId, runId) {
  if (!chatId || !runId) return Promise.resolve(null);
  return apiRequest("/generate/dryRun/abort", {
    method: "POST",
    body: JSON.stringify({ chatId, runId }),
  }).catch(() => null);
}
