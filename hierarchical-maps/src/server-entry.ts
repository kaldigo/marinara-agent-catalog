import { spatialContextRoutes as register } from "./engine/packages/server/src/routes/spatial-context.routes.ts";
import * as projection from "./engine/packages/server/src/services/spatial-context/projection.ts";
import * as stateResolution from "./engine/packages/server/src/services/spatial-context/state-resolution.ts";
import * as ownerTurn from "./engine/packages/server/src/services/spatial-context/owner-turn.ts";
import * as gameMapBinding from "./engine/packages/server/src/services/spatial-context/game-map-binding.ts";
import { configurePackageRuntime } from "./engine/packages/server/src/services/spatial-context/package-runtime.ts";
import { createSpatialContextStorage } from "./engine/packages/server/src/services/storage/spatial-context.storage.ts";
import { registerLocationEffects } from "./engine/packages/server/src/services/spatial-context/location-effects-registration.ts";
let readinessStorage = null;
export async function activate({ app, api }) {
  const cleanupRuntime = configurePackageRuntime(
    api.runtime,
    async (agentType) => {
      const response = await app.inject({ method: "GET", url: "/api/agents" });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error("Could not read global agent settings (" + response.statusCode + ")");
      }
      const configs = response.json();
      const config = Array.isArray(configs)
        ? configs.find((candidate) => candidate && typeof candidate === "object" && candidate.type === agentType)
        : null;
      return config ?? null;
    },
    async (agentType, patch) => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/agents/type/" + encodeURIComponent(agentType),
        headers: { "x-marinara-csrf": "1" },
        payload: patch,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error("Could not update global agent configuration (" + response.statusCode + ")");
      }
      return response.json();
    },
  );
  try {
    await app.register(register, { prefix: "/api/chats" });
    readinessStorage = createSpatialContextStorage();
    const cleanups = [
      cleanupRuntime,
      await registerLocationEffects(app),
      api.registerService("hierarchical-maps:projection", projection),
      api.registerService("hierarchical-maps:state-resolution", stateResolution),
      api.registerService("hierarchical-maps:owner-turn", ownerTurn),
      api.registerService("hierarchical-maps:game-map-binding", gameMapBinding),
      api.registerService("hierarchical-maps:storage", { create: () => createSpatialContextStorage() }),
    ];
    return async () => { readinessStorage = null; for (const cleanup of cleanups.reverse()) await cleanup(); };
  } catch (error) {
    readinessStorage = null;
    cleanupRuntime();
    throw error;
  }
}
export async function selfCheck({ api }) {
  if (!readinessStorage) throw new Error("World Maps storage did not initialize");
  if (typeof api.runtime.resources?.listCharacters !== "function") throw new Error("World Maps character resources are unavailable");
  if (typeof api.runtime.resources?.listEligibleLorebookEntries !== "function") throw new Error("World Maps lore resources are unavailable");
  if (typeof api.runtime.languageModels?.resolve !== "function") throw new Error("World Maps language model host is unavailable");
  if (typeof api.runtime.json?.parseJsonish !== "function") throw new Error("World Maps JSON parser is unavailable");
  await readinessStorage.listForChat("__marinara_capability_self_check__");
  await api.runtime.resources.listCharacters([]);
  await api.runtime.resources.listEligibleLorebookEntries({ lorebookIds: [], entryIds: [] });
  const parsed = api.runtime.json.parseJsonish('Preface\n{"ready":true}');
  if (!parsed || typeof parsed !== "object" || parsed.ready !== true) throw new Error("World Maps JSON parser self-check failed");
}
