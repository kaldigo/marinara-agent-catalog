import { activateWithMariBridge } from "../../bridge-sdk/server.js";
import { applyPersonaDetailResult } from "./persona-fields.js";

const PERSONA_PROMPT_EXTENSION = `Also track these PLAYER PERSONA scene details in GameState. Add this property to the same JSON object:
"trackerFields": {
  "Outfit": "string — what the persona is currently wearing",
  "Location": "string — the persona's current specific location",
  "Movement": "string — the persona's current movement or physical posture",
  "Activity": "string — what the persona is currently doing"
}
Always return all four keys. Preserve the prior value when the latest narrative does not change it. Keep each value concise.`;

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "tracker-profile-details",
      api: { major: 1, minMinor: 8 },
      require: ["agent.prompt", "agent.result-types", "consumer.sessions", "runtime.health"],
    },
    async (bridgeSession) => {
      bridgeSession.agentPrompts.register({
        id: "persona-scene-details",
        agentTypes: ["persona-stats"],
        content: PERSONA_PROMPT_EXTENSION,
      });
      bridgeSession.agentResults.register({
        id: "persona-scene-details",
        resultType: "persona_stats_update",
        agentTypes: ["persona-stats"],
        apply: applyPersonaDetailResult,
      });
      context?.api?.runtime?.logger?.info?.("Tracker Profile Details activated through Mari Bridge.");
    },
  );
}

export async function selfCheck() {}
