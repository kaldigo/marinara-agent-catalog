import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LorebookEntry } from "@marinara-engine/shared";
import { packageApi } from "./package-api";
import { useSpatialContext } from "../../hooks/use-spatial-context";
import { chatBackgroundMetadataToUrl } from "../../lib/backgrounds";
import { record } from "../../../../maps-shared/src/location-effects";

type Effects = { mode: string; backgroundEnabled: boolean; excludedEntriesByLocation: Record<string, string[]> };
const key = (chatId: string) => ["world-maps-kaldigo-effects", chatId] as const;
function useEffects(chatId: string) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key(chatId), queryFn: () => packageApi.get<Effects>(`/chats/${encodeURIComponent(chatId)}/spatial-context/location-effects`), enabled: Boolean(chatId) });
  const update = useMutation({
    mutationFn: (value: { backgroundEnabled?: boolean; locationId?: string; excludedEntryIds?: string[] }) => packageApi.patch<Effects>(`/chats/${encodeURIComponent(chatId)}/spatial-context/location-effects`, value),
    onSuccess: async value => { client.setQueryData(key(chatId), value); await client.invalidateQueries({queryKey: ["chats", "detail", chatId]}); },
  });
  return { query, update };
}

export function LocationBackgroundControl({ chatId }: { chatId: string }) {
  const { query, update } = useEffects(chatId);
  if (!chatId || (query.data && query.data.mode !== "roleplay")) return null;
  return <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
    <label className="flex min-h-11 items-center gap-3 text-xs">
      <input type="checkbox" aria-label="Use location image as chat background" checked={update.isPending && update.variables?.backgroundEnabled !== undefined ? update.variables.backgroundEnabled : query.data?.backgroundEnabled === true} disabled={!query.data || update.isPending} onChange={event => update.mutate({backgroundEnabled:event.target.checked})} />
      Use location image as chat background
    </label>
    <p className="text-[0.625rem] text-[var(--muted-foreground)]">Use the current location’s reference image. Restore your previous background when the location has no image or this option is turned off.</p>
    {(query.isError || update.isError) && <p role="alert" className="text-xs text-[var(--destructive)]">{(update.error ?? query.error)?.message}</p>}
  </div>;
}

export function LocationLoreExclusions({chatId,locationId,entries}:{chatId:string;locationId:string;entries:LorebookEntry[]}) {
  const {query,update}=useEffects(chatId);
  const [search,setSearch]=useState("");
  const selected=update.isPending && update.variables?.locationId===locationId ? update.variables.excludedEntryIds ?? [] : query.data?.excludedEntriesByLocation[locationId] ?? [];
  const ids=[...new Set([...selected,...entries.filter(entry=>!search.trim() || entry.name.toLowerCase().includes(search.trim().toLowerCase())).map(entry=>entry.id)])];
  const byId=new Map(entries.map(entry=>[entry.id,entry]));
  if(!chatId) return null;
  return <details className="rounded-xl border border-[var(--marinara-chat-chrome-panel-border)] p-3" data-location-lore-exclusions>
    <summary className="min-h-11 cursor-pointer text-xs font-semibold">Excluded lore here ({selected.length})</summary>
    <p className="mb-3 text-[0.6875rem] text-[var(--marinara-chat-chrome-panel-muted)]">Keep selected entries out of this chat while this exact location is current. Parent and child locations do not inherit exclusions. Save new locations before configuring exclusions.</p>
    <input aria-label="Search lore exclusions" placeholder="Search lore entries" value={search} onChange={event=>setSearch(event.target.value)} className="mb-2 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs" />
    <div className="max-h-72 overflow-auto">{ids.map(id=><label key={id} className="flex min-h-11 items-center gap-3 text-xs">
      <input type="checkbox" aria-label={`Exclude ${byId.get(id)?.name ?? "Missing entry"} here`} checked={selected.includes(id)} disabled={!query.data || update.isPending} onChange={event=>update.mutate({locationId,excludedEntryIds:event.target.checked?[...selected,id]:selected.filter(value=>value!==id)})}/>
      {byId.get(id)?.name ?? "Missing entry"}
    </label>)}</div>
    {(query.isError || update.isError) && <p role="alert" className="text-xs text-[var(--destructive)]">{(update.error ?? query.error)?.message}</p>}
  </details>;
}

/** Native store and shared query cache only; no DOM observers, polling or second background renderer. */
export function LocationBackgroundSync({chatId}:{chatId:string}) {
  const client=useQueryClient();
  const spatial=useSpatialContext(chatId);
  const previouslyManaged=useRef(false);
  const chat=useQuery({queryKey:["chats","detail",chatId],queryFn:()=>packageApi.get<any>(`/chats/${encodeURIComponent(chatId)}`),enabled:Boolean(chatId)});
  useEffect(()=>{if(chatId && spatial.dataUpdatedAt) void client.invalidateQueries({queryKey:["chats","detail",chatId]});},[chatId,spatial.dataUpdatedAt,client]);
  useEffect(()=>{
    const metadata=record(chat.data?.metadata);
    const settings=record(metadata.worldMapsKaldigo);
    const managed=Boolean(settings.background);
    const host=globalThis.__MARINARA_HOST__;
    if(host?.stores.chat.getState().activeChatId===chatId && (managed || previouslyManaged.current)) {
      const url=chatBackgroundMetadataToUrl(metadata.background);
      if(host.stores.ui.getState().chatBackground!==url) host.stores.ui.getState().setChatBackground(url);
    }
    previouslyManaged.current=managed;
  },[chatId,chat.data]);
  return null;
}
