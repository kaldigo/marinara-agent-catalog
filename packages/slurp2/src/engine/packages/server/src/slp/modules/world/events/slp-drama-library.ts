/**
 * The drama catalog (`docs/DRAMA.md`): the situations and dramas Slurp ships, plus the ones imported
 * from Story Packs. Pure. Which entries run is the `drama.enabled` setting; nothing runs by default.
 *
 * Imported entries live in their own app setting (`slurp2.drama.library`), keyed by pack and id, so a
 * pack imported again updates its own entries and never another pack's.
 */
import {
  slpDramaSchema,
  slpSituationSchema,
  type SlpDrama,
  type SlpSituation,
} from "../../../../../../shared/src/slp/slp-drama.js";
import { SLURP_BUILTIN_DRAMAS, SLURP_BUILTIN_SITUATIONS } from "./slp-drama-packs.js";

export const SLP_DRAMA_LIBRARY_KEY = "slurp2.drama.library";

export type SlpDramaLibrary = {
  situations: (SlpSituation & { packId: string })[];
  dramas: (SlpDrama & { packId: string })[];
};
export const SLP_EMPTY_DRAMA_LIBRARY: SlpDramaLibrary = { situations: [], dramas: [] };

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Lenient: an entry that no longer passes the schema is dropped, the rest reads back. */
export function readSlpDramaLibrary(raw: unknown): SlpDramaLibrary {
  const value = record(raw);
  const read = <T>(list: unknown, parse: (entry: unknown) => T | null) =>
    (Array.isArray(list) ? list : []).flatMap((entry) => {
      const packId = typeof record(entry)?.packId === "string" ? (record(entry)!.packId as string) : "";
      const parsed = packId ? parse(entry) : null;
      return parsed ? [{ ...parsed, packId }] : [];
    });
  return {
    situations: read(value?.situations, (entry) => {
      const { packId: _packId, ...rest } = record(entry)!;
      const parsed = slpSituationSchema.safeParse(rest);
      return parsed.success ? parsed.data : null;
    }),
    dramas: read(value?.dramas, (entry) => {
      const { packId: _packId, ...rest } = record(entry)!;
      const parsed = slpDramaSchema.safeParse(rest);
      return parsed.success ? parsed.data : null;
    }),
  };
}

export type SlpDramaCatalog = { situations: SlpSituation[]; dramas: SlpDrama[] };

/** Everything that could run: the built-ins, then imported entries (an imported id never hides a built-in). */
export function slpDramaCatalog(library: SlpDramaLibrary): SlpDramaCatalog {
  const builtinSituations = new Set(SLURP_BUILTIN_SITUATIONS.map((entry) => entry.id));
  const builtinDramas = new Set(SLURP_BUILTIN_DRAMAS.map((entry) => entry.id));
  return {
    situations: [
      ...SLURP_BUILTIN_SITUATIONS,
      ...library.situations
        .filter((entry) => !builtinSituations.has(entry.id))
        .map(({ packId: _packId, ...entry }) => entry),
    ],
    dramas: [
      ...SLURP_BUILTIN_DRAMAS,
      ...library.dramas.filter((entry) => !builtinDramas.has(entry.id)).map(({ packId: _packId, ...entry }) => entry),
    ],
  };
}

/** Only the entries the player switched on (`drama.enabled`), and a drama only with its situation on. */
export function slpEnabledDrama(catalog: SlpDramaCatalog, enabled: readonly string[]): SlpDramaCatalog {
  const on = new Set(enabled);
  const situations = catalog.situations.filter((entry) => on.has(entry.id));
  const standing = new Set(situations.map((entry) => entry.id));
  return {
    situations,
    dramas: catalog.dramas.filter(
      (entry) => on.has(entry.id) && (!entry.requires || standing.has(entry.requires.situation)),
    ),
  };
}

export type SlpDramaPreviewStatus = "new" | "update" | "conflict";

/** How an imported entry would land: new, an update of the same pack's entry, or an id another pack or Slurp uses. */
export function slpDramaPreviewStatus(
  library: SlpDramaLibrary,
  packId: string,
  kind: "situation" | "drama",
  id: string,
): SlpDramaPreviewStatus {
  const list = kind === "situation" ? library.situations : library.dramas;
  const builtin = (kind === "situation" ? SLURP_BUILTIN_SITUATIONS : SLURP_BUILTIN_DRAMAS).some(
    (entry) => entry.id === id,
  );
  const installed = list.find((entry) => entry.id === id);
  if (builtin || (installed && installed.packId !== packId)) return "conflict";
  return installed ? "update" : "new";
}

/** Writes chosen entries into the library: new ones are added, the same pack's entries replaced; conflicts skipped. */
export function applySlpDramaEntries(
  library: SlpDramaLibrary,
  packId: string,
  entries: readonly ({ kind: "situation"; value: SlpSituation } | { kind: "drama"; value: SlpDrama })[],
): SlpDramaLibrary {
  const next: SlpDramaLibrary = { situations: [...library.situations], dramas: [...library.dramas] };
  for (const entry of entries) {
    if (slpDramaPreviewStatus(next, packId, entry.kind, entry.value.id) === "conflict") continue;
    // Imported entries arrive switched off in the catalog; `enabled` is the player's setting, not the pack's.
    const stored = { ...entry.value, enabled: false, builtin: false, packId };
    if (entry.kind === "situation")
      next.situations = [
        ...next.situations.filter((item) => item.id !== entry.value.id),
        stored as SlpDramaLibrary["situations"][number],
      ];
    else
      next.dramas = [
        ...next.dramas.filter((item) => item.id !== entry.value.id),
        stored as SlpDramaLibrary["dramas"][number],
      ];
  }
  return next;
}
