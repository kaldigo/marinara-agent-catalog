function createRuntime() {
  return {
    initialized: false,
    dom: createDomScope(),
    activeRun: null,
    registrations: [],
  };
}

function defineCapabilityElement() {
  const tag = "marinara-capability-impersonate-button";
  if (customElements.get(tag)) return;

  class ImpersonateButtonCapabilityElement extends HTMLElement {
    connectedCallback() {
      this.hidden = true;
      this.setAttribute("aria-hidden", "true");
    }
  }

  customElements.define(tag, ImpersonateButtonCapabilityElement);
}

function installPublicApi(runtime) {
  const api = Object.freeze({
    id: PACKAGE_ID,
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    start: (mode = "impersonate") => startDryRun(runtime, mode),
    stop: () => stopRun(runtime),
    restoreGuidance: () => restoreGuidance(runtime),
  });
  try {
    Object.defineProperty(window, PUBLIC_API_KEY, {
      value: api,
      enumerable: false,
      configurable: true,
    });
  } catch {
    window[PUBLIC_API_KEY] = api;
  }
  window.dispatchEvent(new CustomEvent("marinara:impersonate-button-ready", { detail: api }));
  return api;
}

function showToast(runtime, message, ok) {
  const t = document.createElement("div");
  t.textContent = message;
  t.className = ok ? "mari-ib-toast mari-ib-toast-ok" : "mari-ib-toast";
  document.body.appendChild(t);
  runtime.dom.timeout(() => {
    t.classList.add("mari-ib-toast-out");
    runtime.dom.timeout(() => t.remove(), 220);
  }, 2600);
}

function getDisabledReason(runtime, context) {
  if (!context.root || !context.textarea) return "Select or create a chat first.";
  if (runtime.activeRun) return "Impersonate generation is running.";
  if (context.textarea.disabled) return "Wait for the current generation to finish.";
  return "";
}

function restoreGuidance(runtime) {
  const context = findActiveComposerContext();
  if (!context.textarea || !context.chatId) return;
  const saved = loadGuidance(context.chatId);
  if (!saved.trim()) {
    showToast(runtime, "No saved guidance for this chat.", false);
    return;
  }
  setTextControlValue(context.textarea, saved);
  context.textarea.focus();
}

function quickActions(runtime) {
  return [
    {
      id: "impersonate",
      label: "Impersonate",
      title: "Generate as your persona",
      icon: ICONS.impersonate,
      handler: () => startDryRun(runtime, "impersonate"),
    },
    {
      id: "continue",
      label: "Continue draft",
      title: "Continue the current draft",
      icon: ICONS.continue,
      handler: () => startDryRun(runtime, "continue"),
    },
    {
      id: "inner-state",
      label: "Inner State",
      title: "Use the current text as private thoughts or feelings",
      icon: ICONS.innerState,
      handler: () => startDryRun(runtime, "inner_state"),
    },
    {
      id: "restore-guidance",
      label: "Restore guidance",
      title: "Restore the last guidance text",
      icon: ICONS.restore,
      handler: () => restoreGuidance(runtime),
    },
  ];
}

function createQuickActionButton(runtime, action) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BUTTON_CLASS;
  btn.dataset.mariImpersonateAction = action.id;
  btn.title = `${action.label}: ${action.title}`;
  btn.setAttribute("aria-label", `${action.label}: ${action.title}`);
  btn.innerHTML = `<span class="mari-ib-icon-shell">${action.icon}</span>`;
  runtime.dom.on(btn, "pointerdown", (event) => event.preventDefault());
  runtime.dom.on(btn, "dragstart", (event) => event.preventDefault());
  runtime.dom.on(btn, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (btn.disabled) return;
    action.handler();
  });
  return btn;
}

function renderQuickActionSlot(runtime) {
  const root = document.createElement("span");
  root.className = ROOT_CLASS;
  runtime.dom.on(root, "selectstart", (event) => event.preventDefault());
  runtime.dom.on(root, "dragstart", (event) => event.preventDefault());
  for (const action of quickActions(runtime)) root.appendChild(createQuickActionButton(runtime, action));
  return root;
}

function updateQuickActionSlot(runtime, context) {
  const reason = getDisabledReason(runtime, context);
  for (const button of context.node.querySelectorAll(`.${BUTTON_CLASS}`)) {
    button.disabled = Boolean(reason);
    button.classList.toggle("mari-ib-active", !!runtime.activeRun);
    const action = quickActions(runtime).find((item) => item.id === button.dataset.mariImpersonateAction);
    if (!action) continue;
    button.title = reason || `${action.label}: ${action.title}`;
    button.setAttribute("aria-label", reason || `${action.label}: ${action.title}`);
  }
}

function registerSlots(runtime) {
  runtime.registrations.push(
    registerComposerSlotContribution({
      packageId: PACKAGE_ID,
      id: "quick-actions",
      slot: COMPOSER_SLOT_QUICK_ACTIONS,
      priority: 50,
      render: () => renderQuickActionSlot(runtime),
      update: (context) => updateQuickActionSlot(runtime, context),
    }),
  );
}

function startRuntime(runtime) {
  injectStyle(STYLE_ID, CLIENT_CSS);
  ensureGenerationLifecycleBridge();
  runtime.dom.on(window, GENERATION_STATE_EVENT, () => scheduleComposerSlotRender(0));
  registerSlots(runtime);
}

function destroyRuntime(runtime) {
  if (runtime.activeRun) stopRun(runtime);
  while (runtime.registrations.length) {
    try {
      runtime.registrations.pop()?.();
    } catch {}
  }
  document.getElementById(STYLE_ID)?.remove();
  runtime.dom.destroy();
}

function startImpersonateButtonPackage() {
  defineCapabilityElement();

  if (window[RUNTIME_KEY]?.initialized) {
    installPublicApi(window[RUNTIME_KEY]);
    return window[RUNTIME_KEY];
  }

  const runtime = createRuntime();
  runtime.initialized = true;
  window[RUNTIME_KEY] = runtime;
  installPublicApi(runtime);

  if (document.readyState === "loading") {
    runtime.dom.on(document, "DOMContentLoaded", () => startRuntime(runtime), { once: true });
  } else {
    startRuntime(runtime);
  }

  runtime.dom.cleanup(() => {
    if (window[RUNTIME_KEY] === runtime) delete window[RUNTIME_KEY];
  });
  runtime.destroy = () => destroyRuntime(runtime);
  return runtime;
}
