import {
  CAPABILITY_SLOT_MESSAGE_ACTIONS,
  registerCapabilitySlotContribution,
  scheduleCapabilitySlotRender,
} from "./capability-slots.js";

export function registerMessageActionContribution(contribution) {
  return registerCapabilitySlotContribution({
    ...contribution,
    slot: CAPABILITY_SLOT_MESSAGE_ACTIONS,
    view: contribution?.view || "message-actions",
  });
}

export function scheduleMessageActionRender(delayMs) {
  scheduleCapabilitySlotRender(delayMs);
}
