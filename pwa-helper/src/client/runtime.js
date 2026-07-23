function log(...args) {
  let debugEnabled = false;
  try {
    debugEnabled = window.localStorage?.getItem("pwa-helper:debug") === "1";
  } catch {
    debugEnabled = false;
  }
  if (debugEnabled) {
    console.debug(`[${PACKAGE_NAME}]`, ...args);
  }
}

function warn(...args) {
  console.warn(`[${PACKAGE_NAME}]`, ...args);
}

function defineCapabilityElement() {
  if (customElements.get(ELEMENT_TAG)) return;

  class PwaHelperElement extends HTMLElement {
    connectedCallback() {
      this.hidden = true;
      this.setAttribute("aria-hidden", "true");
    }
  }

  customElements.define(ELEMENT_TAG, PwaHelperElement);
}

function installPublicApi(api) {
  try {
    Object.defineProperty(window, PUBLIC_API_KEY, {
      value: api,
      enumerable: false,
      configurable: true,
    });
  } catch {
    window[PUBLIC_API_KEY] = api;
  }

  window.dispatchEvent(new CustomEvent("marinara:pwa-helper-ready", { detail: api }));
}

function createRuntime() {
  const status = createStatusReporter();
  const wakeLock = createWakeLockController({
    setWakeLockStatus: status.setWakeLockStatus,
    warn,
  });
  const generationMonitor = createGenerationMonitor({
    wakeLock,
    setGenerationStatus: status.setGenerationStatus,
    warn,
  });
  const iosIcon = createIosIconInstaller({
    setIosIconStatus: status.setIosIconStatus,
    log,
    warn,
  });

  const api = Object.freeze({
    id: PACKAGE_ID,
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    wakeLock: Object.freeze({
      hold: wakeLock.hold,
      release: wakeLock.release,
      status: wakeLock.status,
    }),
    generation: Object.freeze({
      detectActive: generationMonitor.detectGenerationActive,
    }),
  });

  function start() {
    iosIcon.install();
    generationMonitor.start();
    void wakeLock.reconcile();
  }

  function destroy() {
    generationMonitor.stop();
    wakeLock.destroy();
    status.setIosIconStatus("");
    status.setWakeLockStatus("", "");
  }

  return { api, start, destroy };
}

function startPwaHelper() {
  defineCapabilityElement();

  if (window[RUNTIME_KEY]?.api) {
    installPublicApi(window[RUNTIME_KEY].api);
    return window[RUNTIME_KEY].api;
  }

  const runtime = createRuntime();
  window[RUNTIME_KEY] = runtime;
  installPublicApi(runtime.api);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runtime.start, { once: true });
  } else {
    runtime.start();
  }

  return runtime.api;
}
