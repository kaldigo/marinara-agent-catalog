import {
  CAPABILITY_SLOT_TOPBAR_PANEL,
  registerCapabilitySlotContribution,
  scheduleCapabilitySlotRender,
} from "./capability-slots.js";

export function registerTopbarPanelContribution(contribution) {
  return registerCapabilitySlotContribution({
    ...contribution,
    slot: CAPABILITY_SLOT_TOPBAR_PANEL,
    view: contribution?.view || "toolbar",
  });
}

export function scheduleTopbarPanelRender(delayMs) {
  scheduleCapabilitySlotRender(delayMs);
}
