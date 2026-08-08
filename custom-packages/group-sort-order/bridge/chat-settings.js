import {
  CAPABILITY_SLOT_CHAT_SETTINGS,
  registerCapabilitySlotContribution,
  scheduleCapabilitySlotRender,
} from "./capability-slots.js";

export function registerCapabilityChatSettingsContribution(contribution) {
  return registerCapabilitySlotContribution({
    ...contribution,
    slot: CAPABILITY_SLOT_CHAT_SETTINGS,
    view: contribution?.view || "settings",
    match: {
      ...(contribution?.match || {}),
      agentId: contribution?.agentId || contribution?.match?.agentId || contribution?.packageId,
    },
  });
}

export function scheduleChatSettingsRender(delayMs) {
  scheduleCapabilitySlotRender(delayMs);
}
