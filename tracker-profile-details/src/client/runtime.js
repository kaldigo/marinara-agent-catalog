import { activateClientWithMariBridge } from "../../../_mari-bridge/sdk/client.js";

const CAPABILITY_TAG = "marinara-capability-tracker-profile-details";
if (!customElements.get(CAPABILITY_TAG)) {
  customElements.define(CAPABILITY_TAG, class TrackerProfileDetailsCapability extends HTMLElement {});
}

const cleanupTrackerProfileDetails = await activateClientWithMariBridge(
  {
    consumerId: "tracker-profile-details",
    api: { major: 1, minMinor: 9 },
    require: ["client.bridge-first", "consumer.sessions", "runtime.health", "tracker.detail-fields"],
  },
  async (bridgeSession) => {
    const disposeCharacterFields = bridgeSession.tracker.registerDetailFields({
      id: "character-scene-details",
      target: "character",
      fields: [
        { name: "Location", icon: "location" },
        { name: "Movement", icon: "movement" },
        { name: "Activity", icon: "activity" },
      ],
    });
    const disposePersonaFields = bridgeSession.tracker.registerDetailFields({
      id: "persona-scene-details",
      target: "persona",
      fields: [
        { name: "Outfit", icon: "shirt" },
        { name: "Location", icon: "location" },
        { name: "Movement", icon: "movement" },
        { name: "Activity", icon: "activity" },
      ],
    });
    return () => {
      disposePersonaFields();
      disposeCharacterFields();
    };
  },
);

void cleanupTrackerProfileDetails;
