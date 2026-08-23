import { activateWithMariBridge } from "../../bridge-sdk/server.js";
import {
  GM_NOTES_AGENT_ID,
  GM_NOTES_RESULT_TYPE,
  applyGmNoteUpdates,
  formatGmNotesForCommittedContext,
  gmNotesAgentState,
  mergeGmNotesIntoPlayerStats,
  readGmNotesFromPlayerStats,
} from "../shared/state.js";

function playerStatsFromSnapshot(snapshot) {
  return snapshot?.playerStats ?? null;
}

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "gm-notes",
      api: { major: 1, minMinor: 1 },
      require: ["agent.result-types", "consumer.sessions", "runtime.health", "tracker.context"],
    },
    async (bridgeSession) => {
      bridgeSession.agentResults.register({
        id: "gm-notes-updates",
        resultType: GM_NOTES_RESULT_TYPE,
        agentTypes: [GM_NOTES_AGENT_ID],
        async apply(scope) {
          const snapshot = await scope.state.read();
          const playerStats = playerStatsFromSnapshot(snapshot);
          const current = readGmNotesFromPlayerStats(playerStats);
          const applied = applyGmNoteUpdates(current, scope.result?.data?.updates, {
            messageId: scope.messageId,
            swipeIndex: scope.swipeIndex,
          });
          if (!applied.changed) return { changed: false };
          const nextPlayerStats = mergeGmNotesIntoPlayerStats(playerStats, applied.state);
          await scope.state.update({ playerStats: nextPlayerStats });
          scope.emitPatch?.({ playerStats: nextPlayerStats });
          return { changed: true, count: applied.state.notes.length };
        },
      });

      bridgeSession.trackerContext.register({
        id: "gm-notes",
        agentTypes: [GM_NOTES_AGENT_ID],
        order: 450,
        formatCommitted(scope) {
          const content = formatGmNotesForCommittedContext(playerStatsFromSnapshot(scope.latestGameState));
          return content ? { label: "GM Notes", content } : null;
        },
        formatAgentState(scope) {
          return gmNotesAgentState(playerStatsFromSnapshot(scope.latestGameState));
        },
      });

      context.api.runtime.logger.info("GM Notes activated through Mari Bridge.");
    },
  );
}

export async function selfCheck() {
  if (typeof readGmNotesFromPlayerStats !== "function") throw new Error("GM Notes state codec is unavailable");
}
