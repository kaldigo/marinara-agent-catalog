import { isMainThread } from "node:worker_threads";

// NODE_OPTIONS --import entries are inherited by Worker threads. The injected
// Engine bootstrap owns process-level patch preparation and handoff, so workers
// must not load it a second time inside the same process.
if (isMainThread) await import("./runtime.mjs");
