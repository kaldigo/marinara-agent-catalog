import { installFetchInterceptor } from "../../../_mari-bridge/src/fetch-intercept.js";
import { PACKAGE_ID, PUBLIC_API_KEY, RUNTIME_KEY } from "./constants.js";
import { handleGenerateRequest, handleMessageEditRequest } from "./keeper.js";

export function startResponseKeeperPackage() {
  if (window[RUNTIME_KEY]?.destroy) return window[RUNTIME_KEY].api;

  const runtime = {
    cleanups: [],
    api: null,
    destroy: null,
  };

  runtime.cleanups.push(
    installFetchInterceptor({
      id: `${PACKAGE_ID}:generate`,
      priority: 40,
      match: (context) => context.method === "POST" && context.route.pathname === "/api/generate",
      handler: (context, next) => handleGenerateRequest(runtime, context, next),
    }),
  );
  runtime.cleanups.push(
    installFetchInterceptor({
      id: `${PACKAGE_ID}:message-edit`,
      priority: 45,
      match: (context) =>
        context.method === "PATCH" && /^\/api\/chats\/[^/]+\/messages\/[^/]+$/u.test(context.route.pathname),
      handler: (context, next) => handleMessageEditRequest(runtime, context, next),
    }),
  );

  runtime.api = Object.freeze({
    packageId: PACKAGE_ID,
    destroy: () => runtime.destroy?.(),
  });

  runtime.destroy = () => {
    while (runtime.cleanups.length) {
      try {
        runtime.cleanups.pop()?.();
      } catch {}
    }
    if (window[RUNTIME_KEY] === runtime) delete window[RUNTIME_KEY];
    if (window[PUBLIC_API_KEY] === runtime.api) delete window[PUBLIC_API_KEY];
  };

  window[RUNTIME_KEY] = runtime;
  Object.defineProperty(window, PUBLIC_API_KEY, {
    configurable: true,
    value: runtime.api,
  });
  window.dispatchEvent(new CustomEvent("marinara:response-keeper-ready", { detail: runtime.api }));
  return runtime.api;
}
