export function createDiagnosticsRoutes(runtime) {
  return async function mariBridgeDiagnosticsRoutes(app) {
    app.get("/health", async () => runtime.getSnapshot());
    app.get("/consumers", async () => ({ consumers: runtime.getSnapshot().consumers }));
  };
}
