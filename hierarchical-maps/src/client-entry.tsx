
import React, { useEffect, useRef, useState } from "react";
import { LocationBackgroundSync } from "./engine/packages/client/src/features/spatial-context/location-effects";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient as client } from "marinara:host";
import { SpatialContextSettingsSection } from "./engine/packages/client/src/features/spatial-context/SpatialContextSettingsSection.tsx";
import { SpatialMapsHome } from "./engine/packages/client/src/features/spatial-context/SpatialMapsHome.tsx";
import { SpatialMapWorkspace } from "./engine/packages/client/src/features/spatial-context/SpatialMapWorkspace.tsx";
import { SpatialMapLibrary } from "./engine/packages/client/src/features/spatial-context/SpatialMapLibrary.tsx";
import { SpatialContextRuntimeBar } from "./engine/packages/client/src/features/spatial-context/components/SpatialContextRuntimeBar.tsx";
import { GameWorldMap } from "./engine/packages/client/src/components/game/GameWorldMap.tsx";
import { useSpatialContext } from "./engine/packages/client/src/hooks/use-spatial-context.ts";
import { packageApi } from "./engine/packages/client/src/features/spatial-context/package-api.ts";
import { SpatialMapLocalizationProvider } from "./engine/packages/client/src/features/spatial-context/localization.tsx";
import { clearPendingSpatialTransition, getPendingSpatialTransition, reconcileCommittedSpatialTravel, setPendingSpatialTransition, setPendingSpatialTransitionStatus, usePendingSpatialTransition } from "./engine/packages/client/src/features/spatial-context/pending-spatial-transitions.ts";
import { findSpatialRoute } from "./engine/packages/client/src/features/spatial-context/spatial-route-plans.ts";
const workspaceStyles = "\n[data-marinara-maps-workspace-overlay] {\n  display: flex;\n  min-width: 0;\n  min-height: 0;\n  flex-direction: column;\n  isolation: isolate;\n  pointer-events: auto;\n  touch-action: manipulation;\n}\n\n[data-marinara-maps-workspace-overlay] > .mari-editor-shell,\n[data-marinara-maps-workspace-root] {\n  width: 100%;\n  height: 100%;\n  min-width: 0;\n  min-height: 0;\n  flex: 1 1 0%;\n  pointer-events: auto;\n}\n\n[data-marinara-maps-workspace-overlay] .mari-editor-header,\n[data-marinara-maps-workspace-overlay] .mari-editor-header button {\n  pointer-events: auto;\n  touch-action: manipulation;\n}\n\n[data-marinara-maps-workspace-overlay] [data-marinara-maps-editor-canvas] {\n  aspect-ratio: 1 / 1;\n  height: auto;\n  width: 100%;\n}\n\n[data-marinara-maps-workspace-overlay] .mari-editor-action,\n[data-marinara-maps-workspace-overlay] .mari-chrome-control {\n  min-width: 2.75rem;\n  min-height: 2.75rem;\n}\n\n[data-marinara-maps-workspace-overlay] [data-marinara-map-selected-location=\"true\"] {\n  border-color: var(--marinara-chat-chrome-accent) !important;\n  background: color-mix(in srgb, var(--marinara-chat-chrome-accent) 16%, var(--background) 84%) !important;\n  color: var(--marinara-chat-chrome-panel-title) !important;\n  box-shadow:\n    0 0 0 0.125rem var(--background),\n    0 0 0 0.25rem var(--marinara-chat-chrome-accent),\n    0 0.5rem 1.25rem rgba(0, 0, 0, 0.32);\n}\n\n[data-marinara-maps-runtime-popover] [data-marinara-map-selected-location=\"true\"] {\n  border-color: var(--marinara-chat-chrome-accent) !important;\n  background-color: Canvas !important;\n  background-color: rgb(from var(--background) r g b) !important;\n  background-image: linear-gradient(\n    color-mix(in srgb, var(--marinara-chat-chrome-accent) 16%, transparent),\n    color-mix(in srgb, var(--marinara-chat-chrome-accent) 16%, transparent)\n  ) !important;\n  color: var(--marinara-chat-chrome-panel-title) !important;\n  box-shadow:\n    0 0 0 0.125rem Canvas,\n    0 0 0 0.25rem var(--marinara-chat-chrome-accent),\n    0 0.5rem 1.25rem rgba(0, 0, 0, 0.32);\n}\n\n@media (max-width: 47.999rem) {\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-header-actions] {\n    display: contents;\n  }\n\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-more-control] {\n    flex: 0 0 auto;\n    width: auto;\n  }\n\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-more-control] > button {\n    position: relative;\n    width: 2.75rem;\n    padding-inline: 0;\n  }\n\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-more-label],\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-more-chevron],\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-save-label] {\n    display: none !important;\n  }\n\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-notice-count] {\n    position: absolute;\n    top: -0.3125rem;\n    right: -0.3125rem;\n  }\n\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-header-status] {\n    flex: 0 0 auto;\n    margin-right: 0;\n  }\n}\n\n@media (max-width: 21.25rem) {\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-header-title] {\n    display: none !important;\n  }\n}\n\n@media (max-width: 79.999rem) {\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-status-label] {\n    display: none !important;\n  }\n}\n\n@media (min-width: 64rem) {\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-compact-only],\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-notice-count] {\n    display: none !important;\n  }\n\n  .mari-maps-workspace-grid {\n    grid-template-columns: minmax(15rem, 18rem) minmax(20rem, 1fr) minmax(18rem, 22rem);\n  }\n\n  .mari-maps-ai-grid {\n    grid-template-columns: minmax(20rem, 0.9fr) minmax(22rem, 1.1fr);\n  }\n}\n\n@media (min-width: 64rem) and (max-width: 79.999rem) {\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-wide-only] {\n    display: none !important;\n  }\n}\n\n@media (min-width: 80rem) {\n  [data-marinara-maps-workspace-overlay] [data-marinara-map-mid-overflow] {\n    display: none !important;\n  }\n}\n";
const worldMapStyles = "\n[data-marinara-maps-world-canvas] {\n  aspect-ratio: 1 / 1;\n  height: auto;\n  width: 100%;\n}\n";
const runtimeStyles = "\n@media (max-width: 39.999rem) {\n  marinara-capability-hierarchical-maps[view=\"runtime\"] {\n    display: block;\n  }\n\n  [data-marinara-maps-runtime-root][data-runtime-layout=\"compact\"] {\n    width: 2.75rem;\n    height: 2.75rem;\n    margin-left: auto;\n    overflow: visible;\n    border: 0;\n    background: transparent;\n    box-shadow: none;\n  }\n\n  [data-marinara-maps-runtime-root][data-runtime-layout=\"compact\"][data-runtime-mode=\"game\"] {\n    height: 0;\n    margin-bottom: 0;\n    transform: translateY(-2.75rem);\n    pointer-events: none;\n    z-index: 110;\n  }\n\n  [data-marinara-maps-runtime-root][data-runtime-layout=\"compact\"][data-runtime-mode=\"game\"] [data-marinara-maps-runtime-mobile] {\n    pointer-events: auto;\n  }\n\n  [data-marinara-maps-runtime-root][data-runtime-layout=\"compact\"][data-runtime-mode=\"game\"] [data-marinara-maps-runtime-options] {\n    pointer-events: auto;\n  }\n\n  [data-marinara-maps-runtime-desktop] {\n    display: none !important;\n  }\n\n  [data-marinara-maps-runtime-mobile] {\n    display: flex !important;\n  }\n\n  [data-marinara-maps-runtime-popover] {\n    position: absolute;\n    right: 0;\n    bottom: calc(100% + 0.375rem);\n    z-index: 100;\n    width: min(22rem, calc(100vw - 1.5rem));\n    max-height: min(70dvh, 36rem);\n    background-color: var(--background) !important;\n    background-image: linear-gradient(\n      var(--marinara-chat-chrome-highlight-bg),\n      var(--marinara-chat-chrome-highlight-bg)\n    );\n    backdrop-filter: none;\n  }\n\n  [data-marinara-maps-runtime-options] {\n    position: absolute;\n    right: 0;\n    bottom: calc(100% + 0.375rem);\n    z-index: 100;\n    width: min(22rem, calc(100vw - 1.5rem));\n    max-height: min(70dvh, 36rem);\n    overflow-y: auto;\n    border: 1px solid var(--marinara-chat-chrome-panel-border);\n    border-radius: 0.75rem;\n    background-color: var(--background);\n    background-image: linear-gradient(\n      var(--marinara-chat-chrome-highlight-bg),\n      var(--marinara-chat-chrome-highlight-bg)\n    );\n    backdrop-filter: none;\n    box-shadow: 0 1.5rem 3rem rgb(0 0 0 / 45%);\n  }\n}\n\n@media (min-width: 40rem) {\n  [data-marinara-maps-runtime-mobile] {\n    display: none !important;\n  }\n}\n";
class CapabilityClientErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  componentDidCatch(error, info) {
    const message = error instanceof Error && error.message ? error.message : "Capability client runtime failed";
    this.props.element.capabilityRuntimeError = message;
    this.props.element.dispatchEvent(new CustomEvent("marinara-capability-runtime-error", { detail: { message }, bubbles: true }));
    console.error("World Maps client capability stopped", error, info);
  }
  retry() {
    this.props.element.capabilityRuntimeError = null;
    this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" className="m-3 flex items-start gap-3 rounded-lg border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 p-3"><span className="min-w-0 flex-1 text-xs text-[var(--foreground)]">World Maps stopped.</span><button type="button" onClick={() => this.retry()} className="min-h-11 min-w-11 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-3 text-xs font-medium text-[var(--foreground)]">Try again</button></div>;
  }
  static getDerivedStateFromError(error) { return { error }; }
}
const spatialEventSequence = new Map();
const spatialTransitionReviewMessages = new Map([
  ["spatial_transition_stale_definition", "The world map changed. Review the available destinations."],
  ["spatial_transition_stale_location", "The current location changed. Review the available destinations."],
]);
async function reconcileSpatialCapabilityEvent(detail) {
  if (detail?.packageId !== "hierarchical-maps" || typeof detail.chatId !== "string") return;
  const chatId = detail.chatId;
  const sequence = (spatialEventSequence.get(chatId) || 0) + 1;
  spatialEventSequence.set(chatId, sequence);
  const data = detail.data && typeof detail.data === "object" ? detail.data : null;
  const commandId = typeof data?.commandId === "string" ? data.commandId : null;
  if (detail.type === "spatial_transition_rejected") {
    const pending = getPendingSpatialTransition(chatId);
    if (commandId && pending?.transition.commandId === commandId) {
      const reviewMessage =
        typeof data?.message === "string" && data.message.trim()
          ? data.message.trim()
          : typeof data?.code === "string"
            ? spatialTransitionReviewMessages.get(data.code)
            : undefined;
      setPendingSpatialTransitionStatus(chatId, "needs_review", reviewMessage);
    }
    void client.invalidateQueries({ queryKey: ["spatial-context", chatId] });
    return;
  }
  let spatial;
  try {
    spatial = await packageApi.get("/chats/" + encodeURIComponent(chatId) + "/spatial-context");
  } catch {
    void client.invalidateQueries({ queryKey: ["spatial-context", chatId] });
    return;
  }
  if (!spatial || spatialEventSequence.get(chatId) !== sequence) return;
  client.setQueryData(["spatial-context", chatId], spatial);
  if (detail.type === "spatial_transition_committed" && commandId) {
    const pending = getPendingSpatialTransition(chatId);
    let travel = data?.travel;
    if (!travel && pending?.transition.commandId === commandId && pending.transition.travelMode === "step_by_step") {
      const currentLocationId = spatial.currentLocationId;
      const targetLocationId = pending.transition.destinationId;
      const remainingRoute = spatial.definition
        ? findSpatialRoute(spatial.definition, currentLocationId, targetLocationId)
        : null;
      if (currentLocationId === targetLocationId) {
        travel = {
          mode: "step_by_step",
          fromLocationId: pending.transition.expectedCurrentLocationId,
          targetLocationId,
          routeLocationIds: [targetLocationId],
          remainingLocationIds: [],
          complete: true,
        };
      } else if (currentLocationId && remainingRoute) {
        travel = {
          mode: "step_by_step",
          fromLocationId: pending.transition.expectedCurrentLocationId,
          targetLocationId,
          routeLocationIds: remainingRoute.locationIds,
          remainingLocationIds: remainingRoute.locationIds.slice(1),
          complete: false,
        };
      } else {
        setPendingSpatialTransitionStatus(chatId, "needs_review", "The accepted route could not be reconstructed.");
        return;
      }
    }
    if (travel?.mode === "step_by_step" && travel.complete === false) {
      reconcileCommittedSpatialTravel(chatId, spatial, travel);
    } else {
      clearPendingSpatialTransition(chatId, commandId);
    }
  }
}
window.addEventListener("marinara-capability-server-event", (event) => { void reconcileSpatialCapabilityEvent(event.detail); });
function PendingBridge({ chatId, onChange }) { const pending = usePendingSpatialTransition(chatId); const onChangeRef = useRef(onChange); useEffect(() => { onChangeRef.current = onChange; }, [onChange]); useEffect(() => { if (typeof onChangeRef.current === "function") onChangeRef.current(pending); }, [pending]); return null; }
function WorldMapView({ props, chatId, onOpenEditor, useParentScroll = false }) {
  const spatial = useSpatialContext(chatId);
  if (spatial.isLoading) return <div className="h-full min-h-32 space-y-2 rounded-lg border border-[var(--marinara-chat-chrome-panel-border)] p-3" aria-label="Loading world map"><span role="status" className="sr-only">Loading world map</span><div className="h-3 w-28 animate-pulse rounded bg-[var(--muted)]" /><div className="h-24 animate-pulse rounded-lg bg-[var(--muted)]/55" /></div>;
  if (spatial.isError) return <div role="alert" className="flex min-h-32 items-center gap-3 rounded-lg border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 p-3 text-xs"><span className="min-w-0 flex-1">The world map could not be loaded.</span><button type="button" onClick={() => void spatial.refetch()} className="min-h-11 rounded-lg px-3 font-semibold text-[var(--destructive)] hover:bg-[var(--destructive)]/10">Retry</button></div>;
  if (!spatial.data?.definition) return <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[var(--marinara-chat-chrome-panel-border)] px-4 text-center text-xs text-[var(--marinara-chat-chrome-accent)]">No world map yet. Create one from Agents → World Maps.</div>;
  if (!spatial.data.definition.enabled) return <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[var(--marinara-chat-chrome-panel-border)] px-4 text-center text-xs text-[var(--marinara-chat-chrome-accent)]">World map disabled. Its saved hierarchy and history are preserved.</div>;
  return <><style data-marinara-maps-world-styles>{worldMapStyles}</style><GameWorldMap chatId={chatId} spatial={spatial.data} disabled={props.disabled === true} compact={props.compact === true} useParentScroll={useParentScroll} onOpenEditor={onOpenEditor} /><PendingBridge chatId={chatId} onChange={props.onPendingTransitionChange} /></>;
}
function stopOverlayEvent(event) { event.stopPropagation(); }
function WorkspaceOverlay({ chatId, props, stagedTemplate, onClose, onOpenTemplates }) { return createPortal(<div data-chat-floating-panel data-marinara-maps-workspace-overlay className="fixed inset-0 isolate flex min-h-0 flex-col overflow-hidden bg-[var(--background)]" style={{ zIndex: 10020, backgroundColor: "var(--background)" }} onPointerDown={stopOverlayEvent} onMouseDown={stopOverlayEvent} onTouchStart={stopOverlayEvent} onClick={stopOverlayEvent}><style data-marinara-maps-workspace-styles>{workspaceStyles}</style><SpatialMapWorkspace chatId={chatId} debugMode={props.debugMode === true} stagedTemplate={stagedTemplate} pendingDraftReview={props.pendingDraftReview?.mode === "template" ? null : props.pendingDraftReview || null} onClearPendingDraftReview={() => props.onClearPendingDraftReview?.()} onDirtyChange={(dirty) => props.onDirtyChange?.(dirty)} onOpenLorebook={(lorebookId) => props.onOpenLorebook?.(lorebookId)} onLorebooksChanged={() => props.onLorebooksChanged?.()} onOpenTemplates={onOpenTemplates} onClose={onClose} /></div>, document.body); }
function LibraryOverlay({ chatId, props, setupSelection, startOverReplacement, onClose, onAppliedToChat, onSelectForSetup, onSelectSharedWorldForSetup }) { const sharedWorldSetupSupported = Array.isArray(props.supportedSelectionKinds) && props.supportedSelectionKinds.includes("shared-world"); return createPortal(<div data-chat-floating-panel data-marinara-maps-workspace-overlay className="fixed inset-0 isolate flex min-h-0 flex-col overflow-hidden bg-[var(--background)]" style={{ zIndex: 10020, backgroundColor: "var(--background)" }} onPointerDown={stopOverlayEvent} onMouseDown={stopOverlayEvent} onTouchStart={stopOverlayEvent} onClick={stopOverlayEvent}><style data-marinara-maps-workspace-styles>{workspaceStyles}</style><SpatialMapLibrary chatId={chatId || null} chatName={typeof props.chatName === "string" ? props.chatName : null} chatMode={typeof props.chatMode === "string" ? props.chatMode : null} enabledForChat={props.enabledForChat === true} startOverReplacement={startOverReplacement} onOpenLorebook={(lorebookId) => props.onOpenLorebook?.(lorebookId)} onLorebooksChanged={() => props.onLorebooksChanged?.()} onEnabledForChatChange={typeof props.onEnabledForChatChange === "function" ? props.onEnabledForChatChange : undefined} onAppliedToChat={onAppliedToChat} onSelectForSetup={setupSelection ? onSelectForSetup : undefined} onSelectSharedWorldForSetup={setupSelection && sharedWorldSetupSupported ? onSelectSharedWorldForSetup : undefined} onClose={onClose} /></div>, document.body); }
function SetupSharedWorldApply({ chatId, props }) {
  const attemptRef = useRef("");
  const onAppliedRef = useRef(props.onApplied);
  const onErrorRef = useRef(props.onError);
  onAppliedRef.current = props.onApplied;
  onErrorRef.current = props.onError;
  const selection = props.selection && typeof props.selection === "object" ? props.selection : null;
  const payload = selection?.payload && typeof selection.payload === "object" ? selection.payload : null;
  const worldId = typeof payload?.worldId === "string" ? payload.worldId.trim() : "";
  const worldName = typeof selection?.label === "string" ? selection.label.trim() : "";
  const expectedWorldRevision = Number.isSafeInteger(payload?.expectedWorldRevision) && payload.expectedWorldRevision > 0 ? payload.expectedWorldRevision : null;
  const valid = Boolean(payload?.kind === "shared-world" && worldId && worldName && selection?.id === worldId && expectedWorldRevision !== null);
  const attemptKey = valid ? chatId + ":" + worldId + ":" + expectedWorldRevision : chatId + ":invalid";
  useEffect(() => {
    if (attemptRef.current === attemptKey) return;
    attemptRef.current = attemptKey;
    if (!valid) {
      onErrorRef.current?.("The selected shared world could not be read. Return to the library and choose it again.");
      return;
    }
    let cancelled = false;
    void packageApi.get("/chats/" + encodeURIComponent(chatId) + "/spatial-context").then((spatial) => {
      if (cancelled) return null;
      return packageApi.post("/chats/" + encodeURIComponent(chatId) + "/spatial-context/shared-world/link", {
        worldId,
        expectedWorldRevision,
        expectedRevision: spatial?.definition?.revision ?? 0,
        expectedCurrentLocationId: spatial?.currentLocationId ?? null,
      });
    }).then((spatial) => {
      if (cancelled || !spatial) return;
      if (spatial.sharedWorld?.mode !== "linked" || spatial.sharedWorld?.worldId !== worldId) throw new Error("World Maps did not confirm the shared-world link.");
      client.setQueryData(["spatial-context", chatId], spatial);
      onAppliedRef.current?.({ worldId, worldName, worldRevision: spatial.sharedWorld.worldRevision });
    }).catch((error) => {
      if (!cancelled) onErrorRef.current?.(error instanceof Error ? error.message : "The shared world could not be linked.");
    });
    return () => { cancelled = true; };
  }, [attemptKey, chatId, expectedWorldRevision, valid, worldId, worldName]);
  return null;
}
function WorldMapOverlay({ chatId, props, onClose, onOpenEditor }) {
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return createPortal(<div data-chat-floating-panel data-marinara-maps-world-overlay className="fixed inset-0 isolate flex min-h-0 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]" style={{ zIndex: 10020, backgroundColor: "var(--background)" }}>
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--background)] px-3 sm:px-5">
      <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-[var(--marinara-chat-chrome-accent)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" aria-label="Back to World Maps">Back</button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">World map</h1>
        <p className="truncate text-[0.625rem] text-[var(--marinara-chat-chrome-accent)]">{typeof props.chatName === "string" ? props.chatName : "Current story"}</p>
      </div>
      <button type="button" onClick={onOpenEditor} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 text-xs font-semibold hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">Edit map</button>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-5xl">
        <p className="mb-4 max-w-2xl text-xs leading-relaxed text-[var(--marinara-chat-chrome-accent)]">Browse nested places and linked routes. Choose step-by-step travel for one hop per turn, or travel now along the full route.</p>
        <WorldMapView props={props} chatId={chatId} useParentScroll />
      </div>
    </main>
  </div>, document.body);
}
function Root({ element }) {
  const [, redraw] = useState(0);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryStartOver, setLibraryStartOver] = useState(false);
  const [stagedTemplate, setStagedTemplate] = useState(null);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const previousPendingRef = useRef({ chatId: "", pending: null });
  useEffect(() => {
    const update = () => redraw((value) => value + 1);
    element.addEventListener("marinara-capability-props", update);
    return () => element.removeEventListener("marinara-capability-props", update);
  }, [element]);
  const props = element.capabilityProps || {};
  const chatId = typeof props.chatId === "string" ? props.chatId : "";
  const view = element.getAttribute("view");
  const setupTemplatePending = props.pendingDraftReview?.mode === "template";
  const pendingSetupTemplate = setupTemplatePending && props.pendingDraftReview?.selection?.payload && typeof props.pendingDraftReview.selection.payload === "object" ? props.pendingDraftReview.selection.payload : null;
  const setupTemplateNeedsSelection = setupTemplatePending && !pendingSetupTemplate;
  useEffect(() => {
    if (!chatId || !setupTemplateNeedsSelection) return;
    setWorkspaceOpen(false);
    setLibraryOpen(true);
  }, [chatId, setupTemplateNeedsSelection]);
  useEffect(() => {
    if (!chatId) return;
    const previous = previousPendingRef.current;
    const nextPending = props.pendingTransition && typeof props.pendingTransition === "object" ? props.pendingTransition : null;
    if (nextPending) setPendingSpatialTransition(chatId, nextPending);
    else {
      const previousCommandId = previous.chatId === chatId ? previous.pending?.transition?.commandId : undefined;
      clearPendingSpatialTransition(chatId, previousCommandId);
      if (previous.chatId === chatId && previous.pending) void client.invalidateQueries({ queryKey: ["spatial-context", chatId] });
    }
    previousPendingRef.current = { chatId, pending: nextPending };
  }, [chatId, props.pendingTransition]);
  const closeWorkspace = () => {
    props.onClearPendingDraftReview?.();
    setStagedTemplate(null);
    setWorkspaceOpen(false);
    if (view !== "detail") props.onClose?.();
  };
  const editFromWorldMap = () => {
    setWorldMapOpen(false);
    setWorkspaceOpen(true);
  };
  const closeLibrary = () => {
    if (setupTemplateNeedsSelection) {
      props.onClearPendingDraftReview?.();
      props.onClose?.();
      return;
    }
    setLibraryOpen(false);
    setLibraryStartOver(false);
  };
  const selectTemplateForSetup = (template) => {
    if (view === "setup") {
      props.onSelect?.({ kind: "template", id: template.id, label: template.name, payload: template });
      props.onClose?.();
      return;
    }
    setStagedTemplate(template);
    props.onClearPendingDraftReview?.();
    setLibraryOpen(false);
    setWorkspaceOpen(true);
  };
  const selectSharedWorldForSetup = (world) => {
    props.onSelect?.({
      kind: "shared-world",
      id: world.id,
      label: world.name,
      payload: { kind: "shared-world", worldId: world.id, expectedWorldRevision: world.revision },
    });
    props.onClose?.();
  };
  let content = null;
  if (view === "setup-apply") content = chatId ? <SetupSharedWorldApply chatId={chatId} props={props} /> : null;
  else if (view === "setup") content = <LibraryOverlay chatId="" props={props} setupSelection onSelectForSetup={selectTemplateForSetup} onSelectSharedWorldForSetup={selectSharedWorldForSetup} onClose={() => props.onClose?.()} />;
  else if (libraryOpen) content = <LibraryOverlay chatId={chatId} props={props} setupSelection={setupTemplateNeedsSelection} startOverReplacement={libraryStartOver} onSelectForSetup={selectTemplateForSetup} onClose={closeLibrary} onAppliedToChat={() => { setLibraryOpen(false); setLibraryStartOver(false); setWorkspaceOpen(true); }} />;
  else if (workspaceOpen && chatId) content = <WorkspaceOverlay chatId={chatId} props={props} stagedTemplate={stagedTemplate || pendingSetupTemplate} onClose={closeWorkspace} onOpenTemplates={(options) => { setLibraryStartOver(options?.startOver === true); setLibraryOpen(true); }} />;
  else if (worldMapOpen && chatId) content = <WorldMapOverlay chatId={chatId} props={props} onClose={() => setWorldMapOpen(false)} onOpenEditor={editFromWorldMap} />;
  else if (view === "detail") content = <><SpatialMapsHome chatId={chatId || null} chatName={typeof props.chatName === "string" ? props.chatName : null} chatMode={typeof props.chatMode === "string" ? props.chatMode : null} enabledForChat={props.enabledForChat === true} packageInfo={props.package || null} agentInfo={props.agent || null} onEnabledForChatChange={typeof props.onEnabledForChatChange === "function" ? props.onEnabledForChatChange : undefined} onOpenMap={() => setWorldMapOpen(true)} onOpenEditor={() => setWorkspaceOpen(true)} onOpenLibrary={() => setLibraryOpen(true)} onManagePackage={typeof props.onManagePackage === "function" ? props.onManagePackage : undefined} confirmAction={typeof props.confirmAction === "function" ? props.confirmAction : undefined} onDirtyChange={typeof props.onDirtyChange === "function" ? props.onDirtyChange : undefined} onClose={typeof props.onClose === "function" ? props.onClose : undefined} /></>;
  else if (chatId && view === "runtime") content = <><style data-marinara-maps-world-styles>{worldMapStyles}</style><style data-marinara-maps-runtime-styles>{runtimeStyles}</style><SpatialContextRuntimeBar chatId={chatId} disabled={props.disabled === true} onOpenEditor={() => setWorkspaceOpen(true)} /><PendingBridge chatId={chatId} onChange={props.onPendingTransitionChange} /></>;
  else if (chatId && view === "world-map") content = <WorldMapView props={props} chatId={chatId} onOpenEditor={() => setWorkspaceOpen(true)} />;
  else if (chatId && view === "workspace") content = <WorkspaceOverlay chatId={chatId} props={props} stagedTemplate={stagedTemplate || pendingSetupTemplate} onClose={closeWorkspace} onOpenTemplates={(options) => { setLibraryStartOver(options?.startOver === true); setLibraryOpen(true); }} />;
  else if (chatId) content = <><SpatialContextSettingsSection chatId={chatId} style={props.style} enabledForChat={props.enabledForChat === true} onEnabledForChatChange={typeof props.onEnabledForChatChange === "function" ? props.onEnabledForChatChange : undefined} onOpenEditor={() => setWorkspaceOpen(true)} /></>;
  return <SpatialMapLocalizationProvider localization={props.localization}><LocationBackgroundSync chatId={chatId} />{content}</SpatialMapLocalizationProvider>;
}
class Element extends HTMLElement { connectedCallback() { if (!this.__root) this.__root = createRoot(this); this.__root.render(<QueryClientProvider client={client}><CapabilityClientErrorBoundary element={this}><Root element={this} /></CapabilityClientErrorBoundary></QueryClientProvider>); } disconnectedCallback() { queueMicrotask(() => { if (!this.isConnected && this.__root) { this.__root.unmount(); this.__root = null; } }); } }
if (!customElements.get("marinara-capability-hierarchical-maps")) customElements.define("marinara-capability-hierarchical-maps", Element);
