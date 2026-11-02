import type { CapabilityPersistenceSession, SpatialContextDefinition } from "@marinara-engine/shared";
import { applyLocationEffects, LOCATION_EFFECTS_KEY, record } from "../../../../maps-shared/src/location-effects.js";
import { resolveEffectiveSpatialState } from "./state-resolution.js";
import { getPackagePersistence, now } from "./package-runtime.js";

let resolveImage: ((chatId: string, referenceId: string) => Promise<string | null | undefined>) | null = null;
export function configureLocationImageResolver(resolver: NonNullable<typeof resolveImage>) {
  resolveImage = resolver;
  return () => { if (resolveImage === resolver) resolveImage = null; };
}

/** Called under the chat lock, including in the transaction that commits movement. */
export async function synchronizeLocationEffectsInSession(session: CapabilityPersistenceSession, chatId: string, options: { definition?: SpatialContextDefinition | null; currentLocationId?: string | null; release?: boolean; settingsPatch?: Record<string, unknown> } = {}) {
  const chat = await session.getChat(chatId);
  if (!chat) return null;
  const original = record(chat.metadata);
  let metadata = original;
  if (options.settingsPatch) metadata = { ...metadata, [LOCATION_EFFECTS_KEY]: { ...record(metadata[LOCATION_EFFECTS_KEY]), ...options.settingsPatch } };
  if (!Object.keys(record(metadata[LOCATION_EFFECTS_KEY])).length) return { metadata: original, excludedIds: [], currentLocationId: null };
  const state = options.definition !== undefined
    ? { definition: options.definition, currentLocationId: options.currentLocationId ?? null }
    : await resolveEffectiveSpatialState(chatId, {}, session);
  const settings = record(metadata[LOCATION_EFFECTS_KEY]);
  const active = !options.release && (chat.mode === "roleplay" || chat.mode === "game") && metadata.enableAgents === true
    && Array.isArray(metadata.activeAgentIds) && metadata.activeAgentIds.includes("hierarchical-maps") && state.definition?.enabled;
  const current = active ? state.definition?.locations.find(location => location.id === state.currentLocationId && location.status === "active") : null;
  const excluded = current ? record(settings.excludedEntriesByLocation)[current.id] : [];
  const excludedIds = Array.isArray(excluded) ? excluded.filter((id): id is string => typeof id === "string") : [];
  let image: string | null | undefined = null;
  if (chat.mode === "roleplay" && current && settings.backgroundEnabled === true && current.referenceImageId) {
    // An unavailable gallery is not evidence that an image was removed. Keep the last background on read failures.
    image = resolveImage ? await resolveImage(chatId, current.referenceImageId) : undefined;
  }
  const next = applyLocationEffects(metadata, excludedIds, image, current?.id ?? null);
  if (JSON.stringify(original) !== JSON.stringify(next)) await session.updateChatMetadata({ chatId, metadata: next, updatedAt: now() });
  return { metadata: next, excludedIds, currentLocationId: current?.id ?? null };
}

export async function synchronizeLocationEffects(chatId: string, options: Parameters<typeof synchronizeLocationEffectsInSession>[2] = {}) {
  const host = getPackagePersistence();
  return host.withChatLock(chatId, () => host.transaction(session => synchronizeLocationEffectsInSession(session, chatId, options)));
}
