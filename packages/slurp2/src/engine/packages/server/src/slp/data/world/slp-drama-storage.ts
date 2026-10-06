/**
 * Drama's two app settings (`docs/DRAMA.md`): the imported library of situations and dramas, and the
 * running state (what runs, who plays whom, what is queued). Each change goes through one queue.
 */
import type { DB } from "../../../db/connection.js";
import { createAppSettingsStorage } from "../../../services/storage/app-settings.storage.js";
import {
  readSlpDramaLibrary,
  SLP_DRAMA_LIBRARY_KEY,
  type SlpDramaLibrary,
} from "../../modules/world/events/slp-drama-library.js";
import { readSlpDramaState, type SlpDramaState } from "../../modules/world/events/slp-drama-runtime.js";

const parse = (raw: string | null | undefined): unknown => {
  try {
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
};

export async function readSlurpDramaLibrary(db: DB): Promise<SlpDramaLibrary> {
  return readSlpDramaLibrary(parse(await createAppSettingsStorage(db).get(SLP_DRAMA_LIBRARY_KEY)));
}

export async function writeSlurpDramaLibrary(db: DB, library: SlpDramaLibrary): Promise<void> {
  await createAppSettingsStorage(db).set(SLP_DRAMA_LIBRARY_KEY, JSON.stringify(library));
}

export const SLP_DRAMA_STATE_KEY = "slurp2.drama.state";

/** The running state, and when the world last moved it (the dispatcher runs more often than that). */
export type SlurpDramaStored = { state: SlpDramaState; advancedAt: string | null };

export async function readSlurpDramaState(db: DB): Promise<SlurpDramaStored> {
  const value = parse(await createAppSettingsStorage(db).get(SLP_DRAMA_STATE_KEY)) as Record<string, unknown> | null;
  return {
    state: readSlpDramaState(value?.state),
    advancedAt: typeof value?.advancedAt === "string" ? value.advancedAt : null,
  };
}

// ponytail: an in-process queue, like the ties document; the world tick holds a database lease.
let queue: Promise<unknown> = Promise.resolve();

/** Read, change, write, one at a time. `change` returning null writes nothing. */
export function mutateSlurpDramaState<T>(
  db: DB,
  change: (stored: SlurpDramaStored) => { stored: SlurpDramaStored; result: T } | null,
): Promise<T | null> {
  const run = queue.then(async () => {
    const next = change(await readSlurpDramaState(db));
    if (!next) return null;
    await createAppSettingsStorage(db).set(SLP_DRAMA_STATE_KEY, JSON.stringify(next.stored));
    return next.result;
  });
  queue = run.catch(() => undefined);
  return run;
}
