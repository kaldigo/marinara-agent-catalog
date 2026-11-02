import { resolveSpatialBreadcrumb } from "@marinara-engine/shared";
import { formatWorldStateLocation } from "../../../../maps-shared/src/world-state-location.js";
import { record } from "../../../../maps-shared/src/location-effects.js";
import { getPackagePersistence } from "./package-runtime.js";
import { resolveEffectiveSpatialState } from "./state-resolution.js";

type Writer = (chatId: string, location: string) => Promise<void>;
let writeLocation: Writer | null = null;
const pending = new Map<string, { again: boolean; promise: Promise<void> }>();

export function configureWorldStateLocationWriter(writer: Writer) {
  writeLocation = writer;
  return () => { if (writeLocation === writer) writeLocation = null; };
}

/** Run outside the Maps metadata transaction: the native tracker route owns its write. */
export async function synchronizeWorldStateLocation(chatId: string): Promise<void> {
  const previous = pending.get(chatId);
  if (previous) { previous.again = true; return previous.promise; }
  const entry = { again: false, promise: Promise.resolve() };
  entry.promise = (async () => {
    do {
      entry.again = false;
      if (!writeLocation) return;
      const chat = await getPackagePersistence().getChat(chatId);
      if (!chat || (chat.mode !== "roleplay" && chat.mode !== "game")) return;
      const metadata = record(chat.metadata);
      if (metadata.enableAgents !== true || !Array.isArray(metadata.activeAgentIds) || !metadata.activeAgentIds.includes("hierarchical-maps")) return;
      const state = await resolveEffectiveSpatialState(chatId);
      if (!state.definition?.enabled || !state.currentLocationId) return;
      const current = state.definition.locations.find(location => location.id === state.currentLocationId && location.status === "active");
      if (!current) return;
      await writeLocation(chatId, formatWorldStateLocation(resolveSpatialBreadcrumb(state.definition, current.id)));
    } while (entry.again);
  })().finally(() => pending.delete(chatId));
  pending.set(chatId, entry);
  return entry.promise;
}
