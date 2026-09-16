import { isMainThread } from "node:worker_threads";

// NODE_OPTIONS --import entries are inherited by Worker threads. The injected
// Engine bootstrap owns process-level patch preparation and handoff, so workers
// must not load it a second time inside the same process.
// The native restart supervisor passes its --import arguments to the server.
// It must stay a plain supervisor, without importing Engine services itself.
const entry = process.argv[1]?.replaceAll("\\", "/") ?? "";
const isSupervisor = entry.endsWith("/scripts/run-server.mjs")
  || entry.endsWith("/marinara-docker-entrypoint.mjs")
  || entry.endsWith("/scripts/docker-entrypoint.mjs");
if (isMainThread && !isSupervisor) await import("./runtime.mjs");
