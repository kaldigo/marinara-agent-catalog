import { z } from "zod";
import { pendingSpatialTransitionSchema, validateSpatialTransition } from "@marinara-engine/shared";
import { LOCATION_EFFECTS_KEY, record } from "../../../../maps-shared/src/location-effects.js";
import { configureLocationImageResolver, synchronizeLocationEffects, synchronizeLocationEffectsInSession } from "./location-effects.js";
import { getPackagePersistence, logger } from "./package-runtime.js";
import { resolveEffectiveSpatialState } from "./state-resolution.js";

const updateSchema = z.object({
  backgroundEnabled: z.boolean().optional(),
  locationId: z.string().min(1).max(200).optional(),
  excludedEntryIds: z.array(z.string().min(1).max(200)).max(512).optional(),
}).strict().refine(value => (value.locationId !== undefined) === (value.excludedEntryIds !== undefined), "Choose a location and its excluded entries together.");

/** Fastify lifecycle hooks run before native handlers read chat metadata and before mutation replies are sent. */
export async function registerLocationEffects(app: any) {
  let active = true;
  const unbind = configureLocationImageResolver(async (chatId, referenceId) => {
    const globalPrefix = "global-gallery:";
    const isGlobal = referenceId.startsWith(globalPrefix);
    const id = isGlobal ? referenceId.slice(globalPrefix.length) : referenceId;
    try {
      const response = await app.inject({ method: "GET", url: isGlobal ? "/api/global-gallery" : `/api/gallery/${encodeURIComponent(chatId)}` });
      if (response.statusCode !== 200) return undefined;
      const images = response.json();
      const image = Array.isArray(images) ? images.find(candidate => candidate.id === id) : null;
      if (image?.url) return image.url;
      // Legacy reference IDs can also be unprefixed global gallery IDs.
      if (!isGlobal) {
        const global = await app.inject({ method: "GET", url: "/api/global-gallery" });
        if (global.statusCode !== 200) return undefined;
        const all = global.json();
        const match = Array.isArray(all) ? all.find(candidate => candidate.id === id) : null;
        return match?.url ?? null;
      }
      return null;
    } catch (error) { logger.warn("Location background image lookup failed: %s", error); return undefined; }
  });
  const pathOf = (request: any) => request.url.split("?")[0];
  const chatFromPath = (request: any) => {
    const match = /^\/api\/chats\/([^/]+)(?:\/|$)/.exec(pathOf(request));
    if (!match || match[1] === "spatial-context") return null;
    try { return decodeURIComponent(match[1]); } catch { return null; }
  };
  app.addHook("preHandler", async (request: any) => {
    if (!active || request.method !== "POST" || !/^\/api\/generate\/?$/.test(pathOf(request))) return;
    if (typeof request.body?.chatId !== "string") return;
    const chatId = request.body.chatId;
    const pending = pendingSpatialTransitionSchema.safeParse(request.body.pendingSpatialTransition);
    if (pending.success) {
      const state = await resolveEffectiveSpatialState(chatId);
      if (state.definition) {
        const validation = validateSpatialTransition(state.definition, state.currentLocationId, pending.data);
        if (validation.ok) {
          // Engine snapshots chat metadata before committing a pending move. Prepare its
          // validated destination now; the native owner-turn still owns the movement.
          await synchronizeLocationEffects(chatId, { definition: state.definition, currentLocationId: validation.destination.id });
          return;
        }
      }
    }
    await synchronizeLocationEffects(chatId);
  });
  app.addHook("onSend", async (request: any, reply: any, payload: any) => {
    if (!active || !["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return payload;
    if (/^\/api\/generate\/?$/.test(pathOf(request)) && typeof request.body?.chatId === "string") {
      // A rejected or failed request may not have committed its proposed movement.
      await synchronizeLocationEffects(request.body.chatId);
      return payload;
    }
    if (reply.statusCode >= 400) return payload;
    const chatId = chatFromPath(request);
    if (!chatId) return payload;
    const result = await synchronizeLocationEffects(chatId);
    // Native chat responses should reflect the metadata saved before this response leaves the server.
    if (result && typeof payload === "string") {
      try { const value = JSON.parse(payload); if (value?.id === chatId && Object.hasOwn(value, "metadata")) return JSON.stringify({ ...value, metadata: typeof value.metadata === "string" ? JSON.stringify(result.metadata) : result.metadata }); } catch {}
    }
    return payload;
  });
  await app.register(async (routes: any) => {
    routes.get("/:chatId/spatial-context/location-effects", async (request: any, reply: any) => {
      const chat = await getPackagePersistence().getChat(request.params.chatId);
      if (!chat) return reply.code(404).send({ error: "Chat not found" });
      const settings = record(record(chat.metadata)[LOCATION_EFFECTS_KEY]);
      return { mode: chat.mode, backgroundEnabled: settings.backgroundEnabled === true, excludedEntriesByLocation: record(settings.excludedEntriesByLocation) };
    });
    routes.patch("/:chatId/spatial-context/location-effects", async (request: any, reply: any) => {
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
      const chatId = request.params.chatId;
      const host = getPackagePersistence();
      return host.withChatLock(chatId, async () => {
        const chat = await host.getChat(chatId);
        if (!chat) return reply.code(404).send({ error: "Chat not found" });
        const value = parsed.data;
        const settings = record(record(chat.metadata)[LOCATION_EFFECTS_KEY]);
        const patch: Record<string, unknown> = {};
        if (value.backgroundEnabled !== undefined) patch.backgroundEnabled = value.backgroundEnabled;
        if (value.locationId) {
          const state = await resolveEffectiveSpatialState(chatId);
          if (!state.definition?.locations.some(location => location.id === value.locationId)) return reply.code(404).send({ error: "Save this location before configuring its exclusions." });
          patch.excludedEntriesByLocation = { ...record(settings.excludedEntriesByLocation), [value.locationId]: [...new Set(value.excludedEntryIds)] };
        }
        // Already under the host's chat lock; avoid taking the metadata queue a second time.
        const result = await host.transaction(session => synchronizeLocationEffectsInSession(session, chatId, { settingsPatch: patch }));
        const saved = record(result?.metadata[LOCATION_EFFECTS_KEY]);
        return { mode: chat.mode, backgroundEnabled: saved.backgroundEnabled === true, excludedEntriesByLocation: record(saved.excludedEntriesByLocation) };
      });
    });
  }, { prefix: "/api/chats" });
  app.addHook("onError", async (request: any) => {
    if (active && /^\/api\/generate\/?$/.test(pathOf(request)) && typeof request.body?.chatId === "string") {
      await synchronizeLocationEffects(request.body.chatId);
    }
  });
  // Native gallery requests cannot run during capability activation: app.inject would
  // wait for app.ready while app.ready is waiting for us. Reconcile after listening.
  app.addHook("onListen", async () => {
    if (!active) return;
    for (const chat of await getPackagePersistence().listChats()) {
      const settings = record(record(chat.metadata)[LOCATION_EFFECTS_KEY]);
      if (settings.disabledEntries || settings.backgroundEnabled) await synchronizeLocationEffects(chat.id);
    }
  });
  return async () => {
    active = false;
    try {
      for (const chat of await getPackagePersistence().listChats()) {
        const settings = record(record(chat.metadata)[LOCATION_EFFECTS_KEY]);
        if (settings.disabledEntries || settings.background) await synchronizeLocationEffects(chat.id, { release: true });
      }
    } finally { unbind(); }
  };
}
